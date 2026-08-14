import { NextResponse } from "next/server";
import { appendFile, mkdir, readFile } from "fs/promises";
import path from "path";

// repo root is one level up from the Next app (app/), so this resolves to
// <repo>/docs/TX_HASHES.md regardless of where `next start`/`next build`
// is invoked from.
const DOCS_DIR = path.join(process.cwd(), "..", "docs");
const TX_LOG_PATH = path.join(DOCS_DIR, "TX_HASHES.md");
const HEADER = "# TX_HASHES\n\nEvery executed FADE/FOLLOW swap hash, appended live.\n\n";

interface TxLogBody {
  hash: string;
  callId?: number | string;
  side?: string;
}

export async function POST(req: Request) {
  const body = (await req.json()) as TxLogBody;
  if (!body.hash) {
    return NextResponse.json({ error: "missing hash" }, { status: 400 });
  }

  await mkdir(DOCS_DIR, { recursive: true });

  let needsHeader = false;
  try {
    await readFile(TX_LOG_PATH);
  } catch {
    needsHeader = true;
  }

  const line = `- ${new Date().toISOString()} | call ${body.callId ?? "—"} | ${
    body.side ?? "—"
  } | ${body.hash}\n`;

  await appendFile(TX_LOG_PATH, (needsHeader ? HEADER : "") + line);

  return NextResponse.json({ ok: true });
}
