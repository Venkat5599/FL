import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";

interface ReceiptRow {
  request_json: string;
  response_json: string;
  chat_id: string | null;
  tee_signature: string | null;
  provider_address: string | null;
  verified: number;
  content_hash: string;
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ callId: string }> }
) {
  const { callId } = await params;
  const db = getDb();

  const receipt = db
    .prepare(
      `SELECT a.request_json, a.response_json, a.chat_id, a.tee_signature, a.provider_address, a.verified,
              p.content_hash
       FROM artifacts a
       JOIN calls c ON c.id = a.call_id
       JOIN posts p ON p.id = c.post_id
       WHERE a.call_id = ?`
    )
    .get(callId) as ReceiptRow | undefined;

  if (!receipt) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  return NextResponse.json(receipt);
}
