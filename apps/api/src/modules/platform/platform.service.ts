import crypto from "node:crypto";

import { ensureDatabaseSchema, pool } from "../../common/db/postgres";
import type { AuditService } from "../audit/audit.service";

type TenantRow = {
  id: string;
  slug: string;
  name: string;
  tenant_type: string;
  status: string;
  plan: string;
  vertical: string | null;
  region: string | null;
  parent_tenant_id: string | null;
  branding_json: Record<string, unknown> | null;
  created_at: Date;
  updated_at: Date;
};

type TenantListRow = TenantRow & {
  user_count: string;
  connector_count: string;
};

type UserRow = {
  id: string;
  tenant_id: string;
  email: string;
  display_name: string;
  role: string;
  status: string;
  last_active_at: Date | null;
  tenant_name?: string;
  tenant_type?: string;
};

type ConnectorRow = {
  provider: string;
  status: string;
  tenant_id: string;
  user_id: string;
  updated_at: Date;
  last_error: string | null;
  tenant_name?: string;
  user_name?: string;
};

function hashPassword(password: string) {
  const salt = crypto.randomBytes(16).toString("hex");
  const derived = crypto.scryptSync(password, salt, 64).toString("hex");
  return `${salt}:${derived}`;
}

export class PlatformService {
  private readonly ready = ensureDatabaseSchema();

  constructor(private readonly auditService: AuditService) {}

  async ensureSeedData() {
    await this.ready;

    const existing = await pool.query<{ count: string }>("SELECT COUNT(*)::text AS count FROM tenants");
    if (Number(existing.rows[0]?.count ?? "0") > 0) {
      return;
    }

    const client = await pool.connect();
    try {
      await client.query("BEGIN");

      await client.query(
        `
          INSERT INTO tenants (
            id, slug, name, tenant_type, status, plan, vertical, region, parent_tenant_id, branding_json, created_at, updated_at
          ) VALUES
            ('t-msp', 'nexian-msp', 'Nexian', 'MSP', 'ACTIVE', 'Platform', 'Managed Services', 'United Kingdom', NULL, $1::jsonb, NOW(), NOW()),
            ('t-001', 'legal-ops-co', 'Legal Ops Co', 'CUSTOMER', 'ACTIVE', 'Enterprise', 'Legal Services', 'London', 't-msp', $2::jsonb, NOW(), NOW()),
            ('t-002', 'meridian-it', 'Meridian IT Services', 'CUSTOMER', 'ACTIVE', 'Professional', 'Technology', 'Manchester', 't-msp', $3::jsonb, NOW(), NOW()),
            ('t-003', 'apex-consulting', 'Apex Consulting', 'CUSTOMER', 'ACTIVE', 'Professional', 'Consulting', 'Bristol', 't-msp', $4::jsonb, NOW(), NOW())
        `,
        [
          JSON.stringify({ brandName: "Nexian", website: "https://www.nexian.co.uk", primaryColor: "#0f6d98", accentColor: "#25c0b2" }),
          JSON.stringify({ managedBy: "Nexian", portalTheme: "corporate-ocean" }),
          JSON.stringify({ managedBy: "Nexian", portalTheme: "corporate-ocean" }),
          JSON.stringify({ managedBy: "Nexian", portalTheme: "corporate-ocean" })
        ]
      );

      const adminPasswordHash = hashPassword("demo12345");
      const userPasswordHash = hashPassword("demo12345");

      await client.query(
        `
          INSERT INTO platform_users (
            id, tenant_id, email, password_hash, display_name, role, status, last_active_at, created_at, updated_at
          ) VALUES
            ('u-001', 't-msp', 'admin@nexian.co.uk', $1, 'Jordy Whitehouse', 'OWNER', 'ACTIVE', NOW(), NOW(), NOW()),
            ('u-002', 't-001', 'sarah@legalops.com', $2, 'Sarah Chen', 'OWNER', 'ACTIVE', NOW() - interval '1 hour', NOW(), NOW()),
            ('u-003', 't-001', 'james@legalops.com', $2, 'James Rodriguez', 'ANALYST', 'ACTIVE', NOW() - interval '4 hour', NOW(), NOW()),
            ('u-004', 't-002', 'mike@meridianit.com', $2, 'Mike Thompson', 'ADMIN', 'ACTIVE', NOW() - interval '2 hour', NOW(), NOW()),
            ('u-005', 't-002', 'rachel@meridianit.com', $2, 'Rachel Green', 'OWNER', 'ACTIVE', NOW() - interval '40 minute', NOW(), NOW()),
            ('u-006', 't-003', 'david@apex.io', $2, 'David Kim', 'OWNER', 'ACTIVE', NOW() - interval '5 hour', NOW(), NOW())
        `,
        [adminPasswordHash, userPasswordHash]
      );

      await client.query(
        `
          INSERT INTO connected_accounts (
            id, tenant_id, user_id, provider, provider_account_id, access_token_encrypted, refresh_token_encrypted,
            expires_at, scopes, metadata_json, status, last_error, created_at, updated_at
          ) VALUES
            ('ca-001', 't-001', 'u-002', 'halopsa', 'u-002', 'seeded', NULL, NOW() + interval '1 day', ARRAY['read']::text[], '{"seeded":true}'::jsonb, 'ACTIVE', NULL, NOW(), NOW()),
            ('ca-002', 't-001', 'u-002', 'microsoft365', 'u-002', 'seeded', NULL, NOW() + interval '1 day', ARRAY['read']::text[], '{"seeded":true}'::jsonb, 'ACTIVE', NULL, NOW(), NOW()),
            ('ca-003', 't-002', 'u-004', 'halopsa', 'u-004', 'seeded', NULL, NOW() + interval '1 day', ARRAY['read']::text[], '{"seeded":true}'::jsonb, 'ACTIVE', NULL, NOW(), NOW()),
            ('ca-004', 't-002', 'u-005', 'hubspot', 'u-005', 'seeded', NULL, NOW() + interval '1 day', ARRAY['read']::text[], '{"seeded":true}'::jsonb, 'ACTIVE', NULL, NOW(), NOW()),
            ('ca-005', 't-003', 'u-006', 'microsoft365', 'u-006', 'seeded', NULL, NOW() + interval '1 day', ARRAY['read']::text[], '{"seeded":true}'::jsonb, 'ERROR', 'Token refresh required', NOW(), NOW())
        `
      );

      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }

    await this.auditService.log({
      tenantId: "t-msp",
      userId: "u-001",
      action: "PLATFORM_SEEDED",
      targetType: "platform",
      metadata: { customers: 3 }
    });
  }

  async getOverview() {
    await this.ensureSeedData();

    const [metricsResult, tenantsResult, connectorsResult, auditEvents] = await Promise.all([
      pool.query<{
        total_tenants: string;
        customer_tenants: string;
        total_users: string;
        total_connectors: string;
      }>(`
        SELECT
          COUNT(*)::text AS total_tenants,
          COUNT(*) FILTER (WHERE tenant_type = 'CUSTOMER')::text AS customer_tenants,
          (SELECT COUNT(*)::text FROM platform_users) AS total_users,
          (SELECT COUNT(*)::text FROM connected_accounts) AS total_connectors
        FROM tenants
      `),
      this.listTenants(),
      this.getConnectorSummary(),
      this.auditService.listRecent({ limit: 8 })
    ]);

    const metrics = metricsResult.rows[0];
    return {
      metrics: {
        totalTenants: Number(metrics.total_tenants),
        customerTenants: Number(metrics.customer_tenants),
        totalUsers: Number(metrics.total_users),
        connectedAccounts: Number(metrics.total_connectors)
      },
      tenants: tenantsResult,
      connectors: connectorsResult,
      recentAudit: auditEvents
    };
  }

  async listTenants() {
    await this.ensureSeedData();

    const result = await pool.query<TenantListRow>(`
      SELECT
        t.*,
        COUNT(DISTINCT pu.id)::text AS user_count,
        COUNT(DISTINCT ca.id)::text AS connector_count
      FROM tenants t
      LEFT JOIN platform_users pu ON pu.tenant_id = t.id
      LEFT JOIN connected_accounts ca ON ca.tenant_id = t.id
      GROUP BY t.id
      ORDER BY CASE WHEN t.tenant_type = 'MSP' THEN 0 ELSE 1 END, t.name ASC
    `);

    return result.rows.map((row) => ({
      id: row.id,
      name: row.name,
      slug: row.slug,
      type: row.tenant_type,
      status: row.status,
      plan: row.plan,
      vertical: row.vertical ?? "Unassigned",
      region: row.region ?? "UK",
      parentTenantId: row.parent_tenant_id ?? undefined,
      userCount: Number(row.user_count),
      connectorCount: Number(row.connector_count),
      createdAt: row.created_at.toISOString(),
      branding: row.branding_json ?? {}
    }));
  }

  async getTenantDetail(tenantId: string) {
    await this.ensureSeedData();

    const tenantResult = await pool.query<TenantRow>(
      `
        SELECT
          id, slug, name, tenant_type, status, plan, vertical, region, parent_tenant_id, branding_json, created_at, updated_at
        FROM tenants
        WHERE id = $1
        LIMIT 1
      `,
      [tenantId]
    );

    const tenant = tenantResult.rows[0];
    if (!tenant) {
      return undefined;
    }

    const [usersResult, connectorsResult, audit] = await Promise.all([
      pool.query<UserRow>(
        `
          SELECT id, tenant_id, email, display_name, role, status, last_active_at
          FROM platform_users
          WHERE tenant_id = $1
          ORDER BY display_name ASC
        `,
        [tenantId]
      ),
      pool.query<ConnectorRow>(
        `
          SELECT provider, status, tenant_id, user_id, updated_at, last_error
          FROM connected_accounts
          WHERE tenant_id = $1
          ORDER BY updated_at DESC
        `,
        [tenantId]
      ),
      this.auditService.listRecent({ tenantId, limit: 12 })
    ]);

    return {
      tenant: {
        id: tenant.id,
        slug: tenant.slug,
        name: tenant.name,
        type: tenant.tenant_type,
        status: tenant.status,
        plan: tenant.plan,
        vertical: tenant.vertical ?? "Managed Customer",
        region: tenant.region ?? "UK",
        parentTenantId: tenant.parent_tenant_id ?? undefined,
        branding: tenant.branding_json ?? {},
        createdAt: tenant.created_at.toISOString(),
        updatedAt: tenant.updated_at.toISOString()
      },
      users: usersResult.rows.map((user) => ({
        id: user.id,
        tenantId: user.tenant_id,
        email: user.email,
        displayName: user.display_name,
        role: user.role,
        status: user.status,
        lastActiveAt: user.last_active_at?.toISOString() ?? new Date().toISOString()
      })),
      connectors: connectorsResult.rows.map((connector) => ({
        provider: connector.provider,
        status: connector.status,
        userId: connector.user_id,
        updatedAt: connector.updated_at.toISOString(),
        lastError: connector.last_error ?? undefined
      })),
      audit
    };
  }

  async listUsers() {
    await this.ensureSeedData();

    const result = await pool.query<UserRow>(
      `
        SELECT
          pu.id,
          pu.tenant_id,
          pu.email,
          pu.display_name,
          pu.role,
          pu.status,
          pu.last_active_at,
          t.name AS tenant_name,
          t.tenant_type
        FROM platform_users pu
        INNER JOIN tenants t ON t.id = pu.tenant_id
        ORDER BY pu.display_name ASC
      `
    );

    return result.rows.map((row) => ({
      id: row.id,
      tenantId: row.tenant_id,
      tenantName: row.tenant_name ?? "",
      tenantType: row.tenant_type ?? "",
      email: row.email,
      displayName: row.display_name,
      role: row.role,
      status: row.status,
      lastActiveAt: row.last_active_at?.toISOString() ?? new Date().toISOString()
    }));
  }

  async getConnectorSummary() {
    await this.ensureSeedData();

    const result = await pool.query<ConnectorRow>(
      `
        SELECT
          ca.provider,
          ca.status,
          ca.tenant_id,
          ca.user_id,
          ca.updated_at,
          ca.last_error,
          t.name AS tenant_name,
          pu.display_name AS user_name
        FROM connected_accounts ca
        INNER JOIN tenants t ON t.id = ca.tenant_id
        INNER JOIN platform_users pu ON pu.id = ca.user_id
        ORDER BY ca.updated_at DESC
      `
    );

    return result.rows.map((row) => ({
      provider: row.provider,
      status: row.status,
      tenantId: row.tenant_id,
      tenantName: row.tenant_name ?? "",
      userId: row.user_id,
      userName: row.user_name ?? "",
      updatedAt: row.updated_at.toISOString(),
      lastError: row.last_error ?? undefined
    }));
  }
}
