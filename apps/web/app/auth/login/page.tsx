"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";

import { writePlatformSession } from "../../../lib/platform-auth";

type Mode = "login" | "register";

export default function LoginPage() {
  const router = useRouter();
  const [mode, setMode] = useState<Mode>("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
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
        headers: {
          "content-type": "application/json"
        },
        body: JSON.stringify(
          mode === "login"
            ? { email, password }
            : { email, password, displayName, workspaceName }
        )
      });

      const payload = (await response.json()) as { error?: string; message?: string; token?: string };
      if (!response.ok) {
        throw new Error(payload.message ?? payload.error ?? "Authentication failed");
      }

      writePlatformSession(payload as never);
      router.push("/dashboard/connectors");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Could not authenticate.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="shell">
      <section className="panel stack" style={{ maxWidth: 560, margin: "80px auto" }}>
        <span className="eyebrow">Platform Login</span>
        <h1 style={{ margin: 0 }}>{mode === "login" ? "Sign in to Nexian MCP Hub" : "Create your Nexian workspace"}</h1>
        <p className="muted" style={{ margin: 0 }}>
          {mode === "login"
            ? "Use your platform account to manage connectors and issue user-scoped MCP tokens."
            : "Create a workspace owner account. Connector access and MCP tokens will be scoped to this tenant and user."}
        </p>

        {mode === "register" ? (
          <>
            <label className="stack">
              <span>Full name</span>
              <input value={displayName} onChange={(event) => setDisplayName(event.target.value)} placeholder="Jordy Whitehouse" />
            </label>
            <label className="stack">
              <span>Workspace name</span>
              <input value={workspaceName} onChange={(event) => setWorkspaceName(event.target.value)} placeholder="Nexian MSP" />
            </label>
          </>
        ) : null}

        <label className="stack">
          <span>Email</span>
          <input value={email} onChange={(event) => setEmail(event.target.value)} type="email" placeholder="admin@example.com" />
        </label>
        <label className="stack">
          <span>Password</span>
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
      </section>
    </main>
  );
}
