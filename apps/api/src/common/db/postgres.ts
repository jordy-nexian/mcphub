import { Pool } from "pg";

const globalForPg = globalThis as typeof globalThis & {
  pgPool?: Pool;
};

export const pool =
  globalForPg.pgPool ??
  new Pool({
    connectionString: process.env.DATABASE_URL
  });

if (process.env.NODE_ENV !== "production") {
  globalForPg.pgPool = pool;
}

export async function ensureDatabaseSchema() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS tenants (
      id TEXT PRIMARY KEY,
      slug TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS platform_users (
      id TEXT PRIMARY KEY,
      tenant_id TEXT NOT NULL,
      email TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      display_name TEXT NOT NULL,
      role TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS platform_users_tenant_idx
    ON platform_users (tenant_id);
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS oauth_authorization_codes (
      code TEXT PRIMARY KEY,
      client_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      tenant_id TEXT NOT NULL,
      redirect_uri TEXT NOT NULL,
      scope TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
      code_challenge TEXT NULL,
      code_challenge_method TEXT NULL,
      expires_at TIMESTAMPTZ NOT NULL,
      consumed_at TIMESTAMPTZ NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS oauth_authorization_codes_user_idx
    ON oauth_authorization_codes (user_id, tenant_id);
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS connected_accounts (
      id TEXT PRIMARY KEY,
      tenant_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      provider TEXT NOT NULL,
      provider_account_id TEXT NULL,
      access_token_encrypted TEXT NOT NULL,
      refresh_token_encrypted TEXT NULL,
      expires_at TIMESTAMPTZ NULL,
      scopes TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
      metadata_json JSONB NULL,
      status TEXT NOT NULL,
      last_error TEXT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  await pool.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS connected_accounts_tenant_user_provider_key
    ON connected_accounts (tenant_id, user_id, provider);
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS connected_accounts_tenant_user_idx
    ON connected_accounts (tenant_id, user_id);
  `);
}
