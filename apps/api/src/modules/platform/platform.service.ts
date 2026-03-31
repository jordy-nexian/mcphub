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
  password_hash?: string;
  email: string;
  display_name: string;
  role: string;
  platform_role?: string;
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
          pu.platform_role,
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
      platformRole: row.platform_role ?? "PLATFORM_MEMBER",
      status: row.status,
      lastActiveAt: row.last_active_at?.toISOString() ?? new Date().toISOString()
    }));
  }

  async createUser(input: {
    tenantId: string;
    email: string;
    displayName: string;
    role: string;
    platformRole?: string;
    temporaryPassword?: string;
  }) {
    await this.ensureSeedData();

    const email = input.email.toLowerCase().trim();
    const displayName = input.displayName.trim();
    const role = input.role.trim().toUpperCase();
    const temporaryPassword =
      input.temporaryPassword?.trim() || crypto.randomBytes(6).toString("base64url");

    const tenantResult = await pool.query<TenantRow>(
      `SELECT id, slug, name, tenant_type, status, plan, vertical, region, parent_tenant_id, branding_json, created_at, updated_at
       FROM tenants
       WHERE id = $1
       LIMIT 1`,
      [input.tenantId]
    );
    const tenant = tenantResult.rows[0];
    if (!tenant) {
      throw new Error("Tenant not found");
    }

    const existingUser = await pool.query<UserRow>(
      `SELECT id, tenant_id, email, display_name, role, status, last_active_at
       FROM platform_users
       WHERE email = $1
       LIMIT 1`,
      [email]
    );
    if (existingUser.rows[0]) {
      throw new Error("A user with that email already exists");
    }

    const userId = crypto.randomUUID();
    const client = await pool.connect();
    try {
      await client.query("BEGIN");

      await client.query(
        `
          INSERT INTO platform_users (
            id, tenant_id, email, password_hash, display_name, role, platform_role, status, last_active_at, created_at, updated_at
          ) VALUES (
            $1, $2, $3, $4, $5, $6, $7, 'ACTIVE', NOW(), NOW(), NOW()
          )
        `,
        [userId, tenant.id, email, hashPassword(temporaryPassword), displayName, role, input.platformRole ?? "PLATFORM_MEMBER"]
      );

      await client.query(
        `
          INSERT INTO tenant_memberships (user_id, tenant_id, role, created_at)
          VALUES ($1, $2, $3, NOW())
          ON CONFLICT (user_id, tenant_id) DO UPDATE SET
            role = EXCLUDED.role
        `,
        [userId, tenant.id, role]
      );

      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }

    await this.auditService.log({
      tenantId: tenant.id,
      userId,
      action: "USER_CREATED",
      targetType: "platform_user",
      targetId: userId,
      metadata: { email, role }
    });

    return {
      id: userId,
      tenantId: tenant.id,
      tenantName: tenant.name,
      email,
      displayName,
      role,
      platformRole: input.platformRole ?? "PLATFORM_MEMBER",
      status: "ACTIVE",
      lastActiveAt: new Date().toISOString(),
      temporaryPassword
    };
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
