import type { AuditAction, AuditStatus } from "@prisma/client";

import { db } from "@/lib/db";

export interface AuditLogInput {
  userId: string;
  action: AuditAction;
  databaseName: string;
  tableName?: string;
  objectName?: string;
  sqlText?: string;
  beforeData?: unknown;
  afterData?: unknown;
  affectedRows?: number;
  status: AuditStatus;
  errorMessage?: string;
  ipAddress?: string;
  userAgent?: string;
}

export async function writeAuditLog(input: AuditLogInput): Promise<void> {
  await db.auditLog.create({
    data: {
      userId: input.userId,
      action: input.action,
      databaseName: input.databaseName,
      tableName: input.tableName,
      objectName: input.objectName,
      sqlText: input.sqlText,
      beforeData:
        input.beforeData !== undefined ? JSON.stringify(input.beforeData) : undefined,
      afterData:
        input.afterData !== undefined ? JSON.stringify(input.afterData) : undefined,
      affectedRows: input.affectedRows,
      status: input.status,
      errorMessage: input.errorMessage,
      ipAddress: input.ipAddress,
      userAgent: input.userAgent,
    },
  });
}

/**
 * 操作の結果が確定したあとに監査ログを残すための書き込み。失敗しても例外を投げず、
 * `console.error` に残すだけにする。
 *
 * 操作（SQL実行・DDL・レコード更新）は監査ログより先に実行済みなので、メタデータDBへの
 * 書き込みが落ちたことを操作の失敗として扱うと、実行済みの操作が「失敗」に見えて
 * 利用者が再実行し、二重に適用されうる（#135）。操作の成否を変えないために使う。
 */
export async function writeAuditLogSafely(input: AuditLogInput): Promise<void> {
  try {
    await writeAuditLog(input);
  } catch (error) {
    console.error(
      `監査ログの書き込みに失敗しました (${input.action} / ${input.databaseName} / ${input.status})`,
      error,
    );
  }
}
