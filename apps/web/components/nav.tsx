import Link from "next/link";

const items = [
  { href: "/" as const, label: "Overview" },
  { href: "/dashboard/connectors" as const, label: "Control Centre" },
  { href: "/dashboard/audit" as const, label: "Audit" }
];

export function Nav() {
  return (
    <header className="topbar">
      <Link href="/" className="brand">
        <span className="brand-mark">n</span>
        <span className="brand-copy">
          <strong>nexian</strong>
          <span>Integration Platform </span>
        </span>
      </Link>
      <nav className="topnav">
        {items.map((item) => (
          <Link key={item.href} href={item.href} className="topnav-link">
            {item.label}
          </Link>
        ))}
      </nav>
      <div className="topbar-actions">
        <a className="button secondary" href="https://www.nexian.co.uk" target="_blank" rel="noreferrer">
          nexian.co.uk
        </a>
        <Link className="button primary" href="/auth/login">
          Sign in
        </Link>
      </div>
    </header>
  );
}
