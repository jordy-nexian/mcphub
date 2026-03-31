"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";

import { PageHeader } from "../../../../components/page-header";
import { readPlatformSession, type PlatformSession } from "../../../../lib/platform-auth";

type UserRecord = {
  id: string;
  tenantId: string;
  tenantName: string;
  tenantType: string;
  email: string;
  displayName: string;
  role: string;
  platformRole: string;
  status: string;
  lastActiveAt: string;
};

type TenantRecord = {
  id: string;
  name: string;
  slug: string;
  type: string;
  status: string;
};

export default function AdminUsersPage() {
  const router = useRouter();
  const [session, setSession] = useState<PlatformSession | null>(null);
  const [users, setUsers] = useState<UserRecord[]>([]);
  const [tenants, setTenants] = useState<TenantRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [notice, setNotice] = useState("");

  const [email, setEmail] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [tenantId, setTenantId] = useState("");
  const [role, setRole] = useState("USER");
  const [platformRole, setPlatformRole] = useState("PLATFORM_MEMBER");
  const [temporaryPassword, setTemporaryPassword] = useState("");

  const apiOrigin = useMemo(
    () => process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000",
    []
  );

  useEffect(() => {
    const storedSession = readPlatformSession();
    if (!storedSession) {
      router.replace("/auth/login");
      return;
    }

    setSession(storedSession);
  }, [router]);

  useEffect(() => {
    async function loadData() {
      if (!session) {
        return;
      }

      setLoading(true);
      setNotice("");

      try {
        const [usersResponse, tenantsResponse] = await Promise.all([
          fetch(`${apiOrigin}/platform/users`, {
            headers: { authorization: `Bearer ${session.token}` }
          }),
          fetch(`${apiOrigin}/platform/tenants`, {
            headers: { authorization: `Bearer ${session.token}` }
          })
        ]);

        if (!usersResponse.ok) {
          throw new Error(`Could not load users (${usersResponse.status})`);
        }
        if (!tenantsResponse.ok) {
          throw new Error(`Could not load tenants (${tenantsResponse.status})`);
        }

        const usersPayload = (await usersResponse.json()) as { users: UserRecord[] };
        const tenantsPayload = (await tenantsResponse.json()) as { tenants: TenantRecord[] };

        setUsers(usersPayload.users);
        setTenants(tenantsPayload.tenants);
        setTenantId((current) => current || tenantsPayload.tenants.find((item) => item.type === "CUSTOMER")?.id || tenantsPayload.tenants[0]?.id || "");
      } catch (error) {
        setNotice(error instanceof Error ? error.message : "Could not load users.");
      } finally {
        setLoading(false);
      }
    }

    void loadData();
  }, [apiOrigin, session]);

  async function inviteUser() {
    if (!session) {
      return;
    }

    setCreating(true);
    setNotice("");

    try {
      const response = await fetch(`${apiOrigin}/platform/users`, {
        method: "POST",
        credentials: "include",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${session.token}`
        },
        body: JSON.stringify({
          tenantId,
          email,
          displayName,
          role,
          platformRole,
          temporaryPassword: temporaryPassword || undefined
        })
      });

      const payload = (await response.json()) as
        | (UserRecord & { temporaryPassword?: string })
        | { error?: string; message?: string };

      if (!response.ok) {
        throw new Error(("message" in payload && payload.message) || ("error" in payload && payload.error) || "Could not create user");
      }

      const createdUser = payload as UserRecord & { temporaryPassword?: string };
      setUsers((current) =>
        [createdUser, ...current].sort((left, right) => left.displayName.localeCompare(right.displayName))
      );
      setEmail("");
      setDisplayName("");
      setTemporaryPassword("");
      setRole("USER");
      setPlatformRole("PLATFORM_MEMBER");
      setNotice(
        createdUser.temporaryPassword
          ? `Created ${createdUser.displayName}. Temporary password: ${createdUser.temporaryPassword}`
          : `Created ${createdUser.displayName}.`
      );
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Could not create user.");
    } finally {
      setCreating(false);
    }
  }

  return (
    <div className="stack">
      <PageHeader
        eyebrow="Identity"
        title="Platform users"
        description="Users across customer estates and internal Nexian oversight."
      />

      <div className="panel stack">
        <div className="row row-spread row-wrap">
          <div className="stack stack-tight">
            <strong>Invite or create a user</strong>
            <p className="muted">Create a new platform user, assign them to a tenant, and give them a temporary password.</p>
          </div>
        </div>

        <div className="grid two">
          <label className="stack">
            <span className="field-label">Full name</span>
            <input value={displayName} onChange={(event) => setDisplayName(event.target.value)} placeholder="Jordan Smith" />
          </label>
          <label className="stack">
            <span className="field-label">Email</span>
            <input value={email} onChange={(event) => setEmail(event.target.value)} placeholder="jordan@example.com" type="email" />
          </label>
          <label className="stack">
            <span className="field-label">Tenant</span>
            <select value={tenantId} onChange={(event) => setTenantId(event.target.value)}>
              {tenants.map((tenant) => (
                <option key={tenant.id} value={tenant.id}>
                  {tenant.name} ({tenant.type})
                </option>
              ))}
            </select>
          </label>
          <label className="stack">
            <span className="field-label">Role</span>
            <select value={role} onChange={(event) => setRole(event.target.value)}>
              <option value="OWNER">OWNER</option>
              <option value="ADMIN">ADMIN</option>
              <option value="ANALYST">ANALYST</option>
              <option value="USER">USER</option>
            </select>
          </label>
          <label className="stack">
            <span className="field-label">Platform role</span>
            <select value={platformRole} onChange={(event) => setPlatformRole(event.target.value)}>
              <option value="PLATFORM_MEMBER">PLATFORM_MEMBER</option>
              <option value="PLATFORM_OPERATOR">PLATFORM_OPERATOR</option>
              <option value="PLATFORM_ADMIN">PLATFORM_ADMIN</option>
              <option value="PLATFORM_OWNER">PLATFORM_OWNER</option>
            </select>
          </label>
          <label className="stack">
            <span className="field-label">Temporary password</span>
            <input
              value={temporaryPassword}
              onChange={(event) => setTemporaryPassword(event.target.value)}
              placeholder="Leave blank to auto-generate"
              type="text"
            />
          </label>
        </div>

        <div className="row">
          <button className="button primary" type="button" onClick={() => void inviteUser()} disabled={creating}>
            {creating ? "Creating..." : "Invite user"}
          </button>
        </div>

        {notice ? <div className="notice">{notice}</div> : null}
      </div>

      <div className="data-table-wrapper">
        {loading ? (
          <div className="panel">Loading users...</div>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Name</th>
                <th>Email</th>
                <th>Tenant</th>
                <th>Role</th>
                <th>Platform</th>
                <th>Status</th>
                <th>Last active</th>
              </tr>
            </thead>
            <tbody>
              {users.map((user) => (
                <tr key={user.id}>
                  <td>{user.displayName}</td>
                  <td>{user.email}</td>
                  <td>{user.tenantName}</td>
                  <td><span className="chip">{user.role}</span></td>
                  <td><span className="chip">{user.platformRole}</span></td>
                  <td>{user.status}</td>
                  <td>{new Date(user.lastActiveAt).toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
