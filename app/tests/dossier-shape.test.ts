import { describe, it, expect } from "vitest";
import { getDb } from "../lib/db";
import { buildDossier } from "../lib/dossier";

describe("buildDossier", () => {
  it("assembles handle/stats/calls, scoring only the priced call", () => {
    process.env.DB_PATH = ":memory:";
    const db = getDb();

    db.prepare("INSERT INTO influencers (handle) VALUES ('dossiertest')").run();

    db.prepare(
      `INSERT INTO posts (influencer_id,x_post_id,content,content_hash,url,posted_at)
       VALUES (1,'p1','$FOO to the moon','h1','https://x.com/dossiertest/status/1',1000)`
    ).run();
    db.prepare(
      `INSERT INTO posts (influencer_id,x_post_id,content,content_hash,url,posted_at)
       VALUES (1,'p2','not really a call','h2','https://x.com/dossiertest/status/2',2000)`
    ).run();

    // Call 1: scoreable long call, entry/live + eth pair present, status open.
    db.prepare(
      `INSERT INTO calls (post_id,template,asset_symbol,direction,confidence,status)
       VALUES (1,'DIRECTIONAL','FOO','long',0.9,'open')`
    ).run();
    // Call 2: ambiguous — no marks at all.
    db.prepare(
      `INSERT INTO calls (post_id,template,asset_symbol,direction,confidence,status)
       VALUES (2,'AMBIGUOUS',NULL,NULL,0.5,'ambiguous')`
    ).run();

    db.prepare(
      `INSERT INTO marks (call_id,kind,price_usd,source,marked_at) VALUES (1,'entry',100,'graph',1000)`
    ).run();
    db.prepare(
      `INSERT INTO marks (call_id,kind,price_usd,source,marked_at) VALUES (1,'live',150,'graph',5000)`
    ).run();
    // ETH benchmark: kind 'd1'/'d7' disambiguated by source, not kind.
    db.prepare(
      `INSERT INTO marks (call_id,kind,price_usd,source,marked_at) VALUES (1,'d1',2000,'eth_entry',1000)`
    ).run();
    db.prepare(
      `INSERT INTO marks (call_id,kind,price_usd,source,marked_at) VALUES (1,'d7',2200,'eth_latest',5000)`
    ).run();

    const dossier = buildDossier("dossiertest");
    expect(dossier).not.toBeNull();

    // long: (150-100)/100 = 50% -> pnlUsd = round(1000*0.5) = 500
    expect(dossier!.stats.totalPnl).toBe(500);
    expect(dossier!.calls.length).toBe(2);

    const ambiguous = dossier!.calls.find((c) => c.status === "ambiguous");
    expect(ambiguous).toBeDefined();
    expect(ambiguous!.retPct).toBeNull();
    expect(ambiguous!.pnlUsd).toBeNull();

    const scored = dossier!.calls.find((c) => c.status === "open");
    expect(scored!.retPct).toBe(50);
    expect(scored!.pnlUsd).toBe(500);
  });

  it("tallies deleted calls into the integrity stat (losses still counted + flagged)", () => {
    process.env.DB_PATH = ":memory:";
    const db = getDb();
    const inf = db.prepare("INSERT INTO influencers (handle) VALUES ('deltest')").run();
    const infId = inf.lastInsertRowid as number;
    // A deleted post whose call was a loser: entry 100 -> live 60 = -40%.
    const post = db
      .prepare(
        `INSERT INTO posts (influencer_id,x_post_id,content,content_hash,url,posted_at,deleted_at)
         VALUES (?,'del1','$RUG guaranteed 10x','h','https://x.com/deltest/status/1',1000,4000)`
      )
      .run(infId);
    const postId = post.lastInsertRowid as number;
    const call = db
      .prepare(
        `INSERT INTO calls (post_id,template,asset_symbol,direction,confidence,status)
         VALUES (?,'GEM_SHILL','RUG','long',0.9,'open')`
      )
      .run(postId);
    const callId = call.lastInsertRowid as number;
    db.prepare(`INSERT INTO marks (call_id,kind,price_usd,source,marked_at) VALUES (?,'entry',100,'g',1000)`).run(callId);
    db.prepare(`INSERT INTO marks (call_id,kind,price_usd,source,marked_at) VALUES (?,'live',60,'g',5000)`).run(callId);

    const d = buildDossier("deltest")!;
    // Deleted call still counts in P&L (can't delete your way out):
    expect(d.stats.totalPnl).toBe(-400);
    // ...and is explicitly flagged in the integrity stat:
    expect(d.integrity.deletedTotal).toBe(1);
    expect(d.integrity.deletedScored).toBe(1);
    expect(d.integrity.deletedAvgRetPct).toBe(-40);
    expect(d.integrity.deletedHiddenLoss).toBe(-400);
  });

  it("returns null for an unknown handle", () => {
    process.env.DB_PATH = ":memory:";
    expect(buildDossier("nobody")).toBeNull();
  });
});
