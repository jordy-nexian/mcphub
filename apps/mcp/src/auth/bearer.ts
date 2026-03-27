import jwt from "jsonwebtoken";

import type { AuthContext } from "@nexian/core/domain/models";

export function parseBearerToken(headerValue: string | undefined, secret: string): AuthContext {
  if (!headerValue?.startsWith("Bearer ")) {
    throw new Error("Missing bearer token");
  }

  const token = headerValue.slice("Bearer ".length);
  const payload = jwt.verify(token, secret) as AuthContext;
  return payload;
}

