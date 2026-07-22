import { NextResponse } from "next/server";

import { toErrorResponse } from "@/lib/api-error";
import { listTables } from "@/lib/introspection";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ db: string }> },
) {
  const { db } = await params;

  try {
    const tables = await listTables(db);
    return NextResponse.json({ tables });
  } catch (error) {
    return toErrorResponse(error);
  }
}
