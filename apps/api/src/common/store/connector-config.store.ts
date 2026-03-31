import type { ProviderName } from "@nexian/core/domain/models";

import { ensureDatabaseSchema, pool } from "../db/postgres";

type ConnectorConfigRow = {
  tenant_id: string;
  provider: string;
  config_json: Record<string, unknown>;
  created_at: Date;
  updated_at: Date;
};

export interface ConnectorConfigRecord {
  tenantId: string;
  provider: ProviderName;
  configJson: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
}

function toDomain(row: ConnectorConfigRow): ConnectorConfigRecord {
  return {
    tenantId: row.tenant_id,
    provider: row.provider as ProviderName,
    configJson: row.config_json ?? {},
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

export class ConnectorConfigStore {
  private readonly ready = ensureDatabaseSchema();

  static createDefault() {
    return new ConnectorConfigStore();
  }

  async get(tenantId: string, provider: ProviderName): Promise<ConnectorConfigRecord | null> {
    await this.ready;

    const result = await pool.query<ConnectorConfigRow>(
      `
        SELECT *
        FROM connector_configs
        WHERE tenant_id = $1 AND provider = $2
      `,
      [tenantId, provider]
    );

    return result.rows[0] ? toDomain(result.rows[0]) : null;
  }

  async upsert(record: ConnectorConfigRecord): Promise<ConnectorConfigRecord> {
    await this.ready;

    const result = await pool.query<ConnectorConfigRow>(
      `
        INSERT INTO connector_configs (
          tenant_id,
          provider,
          config_json,
          created_at,
          updated_at
        ) VALUES ($1, $2, $3::jsonb, $4, $5)
        ON CONFLICT (tenant_id, provider)
        DO UPDATE SET
          config_json = EXCLUDED.config_json,
          updated_at = EXCLUDED.updated_at
        RETURNING *
      `,
      [record.tenantId, record.provider, JSON.stringify(record.configJson ?? {}), record.createdAt, record.updatedAt]
    );

    return toDomain(result.rows[0]);
  }
}
