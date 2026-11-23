import { describe, expect, it } from "vitest";

import {
  buildPopulationStatementV1,
  qualifyTrustObservationsV1,
  type EvidenceLineageV1,
  type EvidenceQualificationPolicyV1,
  type PopulationDeclarationV1,
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

function observation(id: string): TrustObservationV1 {
  return {
    schema: "TrustObservationV1",
    observation_id: id,
    event_id: `event:${id}`,
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

function findings(
  id: string,
  integrity: QualificationFindingV1["status"] = "pass"
): readonly QualificationFindingV1[] {
  return [
    {
      schema: "QualificationFindingV1",
      observation_id: id,
      claim: "subject_binding",
      status: "pass",
      method: "fixture",
      evidence_refs: ["fixture:verification"],
    },
    {
      schema: "QualificationFindingV1",
      observation_id: id,
      claim: "observation_integrity",
      status: integrity,
      method: "fixture",
      evidence_refs: ["fixture:verification"],
    },
  ];
}

function declaration(
  basis: PopulationDeclarationV1["basis"],
  eligibleEvents: number | null,
  observedEvents: number | null
): PopulationDeclarationV1 {
  return {
    schema: "PopulationDeclarationV1",
    basis,
    eligible_events: eligibleEvents,
    observed_events: observedEvents,
    method: "fixture-population",
    evidence_refs: ["fixture:population"],
  };
}

describe("population accounting", () => {
  it("keeps authoritative population counts separate from projected records", () => {
    const observations = [observation("obs-a"), observation("obs-b")];
    const lineage: EvidenceLineageV1 = {
      schema: "EvidenceLineageV1",
      relations: [
        {
          schema: "EvidenceLineageRelationV1",
          left_observation_id: "obs-a",
          right_observation_id: "obs-b",
          state: "proven_same",
          method: "fixture",
          evidence_refs: ["fixture:lineage"],
        },
      ],
    };

    const qualification = qualifyTrustObservationsV1(
      observations,
      lineage,
      [...findings("obs-a"), ...findings("obs-b")],
      POLICY
    );

    const result = buildPopulationStatementV1(
      observations,
      qualification,
      declaration("provider_complete", 100, 98)
    );

    expect(result).toEqual({
      ok: true,
      population: {
        schema: "PopulationStatementV1",
        basis: "provider_complete",
        eligible_events: 100,
        observed_events: 98,
        projected_observations: 2,
        qualified_observations: 2,
        excluded_observations: 0,
        unavailable_observations: 0,
        failed_observations: 0,
        qualified_equivalence_groups: 1,
        collapsed_observations: 1,
        method: "fixture-population",
        evidence_refs: ["fixture:population"],
      },
    });
  });

  it("does not invent an eligible population for submitted samples", () => {
    const observations = [observation("obs-a")];

    const qualification = qualifyTrustObservationsV1(
      observations,
      { schema: "EvidenceLineageV1", relations: [] },
      findings("obs-a"),
      POLICY
    );

    const result = buildPopulationStatementV1(
      observations,
      qualification,
      declaration("submitted_sample", null, 1)
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.population.eligible_events).toBeNull();
    expect(result.population.observed_events).toBe(1);
    expect(result.population.qualified_observations).toBe(1);
  });

  it("preserves unknown population rather than inferring coverage", () => {
    const result = buildPopulationStatementV1(
      [],
      {
        ok: true,
        policy_id: POLICY.policy_id,
        policy_version: POLICY.policy_version,
        decisions: [],
        equivalence_groups: [],
      },
      declaration("unknown", null, null)
    );

    expect(result).toMatchObject({
      ok: true,
      population: {
        basis: "unknown",
        eligible_events: null,
        observed_events: null,
        projected_observations: 0,
      },
    });
  });

  it("accounts separately for unavailable and failed qualification", () => {
    const observations = [
      observation("obs-a"),
      observation("obs-b"),
      observation("obs-c"),
    ];

    const qualification = qualifyTrustObservationsV1(
      observations,
      { schema: "EvidenceLineageV1", relations: [] },
      [
        ...findings("obs-a"),
        ...findings("obs-b", "unavailable"),
        ...findings("obs-c", "fail"),
      ],
      POLICY
    );

    const result = buildPopulationStatementV1(
      observations,
      qualification,
      declaration("submitted_sample", null, 3)
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.population).toMatchObject({
      qualified_observations: 1,
      unavailable_observations: 1,
      failed_observations: 1,
      qualified_equivalence_groups: 1,
      collapsed_observations: 0,
    });
  });

  it("rejects impossible provider-complete declarations", () => {
    const result = buildPopulationStatementV1(
      [],
      {
        ok: true,
        policy_id: POLICY.policy_id,
        policy_version: POLICY.policy_version,
        decisions: [],
        equivalence_groups: [],
      },
      declaration("provider_complete", 10, 11)
    );

    expect(result).toEqual({
      ok: false,
      code: "INVALID_POPULATION_DECLARATION",
    });
  });

  it("rejects mixed subject-role populations", () => {
    const executor = observation("obs-a");
    const requester: TrustObservationV1 = {
      ...observation("obs-b"),
      subject_binding: {
        ...observation("obs-b").subject_binding,
        role: "requester",
      },
    };

    const qualification = qualifyTrustObservationsV1(
      [executor, requester],
      { schema: "EvidenceLineageV1", relations: [] },
      [...findings("obs-a"), ...findings("obs-b")],
      POLICY
    );

    const result = buildPopulationStatementV1(
      [executor, requester],
      qualification,
      declaration("submitted_sample", null, 2)
    );

    expect(result).toEqual({
      ok: false,
      code: "MIXED_EVALUATION_CONTEXT",
    });
  });
});