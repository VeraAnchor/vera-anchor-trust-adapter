// ============================================================================
// File: src/snapshot.ts
// Purpose:
//   Build deterministic, digest-bound qualified evidence snapshots.
// ============================================================================

import type {
  EvidenceCorrelationStateV1,
  EvidenceLineageV1,
  EvidenceQualificationPolicyV1,
  ObservationQualificationDecisionV1,
  PopulationStatementV1,
  QualificationClaimDecisionV1,
  TrustObservationV1,
  TrustScopeV1,
  TrustSubjectIdentifierV1,
  TrustSubjectRoleV1,
  TrustSubjectV1,
} from "./contracts.js";

import { computeDomainSeparatedSha3_512V1 } from "./canonical.js";
import {
  groupTrustObservationsV1,
  type ObservationEquivalenceGroupV1,
} from "./lineage.js";
import type { QualificationResultV1 } from "./qualification.js";

export const QUALIFICATION_POLICY_DOMAIN_SEPARATOR_V1 =
  "vera-anchor:evidence-qualification-policy:v1";

export const QUALIFIED_EVIDENCE_SNAPSHOT_DOMAIN_SEPARATOR_V1 =
  "vera-anchor:qualified-evidence-snapshot:v1";

export type TrustEvaluationWindowV1 = Readonly<{
  schema: "TrustEvaluationWindowV1";
  effective_at: string;
  window_start: string;
  window_end: string;
}>;

export type TrustDigestV1 = Readonly<{
  canonicalization: "RFC8785-JCS";
  digest_algorithm: "SHA3-512";
  domain_separator: string;
  hash: string;
}>;

export type QualifiedLineageRelationV1 = Readonly<{
  left_observation_id: string;
  right_observation_id: string;
  state: EvidenceCorrelationStateV1;
  methods: readonly string[];
  evidence_refs: readonly string[];
}>;

export type QualifiedLineageV1 = Readonly<{
  schema: "QualifiedLineageV1";
  default_state: "unknown";
  relations: readonly QualifiedLineageRelationV1[];
}>;

export type QualifiedEvidenceSnapshotPayloadV1 = Readonly<{
  subject: TrustSubjectV1;
  role: TrustSubjectRoleV1;
  scope: TrustScopeV1;
  window: TrustEvaluationWindowV1;
  qualification_policy: Readonly<{
    policy: EvidenceQualificationPolicyV1;
    digest: TrustDigestV1;
  }>;
  qualified_observations: readonly TrustObservationV1[];
  qualification_decisions: readonly ObservationQualificationDecisionV1[];
  equivalence_groups: readonly ObservationEquivalenceGroupV1[];
  qualified_lineage: QualifiedLineageV1;
  population: PopulationStatementV1;
}>;

export type QualifiedEvidenceSnapshotV1 = Readonly<{
  schema: "QualifiedEvidenceSnapshotV1";
  payload: QualifiedEvidenceSnapshotPayloadV1;
  digest: TrustDigestV1;
}>;

export type QualifiedEvidenceSnapshotInputV1 = Readonly<{
  observations: readonly TrustObservationV1[];
  lineage: EvidenceLineageV1;
  policy: EvidenceQualificationPolicyV1;
  qualification: QualificationResultV1;
  population: PopulationStatementV1;
  window: TrustEvaluationWindowV1;
}>;

export type QualifiedEvidenceSnapshotFailureCodeV1 =
  | "NO_OBSERVATIONS"
  | "INVALID_INPUT"
  | "INVALID_WINDOW"
  | "MIXED_EVALUATION_CONTEXT"
  | "OBSERVATION_OUTSIDE_WINDOW"
  | "QUALIFICATION_NOT_AVAILABLE"
  | "QUALIFICATION_POLICY_MISMATCH"
  | "QUALIFICATION_MISMATCH"
  | "LINEAGE_MISMATCH"
  | "POPULATION_MISMATCH"
  | "CANONICALIZATION_FAILED";

export type QualifiedEvidenceSnapshotResultV1 =
  | Readonly<{ ok: true; snapshot: QualifiedEvidenceSnapshotV1 }>
  | Readonly<{ ok: false; code: QualifiedEvidenceSnapshotFailureCodeV1 }>;

const TIMESTAMP_RE =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

function compare(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function text(value: unknown): string {
  if (typeof value !== "string" || !value || value !== value.trim()) {
    throw new TypeError("Invalid text value.");
  }
  return value;
}

function refs(values: readonly string[]): readonly string[] {
  return [...new Set(values.map(text))].sort(compare);
}

function timestamp(value: unknown): string {
  const raw = text(value);
  const ms = TIMESTAMP_RE.test(raw) ? Date.parse(raw) : Number.NaN;

  if (!Number.isFinite(ms) || new Date(ms).toISOString() !== raw) {
    throw new TypeError("Invalid canonical timestamp.");
  }

  return raw;
}

function identifierKey(identifier: TrustSubjectIdentifierV1): string {
  return [
    identifier.scheme,
    identifier.registry ?? "",
    identifier.value,
  ].join("\0");
}

function normalizeIdentifier(
  identifier: TrustSubjectIdentifierV1
): TrustSubjectIdentifierV1 {
  const value = text(identifier.value);

  if (
    identifier.scheme !== "hcs14_uaid" &&
    identifier.scheme !== "did" &&
    identifier.scheme !== "uri" &&
    identifier.scheme !== "native"
  ) {
    throw new TypeError("Invalid subject identifier scheme.");
  }

  if (identifier.registry === undefined) {
    return { scheme: identifier.scheme, value };
  }

  return {
    scheme: identifier.scheme,
    value,
    registry: text(identifier.registry),
  };
}

function normalizeSubject(subject: TrustSubjectV1): TrustSubjectV1 {
  if (subject.schema !== "TrustSubjectV1") {
    throw new TypeError("Invalid trust subject.");
  }

  const primary = normalizeIdentifier(subject.primary);
  const aliases = new Map<string, TrustSubjectIdentifierV1>();

  for (const raw of subject.aliases) {
    const alias = normalizeIdentifier(raw);
    const key = identifierKey(alias);
    if (key !== identifierKey(primary)) aliases.set(key, alias);
  }

  return {
    schema: "TrustSubjectV1",
    primary,
    aliases: [...aliases.entries()]
      .sort(([left], [right]) => compare(left, right))
      .map(([, alias]) => alias),
  };
}

function mergeSubjects(
  observations: readonly TrustObservationV1[]
): TrustSubjectV1 {
  const first = normalizeSubject(observations[0]!.subject_binding.subject);
  const aliases = new Map<string, TrustSubjectIdentifierV1>();

  for (const observation of observations) {
    const subject = normalizeSubject(observation.subject_binding.subject);

    for (const alias of subject.aliases) {
      aliases.set(identifierKey(alias), alias);
    }
  }

  aliases.delete(identifierKey(first.primary));

  return {
    schema: "TrustSubjectV1",
    primary: first.primary,
    aliases: [...aliases.entries()]
      .sort(([left], [right]) => compare(left, right))
      .map(([, alias]) => alias),
  };
}

function normalizeScope(scope: TrustScopeV1): TrustScopeV1 {
  if (scope.schema !== "TrustScopeV1") {
    throw new TypeError("Invalid trust scope.");
  }

  const network = {
    namespace: text(scope.network.namespace),
    id: text(scope.network.id),
  };

  const capability = scope.capability
    ? {
        namespace: text(scope.capability.namespace),
        id: text(scope.capability.id),
        ...(scope.capability.version === undefined
          ? {}
          : { version: text(scope.capability.version) }),
      }
    : undefined;

  return {
    schema: "TrustScopeV1",
    network,
    ...(capability ? { capability } : {}),
    ...(scope.task_class === undefined
      ? {}
      : { task_class: text(scope.task_class) }),
  };
}

function normalizeObservation(
  observation: TrustObservationV1
): TrustObservationV1 {
  if (
    observation.schema !== "TrustObservationV1" ||
    observation.kind !== "execution" ||
    (observation.subject_binding.role !== "requester" &&
      observation.subject_binding.role !== "executor") ||
    observation.subject_binding.schema !== "SubjectBindingV1"
  ) {
    throw new TypeError("Invalid trust observation.");
  }

  return {
    schema: "TrustObservationV1",
    observation_id: text(observation.observation_id),
    event_id: text(observation.event_id),
    kind: observation.kind,
    occurred_at: timestamp(observation.occurred_at),
    subject_binding: {
      schema: "SubjectBindingV1",
      subject: normalizeSubject(observation.subject_binding.subject),
      role: observation.subject_binding.role,
      method: text(observation.subject_binding.method),
      evidence_refs: refs(observation.subject_binding.evidence_refs),
    },
    scope: normalizeScope(observation.scope),
    evidence_refs: refs(observation.evidence_refs),
  };
}

function normalizePolicy(
  policy: EvidenceQualificationPolicyV1
): EvidenceQualificationPolicyV1 {
  if (
    policy.schema !== "EvidenceQualificationPolicyV1" ||
    !policy.allowed_observation_kinds.length ||
    !policy.required_claims.length
  ) {
    throw new TypeError("Invalid qualification policy.");
  }

  const kinds = [...policy.allowed_observation_kinds].sort(compare);
  const claims = [...policy.required_claims].sort(compare);

  if (
    new Set(kinds).size !== kinds.length ||
    new Set(claims).size !== claims.length
  ) {
    throw new TypeError("Duplicate qualification policy values.");
  }

  return {
    schema: "EvidenceQualificationPolicyV1",
    policy_id: text(policy.policy_id),
    policy_version: text(policy.policy_version),
    allowed_observation_kinds: kinds,
    required_claims: claims,
  };
}

function normalizeClaimDecision(
  decision: QualificationClaimDecisionV1
): QualificationClaimDecisionV1 {
  return {
    claim: decision.claim,
    status: decision.status,
    reason_code: decision.reason_code,
  };
}

function normalizeDecision(
  decision: ObservationQualificationDecisionV1
): ObservationQualificationDecisionV1 {
  const claims = decision.claims
    .map(normalizeClaimDecision)
    .sort((left, right) => compare(left.claim, right.claim));

  if (new Set(claims.map((claim) => claim.claim)).size !== claims.length) {
    throw new TypeError("Duplicate qualification claim decision.");
  }

  return {
    observation_id: text(decision.observation_id),
    status: decision.status,
    reason_code: decision.reason_code,
    claims,
  };
}

function normalizeGroups(
  groups: readonly ObservationEquivalenceGroupV1[]
): readonly ObservationEquivalenceGroupV1[] {
  return groups
    .map((group) => {
      const observationIds = refs(group.observation_ids);
      if (!observationIds.length) {
        throw new TypeError("Empty equivalence group.");
      }
      return { observation_ids: observationIds };
    })
    .sort((left, right) =>
      compare(left.observation_ids[0]!, right.observation_ids[0]!)
    );
}

function validCount(value: number | null): boolean {
  return value === null || (Number.isSafeInteger(value) && value >= 0);
}

function normalizePopulation(
  population: PopulationStatementV1
): PopulationStatementV1 {
  if (
    population.schema !== "PopulationStatementV1" ||
    !validCount(population.eligible_events) ||
    !validCount(population.observed_events) ||
    !validCount(population.projected_observations) ||
    !validCount(population.qualified_observations) ||
    !validCount(population.excluded_observations) ||
    !validCount(population.unavailable_observations) ||
    !validCount(population.failed_observations) ||
    !validCount(population.qualified_equivalence_groups) ||
    !validCount(population.collapsed_observations)
  ) {
    throw new TypeError("Invalid population statement.");
  }

  if (
    (population.basis === "provider_complete" &&
      (population.eligible_events === null ||
        population.observed_events === null ||
        population.observed_events > population.eligible_events)) ||
    (population.basis === "submitted_sample" &&
      (population.eligible_events !== null ||
        population.observed_events === null)) ||
    (population.basis === "unknown" &&
      (population.eligible_events !== null ||
        population.observed_events !== null))
  ) {
    throw new TypeError("Invalid population basis.");
  }

  return {
    ...population,
    method: text(population.method),
    evidence_refs: refs(population.evidence_refs),
  };
}

function normalizeWindow(
  window: TrustEvaluationWindowV1
): TrustEvaluationWindowV1 {
  if (window.schema !== "TrustEvaluationWindowV1") {
    throw new TypeError("Invalid evaluation window.");
  }

  return {
    schema: "TrustEvaluationWindowV1",
    effective_at: timestamp(window.effective_at),
    window_start: timestamp(window.window_start),
    window_end: timestamp(window.window_end),
  };
}

function sameContext(
  left: TrustObservationV1,
  right: TrustObservationV1
): boolean {
  const leftSubject = left.subject_binding.subject.primary;
  const rightSubject = right.subject_binding.subject.primary;

  return (
    left.kind === right.kind &&
    left.subject_binding.role === right.subject_binding.role &&
    identifierKey(leftSubject) === identifierKey(rightSubject) &&
    JSON.stringify(left.scope) === JSON.stringify(right.scope)
  );
}

function mergeState(
  current: EvidenceCorrelationStateV1 | undefined,
  next: EvidenceCorrelationStateV1
): EvidenceCorrelationStateV1 {
  if (!current || current === "unknown") return next;
  if (next === "unknown" || next === current) return current;
  throw new TypeError("Conflicting lineage state.");
}

function normalizeQualifiedLineage(
  lineage: EvidenceLineageV1,
  qualifiedIds: ReadonlySet<string>
): QualifiedLineageV1 {
  const relations = new Map<
    string,
    {
      left: string;
      right: string;
      state: EvidenceCorrelationStateV1;
      methods: Set<string>;
      evidenceRefs: Set<string>;
    }
  >();

  for (const relation of lineage.relations) {
    const left = text(relation.left_observation_id);
    const right = text(relation.right_observation_id);

    if (!qualifiedIds.has(left) || !qualifiedIds.has(right)) continue;

    const [canonicalLeft, canonicalRight] =
      left < right ? [left, right] : [right, left];

    const key = `${canonicalLeft}\0${canonicalRight}`;
    const existing = relations.get(key);
    const state = mergeState(existing?.state, relation.state);

    if (existing) {
      existing.state = state;
      existing.methods.add(text(relation.method));
      for (const ref of refs(relation.evidence_refs)) {
        existing.evidenceRefs.add(ref);
      }
    } else {
      relations.set(key, {
        left: canonicalLeft,
        right: canonicalRight,
        state,
        methods: new Set([text(relation.method)]),
        evidenceRefs: new Set(refs(relation.evidence_refs)),
      });
    }
  }

  return {
    schema: "QualifiedLineageV1",
    default_state: "unknown",
    relations: [...relations.values()]
      .map((relation) => ({
        left_observation_id: relation.left,
        right_observation_id: relation.right,
        state: relation.state,
        methods: [...relation.methods].sort(compare),
        evidence_refs: [...relation.evidenceRefs].sort(compare),
      }))
      .sort((left, right) => {
        const leftKey =
          `${left.left_observation_id}\0${left.right_observation_id}`;
        const rightKey =
          `${right.left_observation_id}\0${right.right_observation_id}`;
        return compare(leftKey, rightKey);
      }),
  };
}

function digest(domainSeparator: string, value: unknown): TrustDigestV1 {
  return {
    canonicalization: "RFC8785-JCS",
    digest_algorithm: "SHA3-512",
    domain_separator: domainSeparator,
    hash: computeDomainSeparatedSha3_512V1(domainSeparator, value),
  };
}

export function buildQualifiedEvidenceSnapshotV1(
  input: QualifiedEvidenceSnapshotInputV1
): QualifiedEvidenceSnapshotResultV1 {
  if (!input.observations.length) {
    return { ok: false, code: "NO_OBSERVATIONS" };
  }

  if (!input.qualification.ok) {
    return { ok: false, code: "QUALIFICATION_NOT_AVAILABLE" };
  }

  let observations: readonly TrustObservationV1[];
  let policy: EvidenceQualificationPolicyV1;
  let population: PopulationStatementV1;
  let window: TrustEvaluationWindowV1;

  try {
    observations = input.observations
      .map(normalizeObservation)
      .sort((left, right) =>
        compare(left.observation_id, right.observation_id)
      );
    policy = normalizePolicy(input.policy);
    population = normalizePopulation(input.population);
    window = normalizeWindow(input.window);
  } catch {
    return { ok: false, code: "INVALID_INPUT" };
  }

  const windowStart = Date.parse(window.window_start);
  const windowEnd = Date.parse(window.window_end);
  const effectiveAt = Date.parse(window.effective_at);

  if (windowStart > windowEnd || windowEnd > effectiveAt) {
    return { ok: false, code: "INVALID_WINDOW" };
  }

  if (observations.slice(1).some((item) => !sameContext(observations[0]!, item))) {
    return { ok: false, code: "MIXED_EVALUATION_CONTEXT" };
  }

  if (
    observations.some((observation) => {
      const occurredAt = Date.parse(observation.occurred_at);
      return occurredAt < windowStart || occurredAt > windowEnd;
    })
  ) {
    return { ok: false, code: "OBSERVATION_OUTSIDE_WINDOW" };
  }

  if (
    input.qualification.policy_id !== policy.policy_id ||
    input.qualification.policy_version !== policy.policy_version
  ) {
    return { ok: false, code: "QUALIFICATION_POLICY_MISMATCH" };
  }

  const observationIds = new Set(
    observations.map((observation) => observation.observation_id)
  );

  let decisions: readonly ObservationQualificationDecisionV1[];
  let equivalenceGroups: readonly ObservationEquivalenceGroupV1[];

  try {
    decisions = input.qualification.decisions
      .map(normalizeDecision)
      .sort((left, right) =>
        compare(left.observation_id, right.observation_id)
      );
    equivalenceGroups = normalizeGroups(
      input.qualification.equivalence_groups
    );
  } catch {
    return { ok: false, code: "QUALIFICATION_MISMATCH" };
  }

  const decisionIds = new Set(
    decisions.map((decision) => decision.observation_id)
  );

  if (
    observationIds.size !== observations.length ||
    decisionIds.size !== decisions.length ||
    observationIds.size !== decisionIds.size ||
    [...observationIds].some((id) => !decisionIds.has(id))
  ) {
    return { ok: false, code: "QUALIFICATION_MISMATCH" };
  }

  const qualifiedIds = new Set(
    decisions
      .filter((decision) => decision.status === "qualified")
      .map((decision) => decision.observation_id)
  );

  const groupedIds = equivalenceGroups.flatMap(
    (group) => group.observation_ids
  );

  if (
    new Set(groupedIds).size !== groupedIds.length ||
    groupedIds.length !== qualifiedIds.size ||
    [...qualifiedIds].some((id) => !groupedIds.includes(id))
  ) {
    return { ok: false, code: "QUALIFICATION_MISMATCH" };
  }

  const qualifiedObservations = observations.filter((observation) =>
    qualifiedIds.has(observation.observation_id)
  );

  const qualifiedLineageInput: EvidenceLineageV1 = {
    schema: "EvidenceLineageV1",
    relations: input.lineage.relations.filter(
      (relation) =>
        qualifiedIds.has(relation.left_observation_id.trim()) &&
        qualifiedIds.has(relation.right_observation_id.trim())
    ),
  };

  const grouping = groupTrustObservationsV1(
    qualifiedObservations,
    qualifiedLineageInput
  );

  if (!grouping.ok) {
    return { ok: false, code: "LINEAGE_MISMATCH" };
  }

  const recomputedGroups = normalizeGroups(grouping.equivalence_groups);

  if (JSON.stringify(recomputedGroups) !== JSON.stringify(equivalenceGroups)) {
    return { ok: false, code: "LINEAGE_MISMATCH" };
  }

  const count = (status: ObservationQualificationDecisionV1["status"]) =>
    decisions.filter((decision) => decision.status === status).length;

  if (
    population.projected_observations !== observations.length ||
    population.qualified_observations !== count("qualified") ||
    population.excluded_observations !== count("excluded") ||
    population.unavailable_observations !== count("unavailable") ||
    population.failed_observations !== count("failed") ||
    population.qualified_equivalence_groups !== equivalenceGroups.length ||
    population.collapsed_observations !==
      count("qualified") - equivalenceGroups.length
  ) {
    return { ok: false, code: "POPULATION_MISMATCH" };
  }

  let policyDigest: TrustDigestV1;
  let qualifiedLineage: QualifiedLineageV1;

  try {
    policyDigest = digest(
      QUALIFICATION_POLICY_DOMAIN_SEPARATOR_V1,
      policy
    );
    qualifiedLineage = normalizeQualifiedLineage(
      input.lineage,
      qualifiedIds
    );
  } catch {
    return { ok: false, code: "CANONICALIZATION_FAILED" };
  }

  const payload: QualifiedEvidenceSnapshotPayloadV1 = {
    subject: mergeSubjects(observations),
    role: observations[0]!.subject_binding.role,
    scope: observations[0]!.scope,
    window,
    qualification_policy: {
      policy,
      digest: policyDigest,
    },
    qualified_observations: qualifiedObservations,
    qualification_decisions: decisions,
    equivalence_groups: equivalenceGroups,
    qualified_lineage: qualifiedLineage,
    population,
  };

  try {
    return {
      ok: true,
      snapshot: {
        schema: "QualifiedEvidenceSnapshotV1",
        payload,
        digest: digest(
          QUALIFIED_EVIDENCE_SNAPSHOT_DOMAIN_SEPARATOR_V1,
          {
            schema: "QualifiedEvidenceSnapshotV1",
            payload,
          }
        ),
      },
    };
  } catch {
    return { ok: false, code: "CANONICALIZATION_FAILED" };
  }
}