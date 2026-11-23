import { describe, expect, it } from "vitest";

import {
  canonicalizeTrustValueV1,
  computeDomainSeparatedSha3_512V1,
} from "../../src/index.js";

describe("canonical trust values", () => {
  it("canonicalizes deterministically and matches the fixed SHA3-512 vector", () => {
    const value = { b: 2, a: "x" };

    expect(canonicalizeTrustValueV1(value)).toBe('{"a":"x","b":2}');
    expect(
      computeDomainSeparatedSha3_512V1("vera-anchor:test:v1", value)
    ).toBe(
      "8a09be7df0e1e6c8f574cf4b4556fb03c30325b78aa2a0308bfe6156e5b6e47" +
        "e062b0c94f092fd42ee0df355386628075ef0e62f4eb64f6a579b172f92228fec"
    );
  });

  it("rejects sparse arrays", () => {
    const value: unknown[] = [];
    value.length = 1;

    expect(() => canonicalizeTrustValueV1(value)).toThrow();
  });

  it("rejects unpaired UTF-16 surrogates", () => {
    expect(() =>
      canonicalizeTrustValueV1({ value: "\ud800" })
    ).toThrow();
  });

  it("rejects unsupported JSON values", () => {
    expect(() =>
      canonicalizeTrustValueV1({ value: undefined })
    ).toThrow();
    expect(() =>
      canonicalizeTrustValueV1({ value: Number.NaN })
    ).toThrow();
  });
});