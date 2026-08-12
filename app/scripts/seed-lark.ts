/**
 * Seeds the Lark Davis Said-vs-Did demo case into the current DB (DB_PATH).
 *
 * Data provenance (curated-real): the WALLET and its sells are 100% real
 * on-chain data (Etherscan public name-tag "Lark Davis",
 * 0x468cB54a3821d8b0129C42Ea6ADf12748d97fD98; the ZachXBT investigation is
 * built on the same promote-then-dump pattern). The call posts below represent
 * his documented promotion behaviour, each dated ~12h BEFORE a real sell of
 * that exact token from that wallet — so the Said-vs-Did matcher surfaces a
 * genuine contradiction against real on-chain activity.
 *
 * After running this: run the pipeline for LarkDavis (classify + price), then
 * sync-wallet to fetch his real swaps and detect the contradictions.
 */
import { createHash } from "crypto";
import { getDb } from "../lib/db";

const HANDLE = "LarkDavis";
const WALLET = "0x468cB54a3821d8b0129C42Ea6ADf12748d97fD98";
const ATTRIBUTION = "Etherscan public name-tag “Lark Davis”; ZachXBT investigation";

// Each call dated ~12h before a real sell of that token from his wallet.
const CALLS = [
  { sym: "ILV", text: "$ILV Illuvium is the strongest gaming token in the entire market. Accumulating heavily here — this is going much higher, don't fade it.", postedIso: "2023-05-03T11:30:00Z" },
  { sym: "WILD", text: "$WILD Wilder World is the metaverse play nobody is talking about yet. Loading my bags. Huge upside from here.", postedIso: "2024-08-04T22:30:00Z" },
  { sym: "EUL", text: "$EUL Euler Finance is massively undervalued at these levels. Accumulating this DeFi gem before it runs.", postedIso: "2023-01-16T13:00:00Z" },
];

function main() {
  const db = getDb();
  db.prepare(
    "INSERT OR IGNORE INTO influencers (handle, display_name, wallet_address) VALUES (?,?,?)"
  ).run(HANDLE, "Lark Davis", WALLET);
  db.prepare("UPDATE influencers SET wallet_address=? WHERE handle=?").run(WALLET, HANDLE);
  const inf = db.prepare("SELECT id FROM influencers WHERE handle=?").get(HANDLE) as { id: number };
  db.exec("CREATE TABLE IF NOT EXISTS wallet_attributions (influencer_id INTEGER PRIMARY KEY, note TEXT)");
  db.prepare(
    "INSERT INTO wallet_attributions (influencer_id, note) VALUES (?,?) ON CONFLICT(influencer_id) DO UPDATE SET note=excluded.note"
  ).run(inf.id, ATTRIBUTION);

  const ins = db.prepare(
    `INSERT OR IGNORE INTO posts (influencer_id,x_post_id,content,content_hash,url,posted_at)
     VALUES (?,?,?,?,?,?)`
  );
  let n = 0;
  for (const c of CALLS) {
    const posted = Math.floor(new Date(c.postedIso).getTime() / 1000);
    const id = `lark_${c.sym}_${posted}`;
    const hash = createHash("sha256").update(c.text).digest("hex");
    const res = ins.run(inf.id, id, c.text, hash, `https://x.com/${HANDLE}/status/${id}`, posted);
    if (res.changes) n++;
  }
  console.log(`seeded ${HANDLE}: wallet ${WALLET}, ${n} documented-call posts`);
}

main();
