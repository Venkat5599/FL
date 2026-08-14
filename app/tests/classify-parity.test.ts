import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { classify } from "../lib/classify";

/**
 * The app carries a copy of the enclave's classifier so the UI can preview a verdict
 * without a round trip through the chain and the TEE.
 *
 * A copy that can drift is worse than no copy: the UI would confidently show one verdict
 * while the tape permanently records another, and nobody would notice until a caller
 * disputed their record. These tests make drift a build failure instead.
 */

const ENCLAVE_SOURCE = path.join(process.cwd(), "..", "tee", "typescript", "src", "app", "classify.ts");
const APP_SOURCE = path.join(process.cwd(), "lib", "classify.ts");

/**
 * Strip the app copy's explanatory header so the two bodies are comparable.
 *
 * Newlines are normalised BEFORE the marker search, not after: this repo is developed on
 * Windows, so the files carry CRLF and a marker written with \n would never match — the
 * header would survive and the comparison would fail for the wrong reason.
 */
function bodyOf(source: string): string {
  const normalised = source.replace(/\r\n/g, "\n");
  const marker = "/**\n * Deterministic post -> trade signal classification.";
  const idx = normalised.indexOf(marker);
  return (idx === -1 ? normalised : normalised.slice(idx)).trimEnd();
}

describe("classifier parity with the enclave", () => {
  it("is byte-identical to the enclave source below the header", () => {
    const enclave = readFileSync(ENCLAVE_SOURCE, "utf8");
    const app = readFileSync(APP_SOURCE, "utf8");

    // Normalise line endings only — this repo is developed on Windows and checked out on
    // Linux CI, and CRLF/LF differences are not drift.
    const norm = (s: string) => bodyOf(s).replace(/\r\n/g, "\n").trimEnd();

    expect(norm(app)).toBe(norm(enclave));
  });

  // A weaker but independent check: even if the sources somehow diverge cosmetically,
  // the behaviour on the cases that matter must not.
  it("produces the enclave's verdicts on the canonical cases", () => {
    expect(classify("Longing $ETH here, target $4000 by month end")).toMatchObject({
      template: "TARGET_CALL",
      assetSymbol: "ETH",
      direction: "long",
      expiryDays: 30,
    });
    expect(classify("shorting $SOL into this pump")).toMatchObject({
      direction: "short",
      assetSymbol: "SOL",
    });
    expect(classify("$ETH might run here, NFA").template).toBe("NOT_A_SIGNAL");
    expect(classify("is it time to long $ETH?").template).toBe("NOT_A_SIGNAL");
    expect(classify("gm frens").template).toBe("NOT_A_SIGNAL");
  });

  it("is deterministic, which is what makes the mirror safe at all", () => {
    const text = "accumulating $XRP down here, target $3.20 this week";
    const first = classify(text);
    for (let i = 0; i < 25; i++) expect(classify(text)).toEqual(first);
  });
});
