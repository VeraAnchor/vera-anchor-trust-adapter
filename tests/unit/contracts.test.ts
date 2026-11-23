import { describe, expect, it } from "vitest";

import type { TrustObservationV1 } from "../../src/contracts.js";

const SAGE_EXECUTION_OBSERVATION = {
  schema: "TrustObservationV1",
  observation_id: "va:trust-observation:sage-execution:1",
  event_id: "va:execution:dc5904d8-e84d-597a-abb4-93b915f3a182",
  kind: "execution",
  occurred_at: "2026-11-21T19:01:26.905Z",
  subject_binding: {
    schema: "SubjectBindingV1",
    subject: {
      schema: "TrustSubjectV1",
      primary: {
        scheme: "hcs14_uaid",
        value:
          "uaid:did:veraanchor.com:agents:global-compute;uid=global-compute",
      },
      aliases: [
        {
          scheme: "did",
          value: "did:web:veraanchor.com:agents:global-compute",
        },
      ],
    },
    role: "executor",
    method: "vera-anchor.execution-binding.hcs14-uaid.v1",
    evidence_refs: ["va:execution-binding:1"],
  },
  scope: {
    schema: "TrustScopeV1",
    network: {
      namespace: "hedera",
      id: "mainnet",
    },
    capability: {
      namespace: "hcs26",
      id: "0.0.10924592:1",
      version: "1.0.2",
    },
  },
  evidence_refs: [
    "va:execution-binding:1",
    "va:execution-acceptance:1",
    "va:result-evidence:1",
  ],
} as const satisfies TrustObservationV1;

describe("trust contracts", () => {
  it("represents one execution as one observation", () => {
    const observations = [SAGE_EXECUTION_OBSERVATION];

    expect(observations).toHaveLength(1);
    expect(SAGE_EXECUTION_OBSERVATION.kind).toBe("execution");
  });

  it("keeps subject role explicit without embedding qualification state", () => {
    expect(SAGE_EXECUTION_OBSERVATION.subject_binding.role).toBe("executor");
    expect(SAGE_EXECUTION_OBSERVATION.subject_binding).not.toHaveProperty(
      "status"
    );
  });

  it("keeps network and capability references namespaced", () => {
    expect(SAGE_EXECUTION_OBSERVATION.scope.network).toEqual({
      namespace: "hedera",
      id: "mainnet",
    });
    expect(SAGE_EXECUTION_OBSERVATION.scope.capability?.namespace).toBe("hcs26");
  });
});