import { readFileSync } from "node:fs";

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

type ConformanceCase = Readonly<{
  case_id: string;
  description: string;
  input: Readonly<{
    observations: readonly TrustObservationV1[];
    lineage: EvidenceLineageV1;
    findings: readonly QualificationFindingV1[];
    policy: EvidenceQualificationPolicyV1;
    population_declaration: PopulationDeclarationV1;
    window: TrustEvaluationWindowV1;
  }>;
  expected: Readonly<{
    qualification: Readonly<{
      ok: boolean;
      code?: string;
      statuses?: Readonly<Record<string, string>>;
      equivalence_groups?: readonly (readonly string[])[];
    }>;
    population?: Readonly<{
      ok: boolean;
      basis: string;
      eligible_events: number | null;
      observed_events: number | null;
      qualified_observations: number;
      qualified_equivalence_groups: number;
      collapsed_observations: number;
    }>;
    snapshot?: Readonly<{
      ok: boolean;
      lineage_default_state: string;
      digest?: string;
    }>;
  }>;
}>;

type ConformanceCorpus = Readonly<{
  schema: "VeraAnchorTrustConformanceCorpusV1";
  version: string;
  cases: readonly ConformanceCase[];
}>;

const corpus = JSON.parse(
  readFileSync(
    new URL("../../conformance/v1/cases.json", import.meta.url),
    "utf8"
  )
) as ConformanceCorpus;

describe("trust conformance corpus v1", () => {
  it("has the expected corpus identity and unique case ids", () => {
    expect(corpus.schema).toBe("VeraAnchorTrustConformanceCorpusV1");
    expect(corpus.version).toBe("1.0.0");
    expect(new Set(corpus.cases.map((item) => item.case_id)).size).toBe(
      corpus.cases.length
    );
  });

  for (const testCase of corpus.cases) {
    it(`${testCase.case_id}: ${testCase.description}`, () => {
      const { input, expected } = testCase;

      const qualification = qualifyTrustObservationsV1(
        input.observations,
        input.lineage,
        input.findings,
        input.policy
      );

      expect(qualification.ok).toBe(expected.qualification.ok);

      if (!expected.qualification.ok) {
        expect(qualification).toMatchObject({
          ok: false,
          code: expected.qualification.code,
        });
        return;
      }

      expect(qualification.ok).toBe(true);
      if (!qualification.ok) return;

      const statuses = Object.fromEntries(
        qualification.decisions.map((decision) => [
          decision.observation_id,
          decision.status,
        ])
      );

      expect(statuses).toEqual(expected.qualification.statuses);
      expect(
        qualification.equivalence_groups.map(
          (group) => group.observation_ids
        )
      ).toEqual(expected.qualification.equivalence_groups);

      const population = buildPopulationStatementV1(
        input.observations,
        qualification,
        input.population_declaration
      );

      expect(population.ok).toBe(expected.population?.ok ?? false);
      if (!population.ok || !expected.population) return;

      expect(population.population).toMatchObject({
        basis: expected.population.basis,
        eligible_events: expected.population.eligible_events,
        observed_events: expected.population.observed_events,
        qualified_observations:
          expected.population.qualified_observations,
        qualified_equivalence_groups:
          expected.population.qualified_equivalence_groups,
        collapsed_observations:
          expected.population.collapsed_observations,
      });

      const snapshot = buildQualifiedEvidenceSnapshotV1({
        observations: input.observations,
        lineage: input.lineage,
        policy: input.policy,
        qualification,
        population: population.population,
        window: input.window,
      });

      expect(snapshot.ok).toBe(expected.snapshot?.ok ?? false);
      if (!snapshot.ok || !expected.snapshot) return;

      expect(
        snapshot.snapshot.payload.qualified_lineage.default_state
      ).toBe(expected.snapshot.lineage_default_state);

      if (expected.snapshot.digest) {
        expect(snapshot.snapshot.digest.hash).toBe(
          expected.snapshot.digest
        );
      }
    });
  }
});