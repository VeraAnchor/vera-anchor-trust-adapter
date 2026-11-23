import { describe, expect, it } from "vitest";

import {
  buildPopulationStatementV1,
  buildQualifiedEvidenceSnapshotV1,
  qualifyTrustObservationsV1,
  type EvidenceLineageV1,
  type EvidenceQualificationPolicyV1,
  type PopulationDeclarationV1,
  type QualificationFindingV1,
  type TrustEvaluationWindowV1,
  type TrustObservationV1,
} from "../../src/index.js";

const POLICY: EvidenceQualificationPolicyV1 = {
  schema: "EvidenceQualificationPolicyV1",
  policy_id: "vera-anchor:execution-qualification",
  policy_version: "1",
  allowed_observation_kinds: ["execution"],
  required_claims: ["subject_binding", "observation_integrity"],
};

const WINDOW: TrustEvaluationWindowV1 = {
  schema: "TrustEvaluationWindowV1",
  effective_at: "2026-11-21T20:00:00.000Z",
  window_start: "2026-11-21T17:00:00.000Z",
  window_end: "2026-11-21T19:00:00.000Z",
};

function observation(
  id: string,
  eventId: string,
  occurredAt: string
): TrustObservationV1 {
  return {
    schema: "TrustObservationV1",
    observation_id: id,
    event_id: eventId,
    kind: "execution",
    occurred_at: occurredAt,
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

function findings(id: string): readonly QualificationFindingV1[] {
  return [
    {
      schema: "QualificationFindingV1",
      observation_id: id,
      claim: "subject_binding",
      status: "pass",
      method: "fixture-verifier",
      evidence_refs: ["fixture:verification"],
    },
    {
      schema: "QualificationFindingV1",
      observation_id: id,
      claim: "observation_integrity",
      status: "pass",
      method: "fixture-verifier",
      evidence_refs: ["fixture:verification"],
    },
  ];
}

function declaration(): PopulationDeclarationV1 {
  return {
    schema: "PopulationDeclarationV1",
    basis: "provider_complete",
    eligible_events: 1,
    observed_events: 1,
    method: "fixture-population",
    evidence_refs: ["fixture:population"],
  };
}

function build(reverse = false) {
  const observations = [
    observation("obs-a", "event-a", "2026-11-21T18:00:00.000Z"),
    observation("obs-b", "event-b", "2026-11-21T18:30:00.000Z"),
  ];

  if (reverse) observations.reverse();

  const lineage: EvidenceLineageV1 = {
    schema: "EvidenceLineageV1",
    relations: [
      {
        schema: "EvidenceLineageRelationV1",
        left_observation_id: reverse ? "obs-b" : "obs-a",
        right_observation_id: reverse ? "obs-a" : "obs-b",
        state: "proven_same",
        method: "fixture-lineage",
        evidence_refs: ["fixture:lineage"],
      },
    ],
  };

  const qualification = qualifyTrustObservationsV1(
    observations,
    lineage,
    [...findings("obs-b"), ...findings("obs-a")],
    POLICY
  );

  const population = buildPopulationStatementV1(
    observations,
    qualification,
    declaration()
  );

  if (!population.ok) throw new Error(population.code);

  return buildQualifiedEvidenceSnapshotV1({
    observations,
    lineage,
    policy: POLICY,
    qualification,
    population: population.population,
    window: WINDOW,
  });
}

describe("qualified evidence snapshots", () => {
  it("builds a deterministic digest-bound snapshot", () => {
    const result = build();

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.snapshot.digest.hash).toBe(
      "c85dd7c59ecd73403d72ef8ec040a7776358075ffa9ddbfea9463b180086e12f" +
        "52968bbc8e02b6a89c142df36b67ab189e9737818041bc859f965edfda185319"
    );
    expect(result.snapshot.payload.qualification_policy.digest.hash).toBe(
      "49d83c2dfdc6d668e32d986dd50f7064b47c90bf6d5630360fbc359f221811d6" +
        "85a28c20a3a081373dce9604998c90359be3601aaff495ea6709df66101d13a6"
    );
  });

  it("is stable across source observation and lineage ordering", () => {
    const first = build();
    const second = build(true);

    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
    if (!first.ok || !second.ok) return;

    expect(first.snapshot).toEqual(second.snapshot);
  });

  it("preserves unknown correlation as the default lineage state", () => {
    const result = build();

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.snapshot.payload.qualified_lineage.default_state).toBe(
      "unknown"
    );
    expect(result.snapshot.payload.equivalence_groups).toEqual([
      { observation_ids: ["obs-a", "obs-b"] },
    ]);
  });

  it("rejects observations outside the declared evaluation window", () => {
    const observations = [
      observation("obs-a", "event-a", "2026-11-21T21:00:00.000Z"),
    ];
    const lineage: EvidenceLineageV1 = {
      schema: "EvidenceLineageV1",
      relations: [],
    };
    const qualification = qualifyTrustObservationsV1(
      observations,
      lineage,
      findings("obs-a"),
      POLICY
    );
    const population = buildPopulationStatementV1(
      observations,
      qualification,
      {
        ...declaration(),
        eligible_events: 1,
        observed_events: 1,
      }
    );

    expect(population.ok).toBe(true);
    if (!population.ok) return;

    expect(
      buildQualifiedEvidenceSnapshotV1({
        observations,
        lineage,
        policy: POLICY,
        qualification,
        population: population.population,
        window: WINDOW,
      })
    ).toEqual({
      ok: false,
      code: "OBSERVATION_OUTSIDE_WINDOW",
    });
  });

  it("rejects policy identity drift", () => {
    const result = build();
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const observations = result.snapshot.payload.qualified_observations;
    const lineage: EvidenceLineageV1 = {
      schema: "EvidenceLineageV1",
      relations: [],
    };

    expect(
      buildQualifiedEvidenceSnapshotV1({
        observations,
        lineage,
        policy: {
          ...POLICY,
          policy_version: "2",
        },
        qualification: {
          ok: true,
          policy_id: POLICY.policy_id,
          policy_version: POLICY.policy_version,
          decisions: result.snapshot.payload.qualification_decisions,
          equivalence_groups:
            result.snapshot.payload.equivalence_groups,
        },
        population: result.snapshot.payload.population,
        window: WINDOW,
      })
    ).toEqual({
      ok: false,
      code: "QUALIFICATION_POLICY_MISMATCH",
    });
  });

  it("does not manufacture a snapshot when no observations exist", () => {
    expect(
      buildQualifiedEvidenceSnapshotV1({
        observations: [],
        lineage: {
          schema: "EvidenceLineageV1",
          relations: [],
        },
        policy: POLICY,
        qualification: {
          ok: true,
          policy_id: POLICY.policy_id,
          policy_version: POLICY.policy_version,
          decisions: [],
          equivalence_groups: [],
        },
        population: {
          schema: "PopulationStatementV1",
          basis: "unknown",
          eligible_events: null,
          observed_events: null,
          projected_observations: 0,
          qualified_observations: 0,
          excluded_observations: 0,
          unavailable_observations: 0,
          failed_observations: 0,
          qualified_equivalence_groups: 0,
          collapsed_observations: 0,
          method: "fixture-population",
          evidence_refs: ["fixture:population"],
        },
        window: WINDOW,
      })
    ).toEqual({
      ok: false,
      code: "NO_OBSERVATIONS",
    });
  });
});