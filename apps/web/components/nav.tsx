import Link from "next/link";
import type { Route } from "next";

const items = [
  { href: "/" as const, label: "Overview" },
  { href: "/auth/login" as const, label: "Platform Access" },
  { href: "/admin/dashboard" as const, label: "MSP Console" }
];

export function Nav() {
  return (
    <header className="topbar">
      <Link href="/" className="brand">
        <span className="brand-mark">N</span>
        <span className="brand-copy">
          <strong>Nexian Command</strong>
          <span>Managed AI Integration Platform</span>
        </span>
      </Link>

      <nav className="topnav">
        {items.map((item) => (
          <Link key={item.href} href={item.href as Route} className="topnav-link">
            {item.label}
          </Link>
        ))}
      </nav>

      <div className="topbar-actions">
        <a className="button secondary" href="https://www.nexian.co.uk" target="_blank" rel="noreferrer">
          nexian.co.uk
        </a>
        <Link className="button primary" href={"/auth/login" as Route}>
          Sign in
        </Link>
      </div>
    </header>
  );
}
