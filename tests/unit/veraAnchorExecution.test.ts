import { describe, expect, it } from "vitest";

import { projectVeraAnchorCompletedExecutionObservationV1 } from "../../src/vera-anchor.js";

const JOB_ID = "dc5904d8-e84d-597a-abb4-93b915f3a182";
const RESULT_ID = "6cb2fb13-b225-54bb-b8d1-b096faab09e7";

function fixture() {
  return {
    available: true,
    contract_version: "1.0.0",
    execution: {
      job_id: JOB_ID,
      result_id: RESULT_ID,
      program: "sage",
      status: "completed",
      hedera_network: "mainnet",
    },
    agents: {
      requester: {
        logical_id: "sage",
        base_did: "did:web:veraanchor.com:agents:sage",
        hcs14_uaid: "uaid:did:veraanchor.com:agents:sage;uid=sage",
      },
      executor: {
        logical_id: "global-compute",
        base_did: "did:web:veraanchor.com:agents:global-compute",
        hcs14_uaid:
          "uaid:did:veraanchor.com:agents:global-compute;uid=global-compute",
      },
    },
    capability: {
      standard: "HCS-26",
      discovery_registry_topic_id: "0.0.10924592",
      skill_uid: "1",
      skill_version: "1.0.2",
    },
    binding: {
      id: "8cd9065c-3c7c-48e1-ac69-941dd411ee44",
      schema: "ExecutionBindingV1",
      digest_payload: {
        execution: {
          job_id: JOB_ID,
          hedera_network: "mainnet",
        },
        requester: {
          logical_agent: "sage",
          hcs14_uaid: "uaid:did:veraanchor.com:agents:sage;uid=sage",
        },
        executor: {
          logical_agent: "global-compute",
          hcs14_uaid:
            "uaid:did:veraanchor.com:agents:global-compute;uid=global-compute",
        },
      },
    },
    acceptance: {
      id: "73728ce2-b397-4304-8b48-0456a48ae6d3",
      schema: "ExecutionAcceptanceV1",
      state: "confirmed",
    },
    result_evidence: {
      id: "9a57b178-1d1c-459a-9a29-dcdf72ca7956",
      result_id: RESULT_ID,
      schema: "ResultEvidenceV1",
      artifact_count: 25,
      sealed_at: "2026-11-21T19:01:26.905Z",
    },
  };
}

describe("Vera Anchor completed execution projection", () => {
  it("projects one execution into one executor observation", () => {
    const result = projectVeraAnchorCompletedExecutionObservationV1(
      fixture(),
      "executor"
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.observation.event_id).toBe(
      `vera-anchor:execution:mainnet:${JOB_ID}`
    );
    expect(result.observation.subject_binding.role).toBe("executor");
    expect(result.observation.evidence_refs).toHaveLength(3);
  });

  it("does not turn artifact multiplicity into observation multiplicity", () => {
    const evidence = fixture();
    evidence.result_evidence.artifact_count = 2500;

    const result = projectVeraAnchorCompletedExecutionObservationV1(
      evidence,
      "executor"
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect([result.observation]).toHaveLength(1);
    expect(result.observation.evidence_refs).toHaveLength(3);
  });

  it("keeps requester and executor projections on the same event", () => {
    const evidence = fixture();

    const requester = projectVeraAnchorCompletedExecutionObservationV1(
      evidence,
      "requester"
    );
    const executor = projectVeraAnchorCompletedExecutionObservationV1(
      evidence,
      "executor"
    );

    expect(requester.ok).toBe(true);
    expect(executor.ok).toBe(true);
    if (!requester.ok || !executor.ok) return;

    expect(requester.observation.event_id).toBe(
      executor.observation.event_id
    );
    expect(requester.observation.observation_id).not.toBe(
      executor.observation.observation_id
    );
  });

  it("fails closed on inconsistent subject binding material", () => {
    const evidence = fixture();

    evidence.binding.digest_payload.executor.hcs14_uaid =
      "uaid:did:example.com:agents:spoofed";

    const result = projectVeraAnchorCompletedExecutionObservationV1(
      evidence,
      "executor"
    );

    expect(result).toEqual({
      ok: false,
      code: "SUBJECT_BINDING_MISMATCH",
      field: "binding.digest_payload.executor",
    });
  });

  it("does not treat acceptance state as qualification policy", () => {
    const evidence = fixture();
    evidence.acceptance.state = "pending";

    const result = projectVeraAnchorCompletedExecutionObservationV1(
      evidence,
      "executor"
    );

    expect(result.ok).toBe(true);
  });

  it("returns unavailable rather than a negative observation", () => {
    const evidence = fixture();
    evidence.available = false;

    const result = projectVeraAnchorCompletedExecutionObservationV1(
      evidence,
      "executor"
    );

    expect(result).toEqual({
      ok: false,
      code: "EVIDENCE_UNAVAILABLE",
    });
  });

  it("rejects unsupported public contract versions", () => {
    const evidence = fixture();
    evidence.contract_version = "2.0.0";

    const result = projectVeraAnchorCompletedExecutionObservationV1(
      evidence,
      "executor"
    );

    expect(result).toEqual({
      ok: false,
      code: "UNSUPPORTED_CONTRACT_VERSION",
      field: "contract_version",
    });
  });
});