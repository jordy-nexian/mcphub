"use client";

import { useEffect, type ReactNode } from "react";
import type { Route } from "next";
import { useRouter } from "next/navigation";

import { Sidebar } from "../../../components/sidebar";
import { readPlatformSession } from "../../../lib/platform-auth";

export default function AdminLayout({ children }: { children: ReactNode }) {
  const router = useRouter();

  useEffect(() => {
    const session = readPlatformSession();
    if (!session) {
      router.replace("/auth/login");
      return;
    }

    if (!session.tenant.slug.includes("nexian")) {
      router.replace("/dashboard" as Route);
    }
  }, [router]);

  return (
    <div className="app-shell">
      <Sidebar variant="admin" />
      <main className="main-content">
        <div className="main-content-inner">{children}</div>
      </main>
    </div>
  );
}
