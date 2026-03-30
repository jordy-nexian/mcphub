"use client";

import { useEffect, type ReactNode } from "react";
import { useRouter } from "next/navigation";

import { Sidebar } from "../../components/sidebar";
import { readPlatformSession } from "../../lib/platform-auth";

export default function DashboardLayout({ children }: { children: ReactNode }) {
  const router = useRouter();

  useEffect(() => {
    const session = readPlatformSession();
    if (!session) {
      router.replace("/auth/login");
    }
  }, [router]);

  return (
    <div className="app-shell">
      <Sidebar variant="tenant" />
      <main className="main-content">
        <div className="main-content-inner">{children}</div>
      </main>
    </div>
  );
}
