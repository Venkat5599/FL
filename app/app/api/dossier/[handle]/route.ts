import { NextResponse } from "next/server";
import { buildDossier } from "@/lib/dossier";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ handle: string }> }
) {
  const { handle } = await params;
  const dossier = buildDossier(handle);
  if (!dossier) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
  return NextResponse.json(dossier);
}
