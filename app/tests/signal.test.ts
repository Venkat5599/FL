import { describe, it, expect } from "vitest";
import { parseToolCall } from "../lib/zg";
describe("parseToolCall", () => {
  it("extracts and validates the emit_trade_signal tool call", () => {
    const completion = { choices: [{ message: { tool_calls: [{ function: {
      name: "emit_trade_signal",
      arguments: JSON.stringify({ template: "GEM_SHILL", asset_symbol: "PEPE",
        direction: "long", expiry_days: null, confidence: 0.93 }) } }] } }] };
    const s = parseToolCall(completion)!;
    expect(s.template).toBe("GEM_SHILL");
    expect(s.confidence).toBeGreaterThan(0.85);
  });
  it("returns null on garbage", () => {
    expect(parseToolCall({ choices: [{ message: {} }] })).toBeNull();
  });
  it("returns null on malformed JSON arguments", () => {
    const completion = { choices: [{ message: { tool_calls: [{ function: {
      name: "emit_trade_signal", arguments: "{truncated" } }] } }] };
    expect(parseToolCall(completion)).toBeNull();
  });
});
