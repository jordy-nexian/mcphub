import { Client } from "pg";
import jwt from "jsonwebtoken";

const email = process.argv[2];
const expiresIn = process.argv[3] ?? "365d";

if (!email) {
  console.error("Usage: tsx scripts/issue-mcp-token.ts <email> [expiresIn]");
  console.error("Example: tsx scripts/issue-mcp-token.ts jordy.test@ilicomm.com 365d");
  process.exit(1);
}

const databaseUrl = process.env.DATABASE_URL;
const sessionSecret = process.env.SESSION_SECRET;

if (!databaseUrl) {
  console.error("DATABASE_URL must be set");
  process.exit(1);
}
if (!sessionSecret) {
  console.error("SESSION_SECRET must be set");
  process.exit(1);
}

const client = new Client({ connectionString: databaseUrl });
await client.connect();

const result = await client.query<{
  id: string;
  tenant_id: string;
  email: string;
  display_name: string;
  role: string;
}>(
  `
    SELECT u.id, u.tenant_id, u.email, u.display_name,
           COALESCE(tm.role, u.role) AS role
    FROM platform_users u
    LEFT JOIN tenant_memberships tm
      ON tm.user_id = u.id AND tm.tenant_id = u.tenant_id
    WHERE LOWER(u.email) = LOWER($1)
    LIMIT 1
  `,
  [email]
);

await client.end();

const user = result.rows[0];
if (!user) {
  console.error(`No platform user found for email: ${email}`);
  process.exit(1);
}

const token = jwt.sign(
  {
    tokenType: "mcp_access",
    tenantId: user.tenant_id,
    userId: user.id,
    roles: [user.role],
    email: user.email,
    displayName: user.display_name
  },
  sessionSecret,
  { expiresIn: expiresIn as jwt.SignOptions["expiresIn"] }
);

console.log(token);
