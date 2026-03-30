"use client";

import type { Route } from "next";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";

import { NexianLogo } from "../../../components/nexian-logo";
import { writePlatformSession } from "../../../lib/platform-auth";

type Mode = "login" | "register";

export default function LoginPage() {
  const router = useRouter();
  const [mode, setMode] = useState<Mode>("login");
  const [email, setEmail] = useState("admin@nexian.co.uk");
  const [password, setPassword] = useState("demo12345");
  const [displayName, setDisplayName] = useState("");
  const [workspaceName, setWorkspaceName] = useState("");
  const [notice, setNotice] = useState("");
  const [loading, setLoading] = useState(false);

  const apiOrigin = useMemo(
    () => process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000",
    []
  );

  async function submit() {
    setLoading(true);
    setNotice("");

    try {
      const response = await fetch(`${apiOrigin}/auth/${mode}`, {
        method: "POST",
        credentials: "include",
        headers: {
          "content-type": "application/json"
        },
        body: JSON.stringify(
          mode === "login"
            ? { email, password }
            : { email, password, displayName, workspaceName }
        )
      });

      const payload = (await response.json()) as { error?: string; message?: string; tenant?: { slug: string } };
      if (!response.ok) {
        throw new Error(payload.message ?? payload.error ?? "Authentication failed");
      }

      writePlatformSession(payload as never);
      router.push((payload.tenant?.slug?.includes("nexian") ? "/admin/dashboard" : "/dashboard") as Route);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Could not authenticate.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="auth-shell">
      <section className="auth-card">
        <div className="stack">
          <span className="auth-logo-wrap">
            <NexianLogo className="auth-logo-image" priority="high" />
          </span>
          <span className="eyebrow">Nexian Command</span>
          <h1>{mode === "login" ? "Sign in to the MSP platform" : "Create a customer workspace"}</h1>
          <p className="muted">
            {mode === "login"
              ? "Access the Nexian operations console or a managed customer workspace."
              : "Create a workspace owner account for a new customer environment."}
          </p>
        </div>

        {mode === "register" ? (
          <>
            <label className="stack">
              <span className="field-label">Full name</span>
              <input value={displayName} onChange={(event) => setDisplayName(event.target.value)} placeholder="Jordy Whitehouse" />
            </label>
            <label className="stack">
              <span className="field-label">Workspace name</span>
              <input value={workspaceName} onChange={(event) => setWorkspaceName(event.target.value)} placeholder="Nexian Customer Workspace" />
            </label>
          </>
        ) : null}

        <label className="stack">
          <span className="field-label">Email</span>
          <input value={email} onChange={(event) => setEmail(event.target.value)} type="email" placeholder="admin@nexian.co.uk" />
        </label>

        <label className="stack">
          <span className="field-label">Password</span>
          <input value={password} onChange={(event) => setPassword(event.target.value)} type="password" placeholder="Use 8+ characters" />
        </label>

        {notice ? <div className="notice">{notice}</div> : null}

        <div className="row">
          <button className="button primary" type="button" onClick={() => void submit()} disabled={loading}>
            {loading ? "Working..." : mode === "login" ? "Sign in" : "Create workspace"}
          </button>
          <button className="button secondary" type="button" onClick={() => setMode(mode === "login" ? "register" : "login")}>
            {mode === "login" ? "Create account" : "I already have an account"}
          </button>
        </div>

        <div className="auth-footnote">
          <strong>Seeded MSP account</strong>
          <p>Use `admin@nexian.co.uk` with password `demo12345` to access the Nexian MSP console immediately.</p>
        </div>
      </section>
    </main>
  );
}
