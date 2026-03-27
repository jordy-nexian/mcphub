import type { ConnectedAccountRecord, ProviderName } from "@nexian/core/domain/models";

import { ensureDatabaseSchema, pool } from "../db/postgres";

type ConnectedAccountRow = {
  id: string;
  tenant_id: string;
  user_id: string;
  provider: string;
  provider_account_id: string | null;
  access_token_encrypted: string;
  refresh_token_encrypted: string | null;
  expires_at: Date | null;
  scopes: string[];
  metadata_json: Record<string, unknown> | null;
  status: ConnectedAccountRecord["status"];
  last_error: string | null;
  created_at: Date;
  updated_at: Date;
};

function toDomain(row: ConnectedAccountRow): ConnectedAccountRecord {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    userId: row.user_id,
    provider: row.provider as ProviderName,
    providerAccountId: row.provider_account_id ?? undefined,
    accessTokenEncrypted: row.access_token_encrypted,
    refreshTokenEncrypted: row.refresh_token_encrypted ?? undefined,
    expiresAt: row.expires_at ?? undefined,
    scopes: row.scopes,
    metadataJson: row.metadata_json ?? undefined,
    status: row.status,
    lastError: row.last_error ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

export class ConnectedAccountStore {
  private readonly ready = ensureDatabaseSchema();

  static createDefault() {
    return new ConnectedAccountStore();
  }

  async upsert(account: ConnectedAccountRecord): Promise<ConnectedAccountRecord> {
    await this.ready;

    const result = await pool.query<ConnectedAccountRow>(
      `
        INSERT INTO connected_accounts (
          id,
          tenant_id,
          user_id,
          provider,
          provider_account_id,
          access_token_encrypted,
          refresh_token_encrypted,
          expires_at,
          scopes,
          metadata_json,
          status,
          last_error,
          created_at,
          updated_at
        ) VALUES (
          $1, $2, $3, $4, $5, $6, $7, $8, $9::text[], $10::jsonb, $11, $12, $13, $14
        )
        ON CONFLICT (tenant_id, user_id, provider)
        DO UPDATE SET
          provider_account_id = EXCLUDED.provider_account_id,
          access_token_encrypted = EXCLUDED.access_token_encrypted,
          refresh_token_encrypted = EXCLUDED.refresh_token_encrypted,
          expires_at = EXCLUDED.expires_at,
          scopes = EXCLUDED.scopes,
          metadata_json = EXCLUDED.metadata_json,
          status = EXCLUDED.status,
          last_error = EXCLUDED.last_error,
          updated_at = EXCLUDED.updated_at
        RETURNING *
      `,
      [
        account.id,
        account.tenantId,
        account.userId,
        account.provider,
        account.providerAccountId ?? null,
        account.accessTokenEncrypted,
        account.refreshTokenEncrypted ?? null,
        account.expiresAt ?? null,
        account.scopes,
        account.metadataJson ? JSON.stringify(account.metadataJson) : null,
        account.status,
        account.lastError ?? null,
        account.createdAt,
        account.updatedAt
      ]
    );

    return toDomain(result.rows[0]);
  }

  async findByTenantUser(tenantId: string, userId: string): Promise<ConnectedAccountRecord[]> {
    await this.ready;

    const result = await pool.query<ConnectedAccountRow>(
      `
        SELECT *
        FROM connected_accounts
        WHERE tenant_id = $1 AND user_id = $2
        ORDER BY created_at ASC
      `,
      [tenantId, userId]
    );

    return result.rows.map(toDomain);
  }

  async disconnect(tenantId: string, userId: string, provider: ProviderName): Promise<void> {
    await this.ready;

    await pool.query(
      `
        DELETE FROM connected_accounts
        WHERE tenant_id = $1 AND user_id = $2 AND provider = $3
      `,
      [tenantId, userId, provider]
    );
  }
}
