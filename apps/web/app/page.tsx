import Link from "next/link";

import { Nav } from "../components/nav";

const features = [
  "Professional-services-first AI and automation",
  "A single MCP endpoint per client workspace",
  "Per-user connector consent and safe tool exposure",
  "Nexian-style governance across tickets, docs, CRM, and M365"
];

export default function HomePage() {
  return (
    <main className="shell stack">
      <Nav />
      <section className="hero landing-hero">
        <div className="stack">
          <span className="eyebrow">nexian AI Platform</span>
          <h1 className="hero-title">A cleaner control layer for MSP-ready MCP access.</h1>
          <p className="muted hero-text">
            Built around Nexian’s proactive technology partner positioning, this workspace turns disconnected support,
            document, and CRM systems into a single governed AI surface.
          </p>
          <div className="row">
            <Link className="button primary" href="/dashboard/connectors">
              Launch control centre
            </Link>
            <a className="button secondary" href="https://www.nexian.co.uk/ai-and-automation" target="_blank" rel="noreferrer">
              View AI & Automation
            </a>
          </div>
        </div>
        <div className="panel panel-dark stack landing-panel">
          <span className="eyebrow">What You Get</span>
          <strong className="workspace-name">Hosted tenant MCP workspace</strong>
          <div className="feature-list">
            {features.map((feature) => (
              <div key={feature} className="feature-row">
                <span className="feature-dot" />
                <span>{feature}</span>
              </div>
            ))}
          </div>
        </div>
      </section>
      <section className="grid two">
        <article className="panel stack">
          <span className="eyebrow">Current Build</span>
          <h2>What works locally right now</h2>
          <p className="muted">
            The UI is now interactive and locally stateful, the API and MCP services are scaffolded, and you can test
            the product flow without waiting on live connector auth or database persistence.
          </p>
        </article>
        <article className="panel stack">
          <span className="eyebrow">Next Milestone</span>
          <h2>What still needs wiring</h2>
          <p className="muted">
            Real OAuth callbacks, persistent connected accounts, stored policies, and live MCP tool execution still need
            backend integration work.
          </p>
        </article>
      </section>
      <section className="grid two">
        {features.map((feature) => (
          <article key={feature} className="panel">
            <p style={{ margin: 0, fontWeight: 700 }}>{feature}</p>
          </article>
        ))}
      </section>
      <section className="panel stack">
        <span className="eyebrow">Fast Route</span>
        <h2>Where to start</h2>
        <p className="muted">
          Open the control centre, simulate service connections, then copy the demo MCP URL and token for local testing.
        </p>
      </section>
    </main>
  );
}
