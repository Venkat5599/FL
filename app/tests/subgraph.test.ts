import { describe, it, expect, beforeEach } from "vitest";
import { subgraphPriceAt } from "../lib/subgraph";
import { getDb } from "../lib/db";
import { markDeleted } from "../scripts/recheck-deletions";

describe("subgraphPriceAt", () => {
  it("returns null with no network call when GRAPH_STUDIO_KEY is unset", async () => {
    delete process.env.GRAPH_STUDIO_KEY;
    const price = await subgraphPriceAt("0x6982508145454ce325ddbe47a25d4ec3d2311933", 1700000000);
    expect(price).toBeNull();
  });
});

describe("markDeleted", () => {
  beforeEach(() => {
    process.env.DB_PATH = ":memory:";
  });

  it("flips deleted_at for seeded posts by x_post_id", () => {
    const db = getDb();
    db.prepare("INSERT INTO influencers (handle) VALUES ('test')").run();
    db.prepare(
      "INSERT INTO posts (influencer_id,x_post_id,content,content_hash,url,posted_at) VALUES (1,'p1','c','h','u',1)"
    ).run();
    db.prepare(
      "INSERT INTO posts (influencer_id,x_post_id,content,content_hash,url,posted_at) VALUES (1,'p2','c','h','u',2)"
    ).run();

    const n = markDeleted(["p1"]);
    expect(n).toBe(1);

    const rows = db.prepare("SELECT x_post_id, deleted_at FROM posts ORDER BY x_post_id").all() as {
      x_post_id: string;
      deleted_at: number | null;
    }[];
    expect(rows.find((r) => r.x_post_id === "p1")?.deleted_at).not.toBeNull();
    expect(rows.find((r) => r.x_post_id === "p2")?.deleted_at).toBeNull();
  });

  it("is a no-op for an empty id list", () => {
    getDb();
    expect(markDeleted([])).toBe(0);
  });
});
