import { describe, expect, it } from "vitest";

import { TRUST_ADAPTER_VERSION } from "../../src/index.js";

describe("package surface", () => {
  it("exposes the package version", () => {
    expect(TRUST_ADAPTER_VERSION).toBe("0.0.0");
  });
});