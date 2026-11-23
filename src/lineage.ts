// ============================================================================
// File: src/lineage.ts
// Purpose:
//   Deterministically group observations using admitted lineage relations.
// ============================================================================

import type {
  EvidenceCorrelationStateV1,
  EvidenceLineageV1,
  TrustObservationV1,
} from "./contracts.js";

export type ObservationGroupV1 = Readonly<{
  observation_ids: readonly string[];
}>;

export type ObservationGroupingFailureCodeV1 =
  | "INVALID_OBSERVATION"
  | "DUPLICATE_OBSERVATION_ID"
  | "UNKNOWN_OBSERVATION_REFERENCE"
  | "SELF_LINEAGE_RELATION"
  | "LINEAGE_RELATION_CONFLICT"
  | "LINEAGE_CONTRADICTION";

export type ObservationGroupingResultV1 =
  | Readonly<{
      ok: true;
      groups: readonly ObservationGroupV1[];
    }>
  | Readonly<{
      ok: false;
      code: ObservationGroupingFailureCodeV1;
      observation_ids?: readonly string[];
    }>;

function pair(left: string, right: string): readonly [string, string] {
  return left < right ? [left, right] : [right, left];
}

function pairKey(left: string, right: string): string {
  return JSON.stringify(pair(left, right));
}

function mergeState(
  current: EvidenceCorrelationStateV1 | undefined,
  next: EvidenceCorrelationStateV1
): EvidenceCorrelationStateV1 | null {
  if (!current || current === "unknown") return next;
  if (next === "unknown" || current === next) return current;
  return null;
}

export function groupTrustObservationsV1(
  observations: readonly TrustObservationV1[],
  lineage: EvidenceLineageV1
): ObservationGroupingResultV1 {
  const parent = new Map<string, string>();

  for (const observation of observations) {
    const id = observation.observation_id.trim();

    if (!id || !observation.event_id.trim()) {
      return { ok: false, code: "INVALID_OBSERVATION" };
    }
    if (parent.has(id)) {
      return {
        ok: false,
        code: "DUPLICATE_OBSERVATION_ID",
        observation_ids: [id],
      };
    }

    parent.set(id, id);
  }

  function find(id: string): string {
    const current = parent.get(id);
    if (!current || current === id) return id;

    const root = find(current);
    parent.set(id, root);
    return root;
  }

  function union(left: string, right: string): void {
    const leftRoot = find(left);
    const rightRoot = find(right);

    if (leftRoot === rightRoot) return;

    if (leftRoot < rightRoot) {
      parent.set(rightRoot, leftRoot);
    } else {
      parent.set(leftRoot, rightRoot);
    }
  }

  const relations = new Map<
    string,
    Readonly<{
      left: string;
      right: string;
      state: EvidenceCorrelationStateV1;
    }>
  >();

  for (const relation of lineage.relations) {
    const left = relation.left_observation_id.trim();
    const right = relation.right_observation_id.trim();

    if (!parent.has(left) || !parent.has(right)) {
      return {
        ok: false,
        code: "UNKNOWN_OBSERVATION_REFERENCE",
        observation_ids: [left, right],
      };
    }
    if (left === right) {
      return {
        ok: false,
        code: "SELF_LINEAGE_RELATION",
        observation_ids: [left],
      };
    }

    const [canonicalLeft, canonicalRight] = pair(left, right);
    const key = pairKey(canonicalLeft, canonicalRight);
    const existing = relations.get(key);
    const state = mergeState(existing?.state, relation.state);

    if (!state) {
      return {
        ok: false,
        code: "LINEAGE_RELATION_CONFLICT",
        observation_ids: [canonicalLeft, canonicalRight],
      };
    }

    relations.set(key, {
      left: canonicalLeft,
      right: canonicalRight,
      state,
    });
  }

  for (const relation of relations.values()) {
    if (relation.state === "proven_same") {
      union(relation.left, relation.right);
    }
  }

  for (const relation of relations.values()) {
    if (
      relation.state === "proven_different" &&
      find(relation.left) === find(relation.right)
    ) {
      return {
        ok: false,
        code: "LINEAGE_CONTRADICTION",
        observation_ids: [relation.left, relation.right],
      };
    }
  }

  const grouped = new Map<string, string[]>();

  for (const id of [...parent.keys()].sort()) {
    const root = find(id);
    const group = grouped.get(root);

    if (group) {
      group.push(id);
    } else {
      grouped.set(root, [id]);
    }
  }

  const groups = [...grouped.values()]
    .map((observationIds) => ({
      observation_ids: observationIds.sort(),
    }))
    .sort((left, right) =>
      left.observation_ids[0]!.localeCompare(right.observation_ids[0]!)
    );

  return { ok: true, groups };
}