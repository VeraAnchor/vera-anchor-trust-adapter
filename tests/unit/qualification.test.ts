import { describe, expect, it } from "vitest";

import {
  qualifyTrustObservationsV1,
  type EvidenceLineageRelationV1,
  type EvidenceLineageV1,
  type EvidenceQualificationPolicyV1,
  type QualificationClaimV1,
  type QualificationFindingStatusV1,
  type QualificationFindingV1,
  type TrustObservationV1,
} from "../../src/index.js";

const POLICY: EvidenceQualificationPolicyV1 = {
  schema: "EvidenceQualificationPolicyV1",
  policy_id: "vera-anchor:execution-qualification",
  policy_version: "1",
  allowed_observation_kinds: ["execution"],
  required_claims: ["subject_binding", "observation_integrity"],
};

function observation(id: string, eventId = id): TrustObservationV1 {
  return {
    schema: "TrustObservationV1",
    observation_id: id,
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
      evidence_refs: ["fixture:binding"],
    },
    scope: {
      schema: "TrustScopeV1",
      network: {
        namespace: "hedera",
        id: "mainnet",
      },
    },
    evidence_refs: ["fixture:evidence"],
  };
}

function finding(
  observationId: string,
  claim: QualificationClaimV1,
  status: QualificationFindingStatusV1
): QualificationFindingV1 {
  return {
    schema: "QualificationFindingV1",
    observation_id: observationId,
    claim,
    status,
    method: "fixture-verifier",
    evidence_refs: ["fixture:verification"],
  };
}

function qualifiedFindings(
  observationId: string
): readonly QualificationFindingV1[] {
  return [
    finding(observationId, "subject_binding", "pass"),
    finding(observationId, "observation_integrity", "pass"),
  ];
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
    method: "fixture-lineage",
    evidence_refs: ["fixture:lineage"],
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

describe("trust observation qualification", () => {
  it("qualifies an observation when all required claims pass", () => {
    const result = qualifyTrustObservationsV1(
      [observation("obs-a")],
      lineage(),
      qualifiedFindings("obs-a"),
      POLICY
    );

    expect(result).toEqual({
      ok: true,
      policy_id: POLICY.policy_id,
      policy_version: POLICY.policy_version,
      decisions: [
        {
          observation_id: "obs-a",
          status: "qualified",
          reason_code: "QUALIFIED",
          claims: [
            {
              claim: "subject_binding",
              status: "pass",
              reason_code: "REQUIRED_FINDING_PASSED",
            },
            {
              claim: "observation_integrity",
              status: "pass",
              reason_code: "REQUIRED_FINDING_PASSED",
            },
          ],
        },
      ],
      groups: [{ observation_ids: ["obs-a"] }],
    });
  });

  it("keeps missing required verification unavailable", () => {
    const result = qualifyTrustObservationsV1(
      [observation("obs-a")],
      lineage(),
      [finding("obs-a", "subject_binding", "pass")],
      POLICY
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.decisions[0]).toMatchObject({
      observation_id: "obs-a",
      status: "unavailable",
      reason_code: "REQUIRED_FINDING_MISSING",
    });
    expect(result.groups).toEqual([]);
  });

  it("fails qualification when a required claim is contradicted", () => {
    const result = qualifyTrustObservationsV1(
      [observation("obs-a")],
      lineage(),
      [
        finding("obs-a", "subject_binding", "pass"),
        finding("obs-a", "observation_integrity", "fail"),
      ],
      POLICY
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.decisions[0]).toMatchObject({
      status: "failed",
      reason_code: "REQUIRED_FINDING_FAILED",
    });
    expect(result.groups).toEqual([]);
  });

  it("fails closed when pass and fail findings conflict", () => {
    const result = qualifyTrustObservationsV1(
      [observation("obs-a")],
      lineage(),
      [
        ...qualifiedFindings("obs-a"),
        finding("obs-a", "subject_binding", "fail"),
      ],
      POLICY
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.decisions[0]).toMatchObject({
      status: "failed",
      reason_code: "REQUIRED_FINDING_FAILED",
    });
  });

  it("groups multiple qualified representations proven to be the same", () => {
    const result = qualifyTrustObservationsV1(
      [
        observation("obs-a", "provider-a:event-1"),
        observation("obs-b", "provider-b:event-9"),
      ],
      lineage(relation("obs-a", "obs-b", "proven_same")),
      [
        ...qualifiedFindings("obs-a"),
        ...qualifiedFindings("obs-b"),
      ],
      POLICY
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.groups).toEqual([
      { observation_ids: ["obs-a", "obs-b"] },
    ]);
  });

  it("does not let an unqualified duplicate suppress a qualified observation", () => {
    const result = qualifyTrustObservationsV1(
      [observation("obs-a"), observation("obs-b")],
      lineage(relation("obs-a", "obs-b", "proven_same")),
      [
        ...qualifiedFindings("obs-a"),
        finding("obs-b", "subject_binding", "pass"),
      ],
      POLICY
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.decisions).toMatchObject([
      {
        observation_id: "obs-a",
        status: "qualified",
      },
      {
        observation_id: "obs-b",
        status: "unavailable",
      },
    ]);
    expect(result.groups).toEqual([
      { observation_ids: ["obs-a"] },
    ]);
  });

  it("does not let repeated pass findings create additional influence", () => {
    const result = qualifyTrustObservationsV1(
      [observation("obs-a")],
      lineage(),
      [
        ...qualifiedFindings("obs-a"),
        finding("obs-a", "subject_binding", "pass"),
        finding("obs-a", "subject_binding", "pass"),
      ],
      POLICY
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.groups).toEqual([
      { observation_ids: ["obs-a"] },
    ]);
  });

  it("rejects findings for unknown observations", () => {
    const result = qualifyTrustObservationsV1(
      [observation("obs-a")],
      lineage(),
      [finding("obs-unknown", "subject_binding", "pass")],
      POLICY
    );

    expect(result).toEqual({
      ok: false,
      code: "UNKNOWN_FINDING_OBSERVATION",
      observation_ids: ["obs-unknown"],
    });
  });
});