import { describe, it, expect } from "vitest";
import os from "node:os";
import path from "node:path";
import { importArchive } from "../scripts/import-archive";
import { writeFileSync } from "fs";
describe("importArchive", () => {
  it("inserts posts with sha256 content hash, dedupes on re-run", () => {
    process.env.DB_PATH = ":memory:";
    writeFileSync(path.join(os.tmpdir(), "fixture.json"), JSON.stringify([
      { id: "111", text: "$PEPE 10x incoming", created_at: "2025-03-01T10:00:00Z",
        url: "https://x.com/kaleo/status/111" }]));
    const r1 = importArchive("CryptoKaleo", path.join(os.tmpdir(), "fixture.json"));
    expect(r1.inserted).toBe(1);
    const r2 = importArchive("CryptoKaleo", path.join(os.tmpdir(), "fixture.json"));
    expect(r2.skipped).toBe(1);
  });

  it("skips malformed rows without aborting the import", () => {
    process.env.DB_PATH = ":memory:";
    writeFileSync(path.join(os.tmpdir(), "fixture-malformed.json"), JSON.stringify([
      { id: "222", text: "$WIF sending it", created_at: "2025-03-02T10:00:00Z",
        url: "https://x.com/kaleo/status/222" },
      { id: "223", text: null, created_at: "2025-03-02T10:00:00Z",
        url: "https://x.com/kaleo/status/223" },
      { id: "224", text: "garbage timestamp post", created_at: "garbage",
        url: "https://x.com/kaleo/status/224" },
    ]));
    const r = importArchive("CryptoKaleo", path.join(os.tmpdir(), "fixture-malformed.json"));
    expect(r).toEqual({ inserted: 1, skipped: 0, malformed: 2 });
  });

  it("normalizes alt field names, numeric ids, wrapped arrays, missing url", () => {
    process.env.DB_PATH = ":memory:";
    // Shape mimics a different scraper: {tweets:[...]}, numeric id_str absent,
    // full_text instead of text, unix-seconds timestamp, no url field.
    writeFileSync(path.join(os.tmpdir(), "fixture-alt.json"), JSON.stringify({
      tweets: [
        { id: 333, full_text: "$SHIB szn", timestamp: 1740830400 },
        { tweet_id: "334", content: "$LINK breakout", date: "2025-03-01T11:00:00Z", link: "https://x.com/k/status/334" },
      ],
    }));
    const r = importArchive("kaleo", path.join(os.tmpdir(), "fixture-alt.json"));
    expect(r.inserted).toBe(2);
    expect(r.malformed).toBe(0);
  });
});
