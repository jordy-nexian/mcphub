import crypto from "node:crypto";

export interface OAuthStatePayload {
  tenantId: string;
  userId: string;
  provider: string;
  returnTo?: string;
  codeVerifier?: string;
}

export function createOAuthState(payload: OAuthStatePayload, signingSecret: string): string {
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const signature = crypto.createHmac("sha256", signingSecret).update(body).digest("base64url");
  return `${body}.${signature}`;
}

export function verifyOAuthState(state: string, signingSecret: string): OAuthStatePayload {
  const [body, signature] = state.split(".");
  const expected = crypto.createHmac("sha256", signingSecret).update(body).digest("base64url");
  if (signature !== expected) {
    throw new Error("Invalid OAuth state signature");
  }

  return JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as OAuthStatePayload;
}
