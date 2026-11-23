// ============================================================================
// File: src/population.ts
// Purpose:
//   Deterministically account for population basis and qualification outcomes.
// ============================================================================

import type {
  PopulationDeclarationV1,
  PopulationStatementV1,
  TrustObservationV1,
} from "./contracts.js";

import type { QualificationResultV1 } from "./qualification.js";

export type PopulationAccountingFailureCodeV1 =
  | "INVALID_POPULATION_DECLARATION"
  | "QUALIFICATION_NOT_AVAILABLE"
  | "QUALIFICATION_MISMATCH"
  | "MIXED_EVALUATION_CONTEXT";

export type PopulationAccountingResultV1 =
  | Readonly<{
      ok: true;
      population: PopulationStatementV1;
    }>
  | Readonly<{
      ok: false;
      code: PopulationAccountingFailureCodeV1;
    }>;

function validCount(value: number | null): boolean {
  return value === null || (Number.isSafeInteger(value) && value >= 0);
}

function validRefs(refs: readonly string[]): boolean {
  return refs.every((ref) => ref.trim().length > 0);
}

function validDeclaration(declaration: PopulationDeclarationV1): boolean {
  if (
    declaration.schema !== "PopulationDeclarationV1" ||
    !declaration.method.trim() ||
    !validRefs(declaration.evidence_refs) ||
    !validCount(declaration.eligible_events) ||
    !validCount(declaration.observed_events)
  ) {
    return false;
  }

  if (declaration.basis === "provider_complete") {
    return (
      declaration.eligible_events !== null &&
      declaration.observed_events !== null &&
      declaration.observed_events <= declaration.eligible_events
    );
  }

  if (declaration.basis === "submitted_sample") {
    return (
      declaration.eligible_events === null &&
      declaration.observed_events !== null
    );
  }

  return (
    declaration.basis === "unknown" &&
    declaration.eligible_events === null &&
    declaration.observed_events === null
  );
}

function sameOptional(left: string | undefined, right: string | undefined) {
  return (left ?? "") === (right ?? "");
}

function sameContext(
  left: TrustObservationV1,
  right: TrustObservationV1
): boolean {
  const leftSubject = left.subject_binding.subject.primary;
  const rightSubject = right.subject_binding.subject.primary;
  const leftCapability = left.scope.capability;
  const rightCapability = right.scope.capability;

  return (
    left.kind === right.kind &&
    left.subject_binding.role === right.subject_binding.role &&
    leftSubject.scheme === rightSubject.scheme &&
    leftSubject.value === rightSubject.value &&
    sameOptional(leftSubject.registry, rightSubject.registry) &&
    left.scope.network.namespace === right.scope.network.namespace &&
    left.scope.network.id === right.scope.network.id &&
    sameOptional(left.scope.task_class, right.scope.task_class) &&
    leftCapability?.namespace === rightCapability?.namespace &&
    leftCapability?.id === rightCapability?.id &&
    sameOptional(leftCapability?.version, rightCapability?.version)
  );
}

export function buildPopulationStatementV1(
  observations: readonly TrustObservationV1[],
  qualification: QualificationResultV1,
  declaration: PopulationDeclarationV1
): PopulationAccountingResultV1 {
  if (!validDeclaration(declaration)) {
    return { ok: false, code: "INVALID_POPULATION_DECLARATION" };
  }

  if (!qualification.ok) {
    return { ok: false, code: "QUALIFICATION_NOT_AVAILABLE" };
  }

  if (
    observations.length > 1 &&
    observations
      .slice(1)
      .some((observation) => !sameContext(observations[0]!, observation))
  ) {
    return { ok: false, code: "MIXED_EVALUATION_CONTEXT" };
  }

  const observationIds = new Set(
    observations.map((observation) => observation.observation_id)
  );
  const decisionIds = new Set(
    qualification.decisions.map((decision) => decision.observation_id)
  );

  if (
    observationIds.size !== observations.length ||
    decisionIds.size !== qualification.decisions.length ||
    observationIds.size !== decisionIds.size ||
    [...observationIds].some((id) => !decisionIds.has(id))
  ) {
    return { ok: false, code: "QUALIFICATION_MISMATCH" };
  }

  const qualifiedIds = new Set(
    qualification.decisions
      .filter((decision) => decision.status === "qualified")
      .map((decision) => decision.observation_id)
  );

  const groupedIds = qualification.equivalence_groups.flatMap(
    (group) => group.observation_ids
  );
  const groupedIdSet = new Set(groupedIds);

  if (
    groupedIdSet.size !== groupedIds.length ||
    groupedIdSet.size !== qualifiedIds.size ||
    [...qualifiedIds].some((id) => !groupedIdSet.has(id))
  ) {
    return { ok: false, code: "QUALIFICATION_MISMATCH" };
  }

  const count = (status: string) =>
    qualification.decisions.filter(
      (decision) => decision.status === status
    ).length;

  const qualified = count("qualified");
  const groups = qualification.equivalence_groups.length;

  return {
    ok: true,
    population: {
      schema: "PopulationStatementV1",
      basis: declaration.basis,
      eligible_events: declaration.eligible_events,
      observed_events: declaration.observed_events,
      projected_observations: observations.length,
      qualified_observations: qualified,
      excluded_observations: count("excluded"),
      unavailable_observations: count("unavailable"),
      failed_observations: count("failed"),
      qualified_equivalence_groups: groups,
      collapsed_observations: qualified - groups,
      method: declaration.method,
      evidence_refs: declaration.evidence_refs,
    },
  };
}