import { NextResponse } from "next/server";

import { toErrorResponse } from "@/lib/api-error";
import { getDatabaseEntry } from "@/lib/config";
import { DatabaseNotAllowedError } from "@/lib/target-db";
import { getDatabaseInfo, listTables } from "@/lib/introspection";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ db: string }> },
) {
  const { db } = await params;

  try {
    const entry = getDatabaseEntry(db);
    if (!entry) {
      throw new DatabaseNotAllowedError(db);
    }

    const [info, tables] = await Promise.all([getDatabaseInfo(db), listTables(db)]);

    return NextResponse.json({
      ...entry,
      ...info,
      tableCount: tables.length,
    });
  } catch (error) {
    return toErrorResponse(error);
  }
}
