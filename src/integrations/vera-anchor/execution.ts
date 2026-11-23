// ============================================================================
// File: src/integrations/vera-anchor/execution.ts
// Purpose:
//   Project supported Vera Anchor public completed-execution evidence into
//   normalized trust observations without performing trust qualification.
// ============================================================================

import type {
  TrustObservationV1,
  TrustSubjectIdentifierV1,
  TrustSubjectRoleV1,
} from "../../contracts.js";

export const SUPPORTED_VERA_ANCHOR_EXECUTION_CONTRACT_VERSIONS =
  Object.freeze(["1.0.0"] as const);

export type VeraAnchorExecutionProjectionFailureCodeV1 =
  | "EVIDENCE_UNAVAILABLE"
  | "UNSUPPORTED_CONTRACT_VERSION"
  | "UNSUPPORTED_EXECUTION_STATE"
  | "MALFORMED_EVIDENCE"
  | "EXECUTION_SCOPE_MISMATCH"
  | "SUBJECT_BINDING_MISMATCH";

export type VeraAnchorExecutionProjectionResultV1 =
  | Readonly<{
      ok: true;
      observation: TrustObservationV1;
    }>
  | Readonly<{
      ok: false;
      code: VeraAnchorExecutionProjectionFailureCodeV1;
      field?: string;
    }>;

type ObjectValue = Record<string, unknown>;

const MAX_TEXT_LENGTH = 8192;

function asObject(value: unknown): ObjectValue | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as ObjectValue)
    : null;
}

function asText(value: unknown): string | null {
  if (typeof value !== "string") return null;

  const text = value.trim();
  return text && text.length <= MAX_TEXT_LENGTH ? text : null;
}

function fail(
  code: VeraAnchorExecutionProjectionFailureCodeV1,
  field?: string
): VeraAnchorExecutionProjectionResultV1 {
  return field ? { ok: false, code, field } : { ok: false, code };
}

function evidenceRef(kind: string, id: string): string {
  return `vera-anchor:${kind}:${id}`;
}

export function projectVeraAnchorCompletedExecutionObservationV1(
  input: unknown,
  role: TrustSubjectRoleV1
): VeraAnchorExecutionProjectionResultV1 {
  const evidence = asObject(input);
  if (!evidence) return fail("MALFORMED_EVIDENCE");

  if (evidence.available === false) return fail("EVIDENCE_UNAVAILABLE");
  if (evidence.available !== true) {
    return fail("MALFORMED_EVIDENCE", "available");
  }

  const contractVersion = asText(evidence.contract_version);
  if (!contractVersion) {
    return fail("MALFORMED_EVIDENCE", "contract_version");
  }
  if (
    !SUPPORTED_VERA_ANCHOR_EXECUTION_CONTRACT_VERSIONS.some(
      (version) => version === contractVersion
    )
  ) {
    return fail("UNSUPPORTED_CONTRACT_VERSION", "contract_version");
  }

  const execution = asObject(evidence.execution);
  const agents = asObject(evidence.agents);
  const capability = asObject(evidence.capability);
  const binding = asObject(evidence.binding);
  const acceptance = asObject(evidence.acceptance);
  const resultEvidence = asObject(evidence.result_evidence);

  if (!execution) return fail("MALFORMED_EVIDENCE", "execution");
  if (!agents) return fail("MALFORMED_EVIDENCE", "agents");
  if (!capability) return fail("MALFORMED_EVIDENCE", "capability");
  if (!binding) return fail("MALFORMED_EVIDENCE", "binding");
  if (!acceptance) return fail("MALFORMED_EVIDENCE", "acceptance");
  if (!resultEvidence) {
    return fail("MALFORMED_EVIDENCE", "result_evidence");
  }

  const jobId = asText(execution.job_id);
  const resultId = asText(execution.result_id);
  const network = asText(execution.hedera_network);
  const status = asText(execution.status);

  if (!jobId) return fail("MALFORMED_EVIDENCE", "execution.job_id");
  if (!resultId) return fail("MALFORMED_EVIDENCE", "execution.result_id");
  if (!network) {
    return fail("MALFORMED_EVIDENCE", "execution.hedera_network");
  }
  if (status !== "completed") {
    return fail("UNSUPPORTED_EXECUTION_STATE", "execution.status");
  }

  const agent = asObject(agents[role]);
  if (!agent) return fail("MALFORMED_EVIDENCE", `agents.${role}`);

  const logicalId = asText(agent.logical_id);
  const uaid = asText(agent.hcs14_uaid);
  const did = asText(agent.base_did);

  if (!logicalId) {
    return fail("MALFORMED_EVIDENCE", `agents.${role}.logical_id`);
  }
  if (!uaid) {
    return fail("MALFORMED_EVIDENCE", `agents.${role}.hcs14_uaid`);
  }

  const bindingId = asText(binding.id);
  if (!bindingId) return fail("MALFORMED_EVIDENCE", "binding.id");
  if (asText(binding.schema) !== "ExecutionBindingV1") {
    return fail("MALFORMED_EVIDENCE", "binding.schema");
  }

  const bindingPayload = asObject(binding.digest_payload);
  const boundExecution = asObject(bindingPayload?.execution);
  const boundAgent = asObject(bindingPayload?.[role]);

  if (!bindingPayload || !boundExecution || !boundAgent) {
    return fail("MALFORMED_EVIDENCE", "binding.digest_payload");
  }
  if (
    asText(boundExecution.job_id) !== jobId ||
    asText(boundExecution.hedera_network) !== network
  ) {
    return fail(
      "EXECUTION_SCOPE_MISMATCH",
      "binding.digest_payload.execution"
    );
  }
  if (
    asText(boundAgent.logical_agent) !== logicalId ||
    asText(boundAgent.hcs14_uaid) !== uaid
  ) {
    return fail(
      "SUBJECT_BINDING_MISMATCH",
      `binding.digest_payload.${role}`
    );
  }

  const acceptanceId = asText(acceptance.id);
  if (!acceptanceId) return fail("MALFORMED_EVIDENCE", "acceptance.id");
  if (asText(acceptance.schema) !== "ExecutionAcceptanceV1") {
    return fail("MALFORMED_EVIDENCE", "acceptance.schema");
  }

  const resultEvidenceId = asText(resultEvidence.id);
  const sealedAt = asText(resultEvidence.sealed_at);

  if (!resultEvidenceId) {
    return fail("MALFORMED_EVIDENCE", "result_evidence.id");
  }
  if (asText(resultEvidence.schema) !== "ResultEvidenceV1") {
    return fail("MALFORMED_EVIDENCE", "result_evidence.schema");
  }
  if (asText(resultEvidence.result_id) !== resultId) {
    return fail("EXECUTION_SCOPE_MISMATCH", "result_evidence.result_id");
  }
  if (!sealedAt) {
    return fail("MALFORMED_EVIDENCE", "result_evidence.sealed_at");
  }

  const capabilityStandard = asText(capability.standard);
  const capabilityTopic = asText(capability.discovery_registry_topic_id);
  const skillUid = asText(capability.skill_uid);
  const skillVersion = asText(capability.skill_version);

  if (
    capabilityStandard !== "HCS-26" ||
    !capabilityTopic ||
    !skillUid ||
    !skillVersion
  ) {
    return fail("MALFORMED_EVIDENCE", "capability");
  }

  const aliases: TrustSubjectIdentifierV1[] = [];
  if (did) aliases.push({ scheme: "did", value: did });
  aliases.push({
    scheme: "native",
    value: logicalId,
    registry: "vera-anchor",
  });

  const eventId = `vera-anchor:execution:${network}:${jobId}`;

  return {
    ok: true,
    observation: {
      schema: "TrustObservationV1",
      observation_id: `${eventId}:${role}`,
      event_id: eventId,
      kind: "execution",
      occurred_at: sealedAt,
      subject_binding: {
        schema: "SubjectBindingV1",
        subject: {
          schema: "TrustSubjectV1",
          primary: {
            scheme: "hcs14_uaid",
            value: uaid,
          },
          aliases,
        },
        role,
        method: "vera-anchor.execution-binding.hcs14-uaid.v1",
        evidence_refs: [evidenceRef("execution-binding", bindingId)],
      },
      scope: {
        schema: "TrustScopeV1",
        network: {
          namespace: "hedera",
          id: network,
        },
        capability: {
          namespace: "hcs26",
          id: `${capabilityTopic}:${skillUid}`,
          version: skillVersion,
        },
      },
      evidence_refs: [
        evidenceRef("execution-binding", bindingId),
        evidenceRef("execution-acceptance", acceptanceId),
        evidenceRef("result-evidence", resultEvidenceId),
      ],
    },
  };
}