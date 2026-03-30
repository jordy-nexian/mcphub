import { PageHeader } from "../../../../components/page-header";
import { demoUsers } from "../../../../lib/demo-data";

export default function AdminUsersPage() {
  return (
    <div className="stack">
      <PageHeader
        eyebrow="Identity"
        title="Platform users"
        description="Users across customer estates and internal Nexian oversight."
        actions={<button className="button primary">Invite user</button>}
      />

      <div className="data-table-wrapper">
        <table>
          <thead><tr><th>Name</th><th>Email</th><th>Tenant</th><th>Role</th><th>Last active</th></tr></thead>
          <tbody>
            {demoUsers.map((user) => (
              <tr key={user.id}>
                <td>{user.name}</td>
                <td>{user.email}</td>
                <td>{user.tenantName}</td>
                <td><span className="chip">{user.role}</span></td>
                <td>{user.lastActive}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
