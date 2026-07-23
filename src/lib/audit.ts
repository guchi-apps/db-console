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
