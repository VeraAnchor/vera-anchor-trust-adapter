import { describe, expect, it } from "vitest";

import {
  groupTrustObservationsV1,
  type EvidenceLineageRelationV1,
  type EvidenceLineageV1,
  type TrustObservationV1,
} from "../../src/index.js";

function observation(
  observationId: string,
  eventId: string
): TrustObservationV1 {
  return {
    schema: "TrustObservationV1",
    observation_id: observationId,
    event_id: eventId,
    kind: "execution",
    occurred_at: "2026-11-21T19:01:26.905Z",
    subject_binding: {
      schema: "SubjectBindingV1",
      subject: {
        schema: "TrustSubjectV1",
        primary: {
          scheme: "hcs14_uaid",
          value: "uaid:did:example.com:agents:test",
        },
        aliases: [],
      },
      role: "executor",
      method: "fixture",
      evidence_refs: [],
    },
    scope: {
      schema: "TrustScopeV1",
      network: {
        namespace: "hedera",
        id: "mainnet",
      },
    },
    evidence_refs: [],
  };
}

function relation(
  left: string,
  right: string,
  state: EvidenceLineageRelationV1["state"]
): EvidenceLineageRelationV1 {
  return {
    schema: "EvidenceLineageRelationV1",
    left_observation_id: left,
    right_observation_id: right,
    state,
    method: "fixture",
    evidence_refs: [],
  };
}

function lineage(
  ...relations: readonly EvidenceLineageRelationV1[]
): EvidenceLineageV1 {
  return {
    schema: "EvidenceLineageV1",
    relations,
  };
}

describe("observation lineage grouping", () => {
  it("groups observations proven to represent the same event", () => {
    const result = groupTrustObservationsV1(
      [
        observation("obs-a", "provider-a:event-1"),
        observation("obs-b", "provider-b:event-99"),
      ],
      lineage(relation("obs-a", "obs-b", "proven_same"))
    );

    expect(result).toEqual({
      ok: true,
      equivalence_groups: [{ observation_ids: ["obs-a", "obs-b"] }],
    });
  });

  it("does not infer independence from unknown correlation", () => {
    const result = groupTrustObservationsV1(
      [
        observation("obs-a", "event-a"),
        observation("obs-b", "event-b"),
      ],
      lineage(relation("obs-a", "obs-b", "unknown"))
    );

    expect(result).toEqual({
      ok: true,
      equivalence_groups: [
        { observation_ids: ["obs-a"] },
        { observation_ids: ["obs-b"] },
      ],
    });
  });

  it("does not merge equal event ids without admitted lineage", () => {
    const result = groupTrustObservationsV1(
      [
        observation("obs-a", "claimed-event"),
        observation("obs-b", "claimed-event"),
      ],
      lineage()
    );

    expect(result).toEqual({
      ok: true,
      equivalence_groups: [
        { observation_ids: ["obs-a"] },
        { observation_ids: ["obs-b"] },
      ],
    });
  });

  it("merges transitive proven-same relations", () => {
    const result = groupTrustObservationsV1(
      [
        observation("obs-a", "event-a"),
        observation("obs-b", "event-b"),
        observation("obs-c", "event-c"),
      ],
      lineage(
        relation("obs-a", "obs-b", "proven_same"),
        relation("obs-b", "obs-c", "proven_same")
      )
    );

    expect(result).toEqual({
      ok: true,
      equivalence_groups: [
        { observation_ids: ["obs-a", "obs-b", "obs-c"] },
      ],
    });
  });

  it("fails on contradictory lineage", () => {
    const result = groupTrustObservationsV1(
      [
        observation("obs-a", "event-a"),
        observation("obs-b", "event-b"),
        observation("obs-c", "event-c"),
      ],
      lineage(
        relation("obs-a", "obs-b", "proven_same"),
        relation("obs-b", "obs-c", "proven_same"),
        relation("obs-a", "obs-c", "proven_different")
      )
    );

    expect(result).toEqual({
      ok: false,
      code: "LINEAGE_CONTRADICTION",
      observation_ids: ["obs-a", "obs-c"],
    });
  });

  it("fails when the same pair is both proven same and proven different", () => {
    const result = groupTrustObservationsV1(
      [
        observation("obs-a", "event-a"),
        observation("obs-b", "event-b"),
      ],
      lineage(
        relation("obs-a", "obs-b", "proven_same"),
        relation("obs-b", "obs-a", "proven_different")
      )
    );

    expect(result).toEqual({
      ok: false,
      code: "LINEAGE_RELATION_CONFLICT",
      observation_ids: ["obs-a", "obs-b"],
    });
  });

  it("is deterministic across input ordering", () => {
    const observations = [
      observation("obs-c", "event-c"),
      observation("obs-a", "event-a"),
      observation("obs-b", "event-b"),
    ];

    const first = groupTrustObservationsV1(
      observations,
      lineage(relation("obs-c", "obs-b", "proven_same"))
    );

    const second = groupTrustObservationsV1(
      [...observations].reverse(),
      lineage(relation("obs-b", "obs-c", "proven_same"))
    );

    expect(first).toEqual(second);
  });

  it("does not let repeated lineage assertions create more groups", () => {
    const result = groupTrustObservationsV1(
      [
        observation("obs-a", "event-a"),
        observation("obs-b", "event-b"),
      ],
      lineage(
        relation("obs-a", "obs-b", "proven_same"),
        relation("obs-a", "obs-b", "proven_same"),
        relation("obs-b", "obs-a", "proven_same")
      )
    );

    expect(result).toEqual({
      ok: true,
      equivalence_groups: [{ observation_ids: ["obs-a", "obs-b"] }],
    });
  });

  it("rejects proven-same relations across different trust contexts", () => {
    const first = observation("obs-a", "event-a");
    const base = observation("obs-b", "event-b");
    const second: TrustObservationV1 = {
      ...base,
      subject_binding: {
        ...base.subject_binding,
        role: "requester",
      },
    };

    const result = groupTrustObservationsV1(
      [first, second],
      lineage(relation("obs-a", "obs-b", "proven_same"))
    );

    expect(result).toEqual({
      ok: false,
      code: "INCOMPATIBLE_PROVEN_SAME_RELATION",
      observation_ids: ["obs-a", "obs-b"],
    });
  });
});