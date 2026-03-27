import Link from "next/link";

export default function LoginPage() {
  return (
    <main className="shell">
      <section className="panel stack" style={{ maxWidth: 520, margin: "80px auto" }}>
        <span className="eyebrow">Platform Login</span>
        <h1 style={{ margin: 0 }}>Sign in to manage tenant connectors</h1>
        <label className="stack">
          <span>Email</span>
          <input type="email" placeholder="admin@example.com" />
        </label>
        <label className="stack">
          <span>Password</span>
          <input type="password" placeholder="••••••••" />
        </label>
        <div className="row">
          <Link href="/dashboard/connectors" className="button primary">
            Sign in
          </Link>
        </div>
      </section>
    </main>
  );
}

