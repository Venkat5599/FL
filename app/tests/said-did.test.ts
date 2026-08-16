import { describe, it, expect } from "vitest";
import { findContradictions } from "../lib/said-did";

// findContradictions' parameter types are not exported, so the fixtures were
// previously cast through `any`. Deriving them from the function signature
// instead keeps the test honest: if the shape of a call or a wallet event
// changes, these fixtures stop compiling rather than silently testing the old
// shape through a cast that suppresses the error.
type Call = Parameters<typeof findContradictions>[0][number];
type Event = Parameters<typeof findContradictions>[1][number];

describe("said vs did", () => {
  it("flags a sell of the shilled token within window", () => {
    const calls: Call[] = [{ id: 1, asset_address: "0xA", direction: "long", posted_at: 1000 }];
    const events: Event[] = [{ id: 9, token_address: "0xA", side: "sell", occurred_at: 1000 + 4 * 3600 }];
    const out = findContradictions(calls, events);
    expect(out).toEqual([{ callId: 1, eventId: 9, gapHours: 4 }]);
  });

  it("ignores sells outside window or other tokens", () => {
    const calls: Call[] = [{ id: 1, asset_address: "0xA", direction: "long", posted_at: 1000 }];
    const events: Event[] = [{ id: 2, token_address: "0xB", side: "sell", occurred_at: 2000 }];
    expect(findContradictions(calls, events)).toEqual([]);
  });
});
