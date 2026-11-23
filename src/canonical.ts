// ============================================================================
// File: src/canonical.ts
// Purpose:
//   Deterministic canonical JSON and domain-separated SHA3-512 primitives.
// ============================================================================

import { createHash } from "node:crypto";

export const MAX_CANONICAL_JSON_DEPTH_V1 = 64;
export const MAX_CANONICAL_JSON_BYTES_V1 = 16 * 1024 * 1024;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

function assertValidString(value: string, path: string): void {
  for (let i = 0; i < value.length; i += 1) {
    const code = value.charCodeAt(i);

    if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(i + 1);
      if (!(next >= 0xdc00 && next <= 0xdfff)) {
        throw new TypeError(`Unpaired UTF-16 surrogate at ${path}.`);
      }
      i += 1;
    } else if (code >= 0xdc00 && code <= 0xdfff) {
      throw new TypeError(`Unpaired UTF-16 surrogate at ${path}.`);
    }
  }
}

function canonicalizeValue(value: unknown, path: string, depth: number): string {
  if (depth > MAX_CANONICAL_JSON_DEPTH_V1) {
    throw new TypeError(`Maximum canonical JSON depth exceeded at ${path}.`);
  }
  if (value === null) return "null";

  if (typeof value === "string") {
    assertValidString(value, path);
    return JSON.stringify(value);
  }

  if (typeof value === "boolean") return value ? "true" : "false";

  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new TypeError(`Non-finite canonical JSON number at ${path}.`);
    }
    return JSON.stringify(value);
  }

  if (Array.isArray(value)) {
    const parts: string[] = [];

    for (let index = 0; index < value.length; index += 1) {
      if (!(index in value)) {
        throw new TypeError(`Sparse canonical JSON array at ${path}.`);
      }
      parts.push(canonicalizeValue(value[index], `${path}[${index}]`, depth + 1));
    }

    return `[${parts.join(",")}]`;
  }

  if (!isPlainObject(value)) {
    throw new TypeError(`Unsupported canonical JSON value at ${path}.`);
  }

  const parts: string[] = [];

  for (const key of Object.keys(value).sort()) {
    assertValidString(key, `${path}.{key}`);
    const child = value[key];

    if (
      child === undefined ||
      typeof child === "function" ||
      typeof child === "symbol" ||
      typeof child === "bigint"
    ) {
      throw new TypeError(`Unsupported canonical JSON value at ${path}.${key}.`);
    }

    parts.push(
      `${JSON.stringify(key)}:${canonicalizeValue(child, `${path}.${key}`, depth + 1)}`
    );
  }

  return `{${parts.join(",")}}`;
}

export function canonicalizeTrustValueV1(value: unknown): string {
  const canonical = canonicalizeValue(value, "$", 0);

  if (Buffer.byteLength(canonical, "utf8") > MAX_CANONICAL_JSON_BYTES_V1) {
    throw new TypeError("Maximum canonical JSON size exceeded.");
  }

  return canonical;
}

export function computeDomainSeparatedSha3_512V1(
  domainSeparator: string,
  value: unknown
): string {
  if (
    !domainSeparator ||
    domainSeparator !== domainSeparator.trim() ||
    domainSeparator.length > 256 ||
    domainSeparator.includes("\0")
  ) {
    throw new TypeError("Invalid digest domain separator.");
  }

  const canonical = canonicalizeTrustValueV1(value);

  return createHash("sha3-512")
    .update(Buffer.from(domainSeparator, "utf8"))
    .update(Buffer.from([0]))
    .update(Buffer.from(canonical, "utf8"))
    .digest("hex");
}