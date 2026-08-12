import { getDb } from "../lib/db";
import { distillSignal } from "../lib/zg";

// Pre-warm the 0-yap cache: distill every non-ambiguous call once through the
// 0G router and store it in yap_signals, so the terminal's 0-yap mode is
// instant (cache hits) instead of firing dozens of concurrent 0G calls when
// toggled on. Idempotent — skips calls already distilled.
// Run: node --env-file=.env --import tsx scripts/distill-yap.ts
async function main() {
  const db = getDb();
  const rows = db
    .prepare(
      `SELECT c.id, p.content
       FROM calls c JOIN posts p ON p.id = c.post_id
       WHERE c.template != 'AMBIGUOUS'
         AND c.id NOT IN (SELECT call_id FROM yap_signals)
       ORDER BY c.id`
    )
    .all() as { id: number; content: string }[];

  console.log(`[distill-yap] ${rows.length} signal(s) to distill`);
  const insert = db.prepare(
    "INSERT OR REPLACE INTO yap_signals (call_id, bias, thesis, levels_json, tee_verified, created_at) VALUES (?,?,?,?,?,?)"
  );

  let ok = 0;
  let fail = 0;
  for (const r of rows) {
    try {
      const pure = await distillSignal(r.content);
      if (!pure) {
        fail++;
        console.log(`[${r.id}] no signal`);
        continue;
      }
      insert.run(
        r.id,
        pure.bias,
        pure.thesis,
        JSON.stringify(pure.levels),
        pure.teeVerified === null ? null : pure.teeVerified ? 1 : 0,
        Math.floor(Date.now() / 1000)
      );
      ok++;
      console.log(`[${r.id}] ${pure.bias} · ${pure.thesis}${pure.teeVerified ? " · ✓" : ""}`);
    } catch (e) {
      fail++;
      console.error(`[${r.id}] failed: ${(e as Error).message?.slice(0, 120)}`);
    }
  }
  console.log(`[distill-yap] done: ${ok} distilled, ${fail} failed`);
}

main();
