// ============================================================================
// File: src/contracts.ts
// Purpose:
//   Versioned trust primitives shared by qualification, scoring, and verification.
// ============================================================================

export type TrustSubjectIdentifierSchemeV1 =
  | "hcs14_uaid"
  | "did"
  | "uri"
  | "native";

export type TrustSubjectIdentifierV1 = Readonly<{
  scheme: TrustSubjectIdentifierSchemeV1;
  value: string;
  registry?: string;
}>;

export type TrustSubjectV1 = Readonly<{
  schema: "TrustSubjectV1";
  primary: TrustSubjectIdentifierV1;
  aliases: readonly TrustSubjectIdentifierV1[];
}>;

export type TrustSubjectRoleV1 = "requester" | "executor";

export type SubjectBindingV1 = Readonly<{
  schema: "SubjectBindingV1";
  subject: TrustSubjectV1;
  role: TrustSubjectRoleV1;
  method: string;
  evidence_refs: readonly string[];
}>;

export type TrustNetworkRefV1 = Readonly<{
  namespace: string;
  id: string;
}>;

export type TrustCapabilityRefV1 = Readonly<{
  namespace: string;
  id: string;
  version?: string;
}>;

export type TrustScopeV1 = Readonly<{
  schema: "TrustScopeV1";
  network: TrustNetworkRefV1;
  capability?: TrustCapabilityRefV1;
  task_class?: string;
}>;

export type TrustObservationKindV1 = "execution";

export type TrustObservationV1 = Readonly<{
  schema: "TrustObservationV1";
  observation_id: string;
  event_id: string;
  kind: TrustObservationKindV1;
  occurred_at: string;
  subject_binding: SubjectBindingV1;
  scope: TrustScopeV1;
  evidence_refs: readonly string[];
}>;

export type EvidenceCorrelationStateV1 =
  | "proven_same"
  | "proven_different"
  | "unknown";

export type EvidenceLineageRelationV1 = Readonly<{
  schema: "EvidenceLineageRelationV1";
  left_observation_id: string;
  right_observation_id: string;
  state: EvidenceCorrelationStateV1;
  method: string;
  evidence_refs: readonly string[];
}>;

export type EvidenceLineageV1 = Readonly<{
  schema: "EvidenceLineageV1";
  relations: readonly EvidenceLineageRelationV1[];
}>;

export type QualificationClaimV1 =
  | "subject_binding"
  | "observation_integrity";

export type QualificationFindingStatusV1 =
  | "pass"
  | "fail"
  | "unavailable"
  | "not_applicable";

export type QualificationFindingV1 = Readonly<{
  schema: "QualificationFindingV1";
  observation_id: string;
  claim: QualificationClaimV1;
  status: QualificationFindingStatusV1;
  method: string;
  evidence_refs: readonly string[];
}>;

export type EvidenceQualificationPolicyV1 = Readonly<{
  schema: "EvidenceQualificationPolicyV1";
  policy_id: string;
  policy_version: string;
  allowed_observation_kinds: readonly TrustObservationKindV1[];
  required_claims: readonly QualificationClaimV1[];
}>;

export type ObservationQualificationStatusV1 =
  | "qualified"
  | "excluded"
  | "unavailable"
  | "failed";

export type ObservationQualificationReasonCodeV1 =
  | "QUALIFIED"
  | "OBSERVATION_KIND_NOT_ALLOWED"
  | "REQUIRED_FINDING_PASSED"
  | "REQUIRED_FINDING_MISSING"
  | "REQUIRED_FINDING_UNAVAILABLE"
  | "REQUIRED_FINDING_FAILED";

export type QualificationClaimDecisionV1 = Readonly<{
  claim: QualificationClaimV1;
  status: "pass" | "unavailable" | "fail";
  reason_code: ObservationQualificationReasonCodeV1;
}>;

export type ObservationQualificationDecisionV1 = Readonly<{
  observation_id: string;
  status: ObservationQualificationStatusV1;
  reason_code: ObservationQualificationReasonCodeV1;
  claims: readonly QualificationClaimDecisionV1[];
}>;

export type PopulationBasisV1 =
  | "provider_complete"
  | "submitted_sample"
  | "unknown";

export type PopulationDeclarationV1 = Readonly<{
  schema: "PopulationDeclarationV1";
  basis: PopulationBasisV1;
  eligible_events: number | null;
  observed_events: number | null;
  method: string;
  evidence_refs: readonly string[];
}>;

export type PopulationStatementV1 = Readonly<{
  schema: "PopulationStatementV1";
  basis: PopulationBasisV1;
  eligible_events: number | null;
  observed_events: number | null;
  projected_observations: number;
  qualified_observations: number;
  excluded_observations: number;
  unavailable_observations: number;
  failed_observations: number;
  qualified_equivalence_groups: number;
  collapsed_observations: number;
  method: string;
  evidence_refs: readonly string[];
}>;