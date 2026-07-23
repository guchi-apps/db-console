import { NextResponse } from "next/server";

import { toErrorResponse } from "@/lib/api-error";
import { listTables } from "@/lib/introspection";
import { requireSessionForApi } from "@/lib/session";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ db: string }> },
) {
  const { response } = await requireSessionForApi();
  if (response) return response;

  const { db } = await params;

  try {
    const tables = await listTables(db);
    return NextResponse.json({ tables });
  } catch (error) {
    return toErrorResponse(error);
  }
}
