import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export async function GET() {
  const projectId = process.env.WALLETCONNECT_PROJECT_ID?.trim() ?? "";
  const enabled = /^[a-f0-9]{32}$/i.test(projectId);

  return NextResponse.json(
    { enabled, projectId: enabled ? projectId : null },
    { headers: { "cache-control": "no-store, max-age=0" } },
  );
}
