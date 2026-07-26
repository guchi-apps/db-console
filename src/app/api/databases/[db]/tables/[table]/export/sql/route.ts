import { toErrorResponse } from "@/lib/api-error";
import {
  asyncGeneratorToStream,
  getTableStructureSql,
  streamTableStructureAndDataSql,
} from "@/lib/export";
import { requireSessionForApi } from "@/lib/session";

async function* singleChunk(text: string): AsyncGenerator<string> {
  yield text;
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ db: string; table: string }> },
) {
  const { response } = await requireSessionForApi();
  if (response) return response;

  const { db, table } = await params;
  const withData = new URL(request.url).searchParams.get("withData") === "1";

  try {
    const generator = withData
      ? streamTableStructureAndDataSql(db, table)
      : singleChunk(await getTableStructureSql(db, table));
    const first = await generator.next();
    const stream = asyncGeneratorToStream(generator, first);

    return new Response(stream, {
      headers: {
        "Content-Type": "application/sql; charset=utf-8",
        "Content-Disposition": `attachment; filename="${table}${withData ? "_with_data" : ""}.sql"`,
      },
    });
  } catch (error) {
    return toErrorResponse(error);
  }
}

export const dynamic = "force-dynamic";
