import { ImageResponse } from "next/og";
import { buildDossier } from "@/lib/dossier";

// better-sqlite3 (used transitively by buildDossier -> getDb) is a native
// Node addon and cannot run on the edge runtime that ImageResponse defaults
// to. Must stay nodejs or the DB import breaks the build/runtime.
export const runtime = "nodejs";

const WIDTH = 1200;
const HEIGHT = 630;

function notIndexedCard(handle: string) {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          backgroundColor: "#0a0a0a",
          fontFamily: "system-ui, sans-serif",
        }}
      >
        <div style={{ display: "flex", fontSize: 56, fontWeight: 700, color: "#ffffff" }}>
          @{handle} — not indexed
        </div>
      </div>
    ),
    { width: WIDTH, height: HEIGHT }
  );
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ handle: string }> }
) {
  const { handle } = await params;
  const dossier = buildDossier(handle);

  if (!dossier) {
    return notIndexedCard(handle);
  }

  const { stats } = dossier;

  // Same math as components/VerdictBlock.tsx — kept in lockstep intentionally.
  const verdictPct = (100 * stats.totalPnl / (1000 * Math.max(stats.settled, 1))).toFixed(1);
  const verdictColor = stats.totalPnl < 0 ? "#ef4444" : "#22c55e";
  const equityFollow = (1000 * stats.settled + stats.totalPnl).toLocaleString();
  const equityHold = (1000 * stats.settled + stats.benchmarkPnl).toLocaleString();

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          backgroundColor: "#0a0a0a",
          padding: "56px 64px",
          fontFamily: "system-ui, sans-serif",
        }}
      >
        <div style={{ display: "flex", fontSize: 36, fontWeight: 600, color: "#e5e5e5" }}>
          @{dossier.handle}
        </div>

        <div
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <div style={{ display: "flex", fontSize: 140, fontWeight: 800, color: verdictColor }}>
            {stats.totalPnl >= 0 ? "+" : ""}
            {verdictPct}%
          </div>
          <div style={{ display: "flex", marginTop: 24, fontSize: 30, color: "#a3a3a3" }}>
            $1,000 into every call → ${equityFollow}. Holding ETH → ${equityHold}.
          </div>
          <div style={{ display: "flex", marginTop: 12, fontSize: 24, color: "#737373" }}>
            {stats.settled} settled calls · {stats.winRate}% win rate
          </div>
        </div>

        <div style={{ display: "flex", fontSize: 22, color: "#525252" }}>
          gigabags · scoring verified by TEE inference on 0G
        </div>
      </div>
    ),
    { width: WIDTH, height: HEIGHT }
  );
}
