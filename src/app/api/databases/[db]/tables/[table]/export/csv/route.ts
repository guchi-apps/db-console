import { toErrorResponse } from "@/lib/api-error";
import { asyncGeneratorToStream, streamTableCsvRows } from "@/lib/export";
import { requireSessionForApi } from "@/lib/session";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ db: string; table: string }> },
) {
  const { response } = await requireSessionForApi();
  if (response) return response;

  const { db, table } = await params;
  const search = new URL(request.url).searchParams.get("search") ?? undefined;

  try {
    const generator = streamTableCsvRows(db, table, { search });
    // 最初の.next()を先に取得することで、許可リスト検証等のエラーをストリーム開始前に
    // 同期的にハンドリングできるようにする（ReadableStream内で例外が起きると
    // レスポンスが壊れたまま返ってしまうため）。
    const first = await generator.next();
    const stream = asyncGeneratorToStream(generator, first);
    return new Response(stream, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${table}.csv"`,
      },
    });
  } catch (error) {
    return toErrorResponse(error);
  }
}

export const dynamic = "force-dynamic";
