import Link from "next/link";

import { Nav } from "../components/nav";

const pillars = [
  {
    title: "MSP Control",
    body: "Run a central Nexian operations console for onboarding, connector health, and customer governance."
  },
  {
    title: "Customer Portals",
    body: "Give each customer a polished workspace for integrations, permissions, and MCP access."
  },
  {
    title: "Commercial Readiness",
    body: "Package the platform as a sellable managed service rather than an internal-only tool."
  }
];

export default function HomePage() {
  return (
    <main className="shell shell-landing stack">
      <Nav />

      <section className="landing-hero">
        <div className="stack">
          <span className="eyebrow">Nexian Managed AI Platform</span>
          <h1 className="hero-title">
            A multi-tenant MSP platform Nexian can run internally and sell to customers.
          </h1>
          <p className="hero-text">
            Nexian Command turns your connector estate into a governed AI control plane with customer workspaces,
            role-aware MCP access, and a corporate product shell that feels ready for managed service packaging.
          </p>
          <div className="row">
            <Link className="button primary" href="/auth/login">
              Open platform
            </Link>
            <a className="button secondary" href="https://www.nexian.co.uk" target="_blank" rel="noreferrer">
              nexian.co.uk
            </a>
          </div>
          <div className="chip-row">
            <span className="chip">Multi-tenant</span>
            <span className="chip">MSP-ready</span>
            <span className="chip">Customer-facing</span>
            <span className="chip">Governed MCP</span>
          </div>
        </div>

        <div className="hero-board">
          <div className="hero-board-card">
            <span className="eyebrow">What You Get</span>
            <strong>One platform for Nexian and every managed customer workspace.</strong>
            <ul className="clean-list">
              <li>Central MSP oversight across tenants and connectors.</li>
              <li>Customer-specific workspaces with isolated identities and access.</li>
              <li>Nexian-branded operations shell with a proper side navigation model.</li>
              <li>Commercially packageable integration platform experience.</li>
            </ul>
          </div>
          <div className="hero-board-metric">
            <span>Brand Direction</span>
            <strong>Corporate, secure, modern, and aligned to Nexian’s managed services positioning.</strong>
          </div>
        </div>
      </section>

      <section className="grid three">
        {pillars.map((pillar) => (
          <article key={pillar.title} className="panel stack">
            <span className="eyebrow">{pillar.title}</span>
            <h2>{pillar.title}</h2>
            <p className="muted">{pillar.body}</p>
          </article>
        ))}
      </section>
    </main>
  );
}
