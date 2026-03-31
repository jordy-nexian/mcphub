"use client";

import { useMemo, useState } from "react";

import { readPlatformSession } from "../lib/platform-auth";

export function McpAccessPanel() {
  const [token, setToken] = useState("");
  const [notice, setNotice] = useState("");
  const [loading, setLoading] = useState(false);
  const [copied, setCopied] = useState("");

  const origin = typeof window === "undefined" ? "http://localhost:3000" : window.location.origin;
  const apiOrigin = useMemo(
    () => process.env.NEXT_PUBLIC_API_URL ?? origin.replace(":3000", ":4000"),
    [origin]
  );
  const mcpUrl = process.env.NEXT_PUBLIC_MCP_URL ?? origin.replace(":3000", ":4100");

  async function generateToken() {
    const session = readPlatformSession();
    if (!session) {
      setNotice("Sign in again before generating an MCP token.");
      return;
    }

    setLoading(true);
    setNotice("");

    try {
      const response = await fetch(`${apiOrigin}/auth/mcp-token`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${session.token}`
        }
      });

      const payload = (await response.json()) as { token?: string; error?: string; message?: string };
      if (!response.ok || !payload.token) {
        throw new Error(payload.message ?? payload.error ?? `Failed to create MCP token (${response.status})`);
      }

      setToken(payload.token);
      setNotice("Fresh workspace-scoped MCP token generated.");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Could not create the MCP token.");
    } finally {
      setLoading(false);
    }
  }

  async function copy(value: string, label: string) {
    await navigator.clipboard.writeText(value);
    setCopied(label);
    window.setTimeout(() => setCopied(""), 1500);
  }

  return (
    <div className="stack">
      {notice ? <div className="notice">{notice}</div> : null}

      <section className="grid two">
        <article className="panel stack">
          <span className="eyebrow">Tenant Endpoint</span>
          <h2>Workspace MCP URL</h2>
          <div className="credential-card">
            <span className="field-label">MCP URL</span>
            <code>{mcpUrl}</code>
            <button className="button secondary" onClick={() => void copy(mcpUrl, "url")} type="button">
              {copied === "url" ? "Copied" : "Copy URL"}
            </button>
          </div>
          <p className="muted">
            Use this endpoint in Claude, ChatGPT, or Copilot Studio so calls stay scoped to the active customer workspace.
          </p>
        </article>

        <article className="panel stack">
          <span className="eyebrow">Bearer Access</span>
          <h2>Issue a token</h2>
          <div className="credential-card">
            <span className="field-label">Bearer token</span>
            <code>{token || "Generate a backend-signed MCP token for testing and connector setup."}</code>
            <div className="row">
              <button className="button primary" onClick={() => void generateToken()} type="button" disabled={loading}>
                {loading ? "Generating..." : "Generate token"}
              </button>
              {token ? (
                <button className="button secondary" onClick={() => void copy(token, "token")} type="button">
                  {copied === "token" ? "Copied" : "Copy token"}
                </button>
              ) : null}
            </div>
          </div>
          <div className="notice">
            Example header: <code>Authorization: Bearer &lt;token&gt;</code>
          </div>
        </article>
      </section>
    </div>
  );
}
