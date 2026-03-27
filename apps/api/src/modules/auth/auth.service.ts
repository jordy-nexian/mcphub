import crypto from "node:crypto";

import jwt from "jsonwebtoken";

import { ensureDatabaseSchema, pool } from "../../common/db/postgres";
import { buildAppConfig } from "../../common/config/env";

const config = buildAppConfig();

export interface PlatformSession {
  token: string;
  user: {
    id: string;
    tenantId: string;
    email: string;
    displayName: string;
    role: string;
  };
  tenant: {
    id: string;
    slug: string;
    name: string;
  };
}

export interface PlatformAuthContext {
  userId: string;
  tenantId: string;
  email: string;
  displayName: string;
  role: string;
  tokenType: "platform_session";
}

export interface McpTokenContext {
  tenantId: string;
  userId: string;
  roles: string[];
  email: string;
  displayName: string;
  tokenType: "mcp_access";
}

interface RefreshTokenContext {
  tenantId: string;
  userId: string;
  role: string;
  email: string;
  displayName: string;
  tokenType: "mcp_refresh";
}

type TenantRow = {
  id: string;
  slug: string;
  name: string;
};

type UserRow = {
  id: string;
  tenant_id: string;
  email: string;
  password_hash: string;
  display_name: string;
  role: string;
};

type AuthorizationCodeRow = {
  code: string;
  client_id: string;
  user_id: string;
  tenant_id: string;
  redirect_uri: string;
  scope: string[];
  code_challenge: string | null;
  code_challenge_method: string | null;
  expires_at: Date;
  consumed_at: Date | null;
};

function slugifyWorkspaceName(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
}

function hashPassword(password: string) {
  const salt = crypto.randomBytes(16).toString("hex");
  const derived = crypto.scryptSync(password, salt, 64).toString("hex");
  return `${salt}:${derived}`;
}

function verifyPassword(password: string, storedHash: string) {
  const [salt, expectedHash] = storedHash.split(":");
  const actualHash = crypto.scryptSync(password, salt, 64).toString("hex");
  return crypto.timingSafeEqual(Buffer.from(expectedHash, "hex"), Buffer.from(actualHash, "hex"));
}

export class AuthService {
  private readonly ready = ensureDatabaseSchema();

  private issuePlatformToken(user: UserRow) {
    return jwt.sign(
      {
        tokenType: "platform_session",
        userId: user.id,
        tenantId: user.tenant_id,
        email: user.email,
        displayName: user.display_name,
        role: user.role
      } satisfies PlatformAuthContext,
      config.sessionSecret,
      { expiresIn: "7d" }
    );
  }

  issueSessionCookie(token: string) {
    return `nexian_session=${token}; Path=/; HttpOnly; Secure; SameSite=None; Max-Age=${60 * 60 * 24 * 7}`;
  }

  clearSessionCookie() {
    return "nexian_session=; Path=/; HttpOnly; Secure; SameSite=None; Max-Age=0";
  }

  private async loadTenant(tenantId: string) {
    const tenantResult = await pool.query<TenantRow>(
      `SELECT id, slug, name FROM tenants WHERE id = $1 LIMIT 1`,
      [tenantId]
    );
    const tenant = tenantResult.rows[0];
    if (!tenant) {
      throw new Error("Tenant not found");
    }
    return tenant;
  }

  private buildSession(user: UserRow, tenant: TenantRow): PlatformSession {
    return {
      token: this.issuePlatformToken(user),
      user: {
        id: user.id,
        tenantId: user.tenant_id,
        email: user.email,
        displayName: user.display_name,
        role: user.role
      },
      tenant
    };
  }

  async register(input: {
    email: string;
    password: string;
    displayName: string;
    workspaceName: string;
  }): Promise<PlatformSession> {
    await this.ready;

    const tenantId = crypto.randomUUID();
    const userId = crypto.randomUUID();
    const baseSlug = slugifyWorkspaceName(input.workspaceName) || "workspace";
    const uniqueSlug = `${baseSlug}-${tenantId.slice(0, 8)}`;

    const client = await pool.connect();
    try {
      await client.query("BEGIN");

      await client.query(
        `
          INSERT INTO tenants (id, slug, name, created_at, updated_at)
          VALUES ($1, $2, $3, NOW(), NOW())
        `,
        [tenantId, uniqueSlug, input.workspaceName]
      );

      await client.query(
        `
          INSERT INTO platform_users (id, tenant_id, email, password_hash, display_name, role, created_at, updated_at)
          VALUES ($1, $2, $3, $4, $5, $6, NOW(), NOW())
        `,
        [userId, tenantId, input.email.toLowerCase(), hashPassword(input.password), input.displayName, "OWNER"]
      );

      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }

    const tenant = await this.loadTenant(tenantId);
    const userResult = await pool.query<UserRow>(
      `SELECT id, tenant_id, email, password_hash, display_name, role FROM platform_users WHERE id = $1 LIMIT 1`,
      [userId]
    );

    return this.buildSession(userResult.rows[0], tenant);
  }

  async login(email: string, password: string): Promise<PlatformSession> {
    await this.ready;

    const userResult = await pool.query<UserRow>(
      `SELECT id, tenant_id, email, password_hash, display_name, role FROM platform_users WHERE email = $1 LIMIT 1`,
      [email.toLowerCase()]
    );
    const user = userResult.rows[0];

    if (!user || !verifyPassword(password, user.password_hash)) {
      throw new Error("Invalid email or password");
    }

    const tenant = await this.loadTenant(user.tenant_id);
    return this.buildSession(user, tenant);
  }

  async getSession(auth: PlatformAuthContext): Promise<PlatformSession> {
    await this.ready;

    const userResult = await pool.query<UserRow>(
      `SELECT id, tenant_id, email, password_hash, display_name, role FROM platform_users WHERE id = $1 LIMIT 1`,
      [auth.userId]
    );
    const user = userResult.rows[0];
    if (!user) {
      throw new Error("User not found");
    }

    const tenant = await this.loadTenant(user.tenant_id);
    return this.buildSession(user, tenant);
  }

  verifyPlatformToken(token: string): PlatformAuthContext {
    const payload = jwt.verify(token, config.sessionSecret) as PlatformAuthContext;
    if (payload.tokenType !== "platform_session") {
      throw new Error("Invalid platform session token");
    }
    return payload;
  }

  issueMcpAccessToken(input: { tenantId: string; userId: string; role: string; email: string; displayName: string }) {
    return jwt.sign(
      {
        tokenType: "mcp_access",
        tenantId: input.tenantId,
        userId: input.userId,
        roles: [input.role],
        email: input.email,
        displayName: input.displayName
      } satisfies McpTokenContext,
      config.sessionSecret,
      { expiresIn: "1h" }
    );
  }

  issueMcpRefreshToken(input: { tenantId: string; userId: string; role: string; email: string; displayName: string }) {
    return jwt.sign(
      {
        tokenType: "mcp_refresh",
        tenantId: input.tenantId,
        userId: input.userId,
        role: input.role,
        email: input.email,
        displayName: input.displayName
      } satisfies RefreshTokenContext,
      config.sessionSecret,
      { expiresIn: "30d" }
    );
  }

  verifyRefreshToken(token: string): RefreshTokenContext {
    const payload = jwt.verify(token, config.sessionSecret) as RefreshTokenContext;
    if (payload.tokenType !== "mcp_refresh") {
      throw new Error("Invalid refresh token");
    }
    return payload;
  }

  async createAuthorizationCode(input: {
    clientId: string;
    userId: string;
    tenantId: string;
    redirectUri: string;
    scope: string[];
    codeChallenge?: string;
    codeChallengeMethod?: string;
  }) {
    await this.ready;

    const code = crypto.randomBytes(32).toString("hex");
    await pool.query(
      `
        INSERT INTO oauth_authorization_codes (
          code,
          client_id,
          user_id,
          tenant_id,
          redirect_uri,
          scope,
          code_challenge,
          code_challenge_method,
          expires_at,
          consumed_at,
          created_at
        ) VALUES (
          $1, $2, $3, $4, $5, $6::text[], $7, $8, NOW() + interval '10 minutes', NULL, NOW()
        )
      `,
      [
        code,
        input.clientId,
        input.userId,
        input.tenantId,
        input.redirectUri,
        input.scope,
        input.codeChallenge ?? null,
        input.codeChallengeMethod ?? null
      ]
    );

    return code;
  }

  async consumeAuthorizationCode(code: string, clientId: string, redirectUri: string) {
    await this.ready;

    const result = await pool.query<AuthorizationCodeRow>(
      `
        UPDATE oauth_authorization_codes
        SET consumed_at = NOW()
        WHERE code = $1
          AND client_id = $2
          AND redirect_uri = $3
          AND consumed_at IS NULL
          AND expires_at > NOW()
        RETURNING *
      `,
      [code, clientId, redirectUri]
    );

    const record = result.rows[0];
    if (!record) {
      throw new Error("Invalid or expired authorization code");
    }

    const userResult = await pool.query<UserRow>(
      `SELECT id, tenant_id, email, password_hash, display_name, role FROM platform_users WHERE id = $1 LIMIT 1`,
      [record.user_id]
    );
    const user = userResult.rows[0];
    if (!user) {
      throw new Error("User not found for authorization code");
    }

    return {
      code: record,
      user
    };
  }
}
