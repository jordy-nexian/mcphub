"use client";

export interface PlatformSession {
  token: string;
  user: {
    id: string;
    tenantId: string;
    email: string;
    displayName: string;
    role: string;
    tenantRole: string;
    platformRole: string;
  };
  tenant: {
    id: string;
    slug: string;
    name: string;
  };
  tenants: Array<{
    id: string;
    slug: string;
    name: string;
    role: string;
  }>;
}

export function hasPlatformConsoleAccess(session: PlatformSession | null) {
  if (!session) {
    return false;
  }

  return ["PLATFORM_OWNER", "PLATFORM_ADMIN", "PLATFORM_OPERATOR"].includes(session.user.platformRole);
}

const sessionStorageKey = "nexian-platform-session";

export function readPlatformSession() {
  if (typeof window === "undefined") {
    return null;
  }

  const raw = window.localStorage.getItem(sessionStorageKey);
  if (!raw) {
    return null;
  }

  try {
    return JSON.parse(raw) as PlatformSession;
  } catch {
    return null;
  }
}

export function writePlatformSession(session: PlatformSession) {
  window.localStorage.setItem(sessionStorageKey, JSON.stringify(session));
}

export function clearPlatformSession() {
  window.localStorage.removeItem(sessionStorageKey);
}
