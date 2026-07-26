import { NextResponse } from "next/server";

import { getDatabasesConfig } from "@/lib/config";
import { requireSessionForApi } from "@/lib/session";

export async function GET() {
  const { response } = await requireSessionForApi();
  if (response) return response;

  const databases = getDatabasesConfig();
  return NextResponse.json({ databases });
}
