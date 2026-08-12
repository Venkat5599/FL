import { describe, it, expect } from "vitest";
import { getDb } from "../lib/db";
describe("db", () => {
  it("creates tables and enforces unique post ids", () => {
    process.env.DB_PATH = ":memory:";
    const db = getDb();
    db.prepare("INSERT INTO influencers (handle) VALUES ('test')").run();
    const ins = db.prepare(
      "INSERT INTO posts (influencer_id,x_post_id,content,content_hash,url,posted_at) VALUES (1,'p1','c','h','u',1)");
    ins.run();
    expect(() => ins.run()).toThrow(); // UNIQUE violation
  });
});
