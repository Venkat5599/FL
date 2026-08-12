type Call = { id: number; asset_address: string | null; direction: string; posted_at: number };
type Ev = { id: number; token_address: string; side: string; occurred_at: number };
export function findContradictions(calls: Call[], events: Ev[], windowHours = 24) {
  const out: { callId: number; eventId: number; gapHours: number }[] = [];
  for (const c of calls) {
    if (c.direction !== "long" || !c.asset_address) continue;
    for (const e of events) {
      if (e.side !== "sell" || e.token_address.toLowerCase() !== c.asset_address.toLowerCase()) continue;
      const gap = (e.occurred_at - c.posted_at) / 3600;
      if (gap >= 0 && gap <= windowHours) out.push({ callId: c.id, eventId: e.id, gapHours: Math.round(gap * 10) / 10 });
    }
  }
  return out;
}
