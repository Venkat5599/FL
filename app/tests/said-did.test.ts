import { describe, it, expect } from "vitest";
import { findContradictions } from "../lib/said-did";
describe("said vs did", () => {
  it("flags a sell of the shilled token within window", () => {
    const calls = [{ id: 1, asset_address: "0xA", direction: "long", posted_at: 1000 }];
    const events = [{ id: 9, token_address: "0xA", side: "sell", occurred_at: 1000 + 4*3600 }];
    const out = findContradictions(calls as any, events as any);
    expect(out).toEqual([{ callId: 1, eventId: 9, gapHours: 4 }]);
  });
  it("ignores sells outside window or other tokens", () => {
    const calls = [{ id: 1, asset_address: "0xA", direction: "long", posted_at: 1000 }];
    expect(findContradictions(calls as any,
      [{ id: 2, token_address: "0xB", side: "sell", occurred_at: 2000 }] as any)).toEqual([]);
  });
});
