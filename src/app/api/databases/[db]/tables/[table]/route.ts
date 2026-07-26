import { NextResponse } from "next/server";

import { toErrorResponse } from "@/lib/api-error";
import { getTableColumns, getTableIndexes } from "@/lib/introspection";
import { requireSessionForApi } from "@/lib/session";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ db: string; table: string }> },
) {
  const { response } = await requireSessionForApi();
  if (response) return response;

  const { db, table } = await params;

  try {
    const [columns, indexes] = await Promise.all([
      getTableColumns(db, table),
      getTableIndexes(db, table),
    ]);
    return NextResponse.json({ columns, indexes });
  } catch (error) {
    return toErrorResponse(error);
  }
}
