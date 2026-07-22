import { NextResponse } from "next/server";

import { getDatabasesConfig } from "@/lib/config";

export async function GET() {
  const databases = getDatabasesConfig();
  return NextResponse.json({ databases });
}
