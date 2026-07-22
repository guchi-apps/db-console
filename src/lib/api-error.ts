import { NextResponse } from "next/server";

import { IdentifierNotFoundError, InvalidIdentifierError } from "@/lib/identifier";
import { DatabaseNotAllowedError, ModeNotAllowedError } from "@/lib/target-db";

/** ルートハンドラ共通のエラーハンドリング。既知のドメインエラーは適切なHTTPステータスへ変換する。 */
export function toErrorResponse(error: unknown): NextResponse {
  if (error instanceof DatabaseNotAllowedError || error instanceof ModeNotAllowedError) {
    return NextResponse.json({ error: error.message }, { status: 403 });
  }
  if (error instanceof IdentifierNotFoundError) {
    return NextResponse.json({ error: error.message }, { status: 404 });
  }
  if (error instanceof InvalidIdentifierError) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }

  console.error(error);
  return NextResponse.json({ error: "内部エラーが発生しました" }, { status: 500 });
}
