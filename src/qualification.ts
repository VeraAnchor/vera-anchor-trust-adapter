// ============================================================================
// File: src/qualification.ts
// Purpose:
//   Deterministically qualify normalized trust observations under explicit,
//   versioned evidence policy.
// ============================================================================

import type {
  EvidenceLineageV1,
  EvidenceQualificationPolicyV1,
  ObservationQualificationDecisionV1,
  ObservationQualificationReasonCodeV1,
  QualificationClaimDecisionV1,
  QualificationClaimV1,
  QualificationFindingStatusV1,
  QualificationFindingV1,
  TrustObservationKindV1,
  TrustObservationV1,
} from "./contracts.js";

import {
  groupTrustObservationsV1,
  type ObservationEquivalenceGroupV1,
  type ObservationGroupingFailureCodeV1,
} from "./lineage.js";

export type QualificationFailureCodeV1 =
  | "INVALID_POLICY"
  | "INVALID_FINDING"
  | "UNKNOWN_FINDING_OBSERVATION"
  | ObservationGroupingFailureCodeV1;

export type QualificationResultV1 =
  | Readonly<{
      ok: true;
      policy_id: string;
      policy_version: string;
      decisions: readonly ObservationQualificationDecisionV1[];
      equivalence_groups: readonly ObservationEquivalenceGroupV1[];
    }>
  | Readonly<{
      ok: false;
      code: QualificationFailureCodeV1;
      observation_ids?: readonly string[];
    }>;

const CLAIMS = new Set<QualificationClaimV1>([
  "subject_binding",
  "observation_integrity",
]);

const FINDING_STATUSES = new Set<QualificationFindingStatusV1>([
  "pass",
  "fail",
  "unavailable",
  "not_applicable",
]);

const OBSERVATION_KINDS = new Set<TrustObservationKindV1>(["execution"]);

function hasDuplicates(values: readonly string[]): boolean {
  return new Set(values).size !== values.length;
}

function validPolicy(policy: EvidenceQualificationPolicyV1): boolean {
  return (
    policy.schema === "EvidenceQualificationPolicyV1" &&
    policy.policy_id.trim().length > 0 &&
    policy.policy_version.trim().length > 0 &&
    policy.allowed_observation_kinds.length > 0 &&
    policy.required_claims.length > 0 &&
    !hasDuplicates(policy.allowed_observation_kinds) &&
    !hasDuplicates(policy.required_claims) &&
    policy.allowed_observation_kinds.every((kind) =>
      OBSERVATION_KINDS.has(kind)
    ) &&
    policy.required_claims.every((claim) => CLAIMS.has(claim))
  );
}

function validFinding(finding: QualificationFindingV1): boolean {
  return (
    finding.schema === "QualificationFindingV1" &&
    finding.observation_id.trim().length > 0 &&
    CLAIMS.has(finding.claim) &&
    FINDING_STATUSES.has(finding.status) &&
    finding.method.trim().length > 0 &&
    Array.isArray(finding.evidence_refs) &&
    finding.evidence_refs.every(
      (ref) => typeof ref === "string" && ref.trim().length > 0
    )
  );
}

function aggregateClaim(
  claim: QualificationClaimV1,
  statuses: ReadonlySet<QualificationFindingStatusV1> | undefined
): QualificationClaimDecisionV1 {
  if (!statuses?.size) {
    return {
      claim,
      status: "unavailable",
      reason_code: "REQUIRED_FINDING_MISSING",
    };
  }

  if (statuses.has("fail")) {
    return {
      claim,
      status: "fail",
      reason_code: "REQUIRED_FINDING_FAILED",
    };
  }

  if (statuses.has("pass")) {
    return {
      claim,
      status: "pass",
      reason_code: "REQUIRED_FINDING_PASSED",
    };
  }

  return {
    claim,
    status: "unavailable",
    reason_code: "REQUIRED_FINDING_UNAVAILABLE",
  };
}

function observationDecision(
  observation: TrustObservationV1,
  policy: EvidenceQualificationPolicyV1,
  findings: ReadonlyMap<
    QualificationClaimV1,
    ReadonlySet<QualificationFindingStatusV1>
  >
): ObservationQualificationDecisionV1 {
  if (!policy.allowed_observation_kinds.includes(observation.kind)) {
    return {
      observation_id: observation.observation_id,
      status: "excluded",
      reason_code: "OBSERVATION_KIND_NOT_ALLOWED",
      claims: [],
    };
  }

  const claims = policy.required_claims.map((claim) =>
    aggregateClaim(claim, findings.get(claim))
  );

  const failed = claims.some((claim) => claim.status === "fail");
  const unavailable = claims.some((claim) => claim.status === "unavailable");

  let status: ObservationQualificationDecisionV1["status"];
  let reasonCode: ObservationQualificationReasonCodeV1;

  if (failed) {
    status = "failed";
    reasonCode = "REQUIRED_FINDING_FAILED";
  } else if (unavailable) {
    status = "unavailable";
    reasonCode = claims.some(
      (claim) => claim.reason_code === "REQUIRED_FINDING_MISSING"
    )
      ? "REQUIRED_FINDING_MISSING"
      : "REQUIRED_FINDING_UNAVAILABLE";
  } else {
    status = "qualified";
    reasonCode = "QUALIFIED";
  }

  return {
    observation_id: observation.observation_id,
    status,
    reason_code: reasonCode,
    claims,
  };
}

export function qualifyTrustObservationsV1(
  observations: readonly TrustObservationV1[],
  lineage: EvidenceLineageV1,
  findings: readonly QualificationFindingV1[],
  policy: EvidenceQualificationPolicyV1
): QualificationResultV1 {
  if (!validPolicy(policy)) {
    return { ok: false, code: "INVALID_POLICY" };
  }

  const lineageValidation = groupTrustObservationsV1(observations, lineage);
  if (!lineageValidation.ok) return lineageValidation;

  const observationIds = new Set(
    observations.map((observation) => observation.observation_id)
  );

  const findingsByObservation = new Map<
    string,
    Map<QualificationClaimV1, Set<QualificationFindingStatusV1>>
  >();

  for (const finding of findings) {
    if (!validFinding(finding)) {
      return { ok: false, code: "INVALID_FINDING" };
    }

    if (!observationIds.has(finding.observation_id)) {
      return {
        ok: false,
        code: "UNKNOWN_FINDING_OBSERVATION",
        observation_ids: [finding.observation_id],
      };
    }

    let observationFindings = findingsByObservation.get(
      finding.observation_id
    );

    if (!observationFindings) {
      observationFindings = new Map();
      findingsByObservation.set(finding.observation_id, observationFindings);
    }

    let statuses = observationFindings.get(finding.claim);

    if (!statuses) {
      statuses = new Set();
      observationFindings.set(finding.claim, statuses);
    }

    statuses.add(finding.status);
  }

  const decisions = [...observations]
    .sort((left, right) =>
      left.observation_id < right.observation_id
        ? -1
        : left.observation_id > right.observation_id
          ? 1
          : 0
    )
    .map((observation) =>
      observationDecision(
        observation,
        policy,
        findingsByObservation.get(observation.observation_id) ?? new Map()
      )
    );

  const qualifiedIds = new Set(
    decisions
      .filter((decision) => decision.status === "qualified")
      .map((decision) => decision.observation_id)
  );

  const qualifiedObservations = observations.filter((observation) =>
    qualifiedIds.has(observation.observation_id)
  );

  const qualifiedLineage: EvidenceLineageV1 = {
    schema: "EvidenceLineageV1",
    relations: lineage.relations.filter(
      (relation) =>
        qualifiedIds.has(relation.left_observation_id) &&
        qualifiedIds.has(relation.right_observation_id)
    ),
  };

  const grouping = groupTrustObservationsV1(
    qualifiedObservations,
    qualifiedLineage
  );

  if (!grouping.ok) return grouping;

  return {
    ok: true,
    policy_id: policy.policy_id,
    policy_version: policy.policy_version,
    decisions,
    equivalence_groups: grouping.equivalence_groups,
  };
}