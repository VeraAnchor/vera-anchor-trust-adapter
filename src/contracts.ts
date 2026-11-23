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