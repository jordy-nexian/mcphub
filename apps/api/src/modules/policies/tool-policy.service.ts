import { ensureDatabaseSchema, pool } from "../../common/db/postgres";
import type { AuditService } from "../audit/audit.service";

type ToolPolicyRow = {
  tenant_id: string;
  tool_name: string;
  enabled: boolean;
  updated_at: Date;
};

export interface ToolPolicyRecord {
  tenantId: string;
  toolName: string;
  enabled: boolean;
  updatedAt: string;
}

export class ToolPolicyService {
  private readonly ready = ensureDatabaseSchema();

  constructor(private readonly auditService: AuditService) {}

  async listForTenant(tenantId: string): Promise<ToolPolicyRecord[]> {
    await this.ready;

    const result = await pool.query<ToolPolicyRow>(
      `SELECT tenant_id, tool_name, enabled, updated_at
       FROM tool_policies
       WHERE tenant_id = $1`,
      [tenantId]
    );

    return result.rows.map((row) => ({
      tenantId: row.tenant_id,
      toolName: row.tool_name,
      enabled: row.enabled,
      updatedAt: row.updated_at.toISOString()
    }));
  }

  async getDisabledToolsForTenant(tenantId: string): Promise<Set<string>> {
    await this.ready;

    const result = await pool.query<{ tool_name: string }>(
      `SELECT tool_name FROM tool_policies WHERE tenant_id = $1 AND enabled = FALSE`,
      [tenantId]
    );

    return new Set(result.rows.map((row) => row.tool_name));
  }

  async setToolEnabled(input: {
    actorTenantId: string;
    actorUserId: string;
    tenantId: string;
    toolName: string;
    enabled: boolean;
  }): Promise<ToolPolicyRecord> {
    await this.ready;

    const toolName = input.toolName.trim();
    if (!toolName) {
      throw new Error("toolName is required");
    }

    const result = await pool.query<ToolPolicyRow>(
      `
        INSERT INTO tool_policies (tenant_id, tool_name, enabled, updated_at)
        VALUES ($1, $2, $3, NOW())
        ON CONFLICT (tenant_id, tool_name) DO UPDATE SET
          enabled = EXCLUDED.enabled,
          updated_at = NOW()
        RETURNING tenant_id, tool_name, enabled, updated_at
      `,
      [input.tenantId, toolName, input.enabled]
    );

    await this.auditService.log({
      tenantId: input.actorTenantId,
      userId: input.actorUserId,
      action: input.enabled ? "TOOL_POLICY_ENABLED" : "TOOL_POLICY_DISABLED",
      targetType: "tool_policy",
      targetId: toolName,
      metadata: { tenantId: input.tenantId, toolName, enabled: input.enabled }
    });

    const row = result.rows[0];
    return {
      tenantId: row.tenant_id,
      toolName: row.tool_name,
      enabled: row.enabled,
      updatedAt: row.updated_at.toISOString()
    };
  }

  async clearTool(input: {
    actorTenantId: string;
    actorUserId: string;
    tenantId: string;
    toolName: string;
  }): Promise<void> {
    await this.ready;

    await pool.query(`DELETE FROM tool_policies WHERE tenant_id = $1 AND tool_name = $2`, [
      input.tenantId,
      input.toolName
    ]);

    await this.auditService.log({
      tenantId: input.actorTenantId,
      userId: input.actorUserId,
      action: "TOOL_POLICY_RESET",
      targetType: "tool_policy",
      targetId: input.toolName,
      metadata: { tenantId: input.tenantId, toolName: input.toolName }
    });
  }
}
