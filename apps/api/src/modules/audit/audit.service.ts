import crypto from "node:crypto";

import { ensureDatabaseSchema, pool } from "../../common/db/postgres";

export interface AuditEventInput {
  tenantId: string;
  userId?: string;
  action: string;
  targetType: string;
  targetId?: string;
  metadata?: Record<string, unknown>;
}

type AuditEventRow = {
  id: string;
  tenant_id: string;
  user_id: string | null;
  action: string;
  target_type: string;
  target_id: string | null;
  metadata_json: Record<string, unknown> | null;
  created_at: Date;
};

export class AuditService {
  private readonly ready = ensureDatabaseSchema();

  async log(event: AuditEventInput): Promise<void> {
    await this.ready;

    await pool.query(
      `
        INSERT INTO audit_events (
          id,
          tenant_id,
          user_id,
          action,
          target_type,
          target_id,
          metadata_json,
          created_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, NOW())
      `,
      [
        crypto.randomUUID(),
        event.tenantId,
        event.userId ?? null,
        event.action,
        event.targetType,
        event.targetId ?? null,
        JSON.stringify(event.metadata ?? {})
      ]
    );
  }

  async listRecent(options?: { tenantId?: string; limit?: number }) {
    await this.ready;

    const limit = Math.max(1, Math.min(options?.limit ?? 25, 100));
    const values: Array<string | number> = [limit];
    const whereClause =
      options?.tenantId !== undefined
        ? (() => {
            values.push(options.tenantId);
            return "WHERE tenant_id = $2";
          })()
        : "";

    const result = await pool.query<AuditEventRow>(
      `
        SELECT
          id,
          tenant_id,
          user_id,
          action,
          target_type,
          target_id,
          metadata_json,
          created_at
        FROM audit_events
        ${whereClause}
        ORDER BY created_at DESC
        LIMIT $1
      `,
      values
    );

    return result.rows.map((row) => ({
      id: row.id,
      tenantId: row.tenant_id,
      userId: row.user_id ?? undefined,
      action: row.action,
      targetType: row.target_type,
      targetId: row.target_id ?? undefined,
      metadata: row.metadata_json ?? {},
      createdAt: row.created_at.toISOString()
    }));
  }
}
