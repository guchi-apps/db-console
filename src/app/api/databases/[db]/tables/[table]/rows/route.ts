import { NextResponse } from "next/server";

import { toErrorResponse } from "@/lib/api-error";
import { getTableRows } from "@/lib/introspection";
import { requireSessionForApi } from "@/lib/session";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ db: string; table: string }> },
) {
  const { response } = await requireSessionForApi();
  if (response) return response;

  const { db, table } = await params;
  const searchParams = new URL(request.url).searchParams;

  try {
    const page = Number(searchParams.get("page") ?? "1");
    const pageSize = Number(searchParams.get("pageSize") ?? "50");
    const sortColumn = searchParams.get("sortColumn") ?? undefined;
    const sortDirection =
      searchParams.get("sortDirection") === "desc" ? "desc" : "asc";
    const search = searchParams.get("search") ?? undefined;

    const result = await getTableRows(db, table, {
      page,
      pageSize,
      sortColumn,
      sortDirection,
      search,
    });
    return NextResponse.json(result);
  } catch (error) {
    return toErrorResponse(error);
  }
}
