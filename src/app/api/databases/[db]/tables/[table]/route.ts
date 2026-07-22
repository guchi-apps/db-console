import { NextResponse } from "next/server";

import { toErrorResponse } from "@/lib/api-error";
import { getTableColumns, getTableIndexes } from "@/lib/introspection";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ db: string; table: string }> },
) {
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
