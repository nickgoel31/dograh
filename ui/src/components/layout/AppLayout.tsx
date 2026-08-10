"use client";

import { AlertTriangle, RefreshCw, Search } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import React, { ReactNode } from "react";

import { Button } from "@/components/ui/button";
import { useAppConfig } from "@/context/AppConfigContext";

import { AppSidebar } from "./AppSidebar";
import { DualSidebarLayout } from "./DualSidebarLayout";

// Map pathnames to human-readable page names for breadcrumb display
const PAGE_NAMES: Record<string, string> = {
  "/overview": "Overview",
  "/workflow": "Voice Agents",
  "/campaigns": "Campaigns",
  "/model-configurations": "Models",
  "/telephony-configurations": "Telephony",
  "/tools": "Tools",
  "/files": "Files",
  "/recordings": "Recordings",
  "/api-keys": "Developers",
  "/usage": "Agent Runs",
  "/billing": "Billing",
  "/reports": "Reports",
  "/settings": "Settings",
  "/whatsapp": "WhatsApp Logs",
  "/superadmin": "Platform Orgs",
};

function getPageName(pathname: string): string {
  // Exact match first
  if (PAGE_NAMES[pathname]) return PAGE_NAMES[pathname];
  // Prefix match for nested routes
  for (const key of Object.keys(PAGE_NAMES).sort((a, b) => b.length - a.length)) {
    if (pathname.startsWith(key)) return PAGE_NAMES[key];
  }
  return "";
}

function NeuralHeader() {
  const pathname = usePathname();
  const pageName = getPageName(pathname);

  return (
    <header className="sticky top-0 z-50 flex h-16 items-center justify-between px-6 pb-6 pt-6 mb-4 border-b border-gray-100 dark:border-[#282b26] bg-white dark:bg-[#161715] transition-all duration-300">
      {/* Left: mobile menu + page name */}
      <div className="flex items-center gap-3">
        {/* Mobile logo */}
        <Link href="/" className="flex items-center gap-2 text-sm font-bold md:hidden">
          <Image
            src="/logo.webp"
            alt="Swarvo AI"
            width={28}
            height={28}
            className="rounded-xl object-cover dark:invert"
            unoptimized
          />
          <span className="font-bold tracking-tight text-white">Swarvo AI</span>
        </Link>

        {/* Page breadcrumb — desktop only */}
        {pageName && (
          <div className="hidden md:flex items-center gap-2">
            <span className="text-sm font-bold text-white tracking-tight">{pageName}</span>
          </div>
        )}
      </div>

      {/* Right: search hint + wallet + actions */}
      <div className="flex items-center gap-3">
        {/* Search hint button */}
        <button
          className="hidden md:flex items-center gap-2 rounded-xl border border-[#1d1d22] bg-[#111113] px-3.5 py-1.5 text-xs text-zinc-300 hover:bg-[#1a1a1f] hover:text-white transition-all duration-150 cursor-pointer"
          onClick={() => {/* future: open command palette */}}
          aria-label="Search"
        >
          <Search className="h-3.5 w-3.5 text-zinc-500" />
          <span>Search</span>
          <kbd className="ml-1 rounded border border-[#232328] px-1 font-mono text-[9px] text-zinc-600">⌘K</kbd>
        </button>

      </div>
    </header>
  );
}

function BackendStatusBanner() {
  const { config, loading, refresh } = useAppConfig();

  if (!config || config.backendStatus === "reachable") {
    return null;
  }

  const backendUrl = config.backendUrl && config.backendUrl !== "unknown"
    ? config.backendUrl
    : "the configured backend";
  const message = config.backendMessage || `Backend is not reachable at ${backendUrl}.`;

  return (
    <div
      role="alert"
      className="border-b border-amber-500/30 bg-amber-500/8 px-4 py-2.5 text-amber-700 dark:text-amber-300"
    >
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex min-w-0 items-center gap-2.5">
          <AlertTriangle className="h-4 w-4 shrink-0" />
          <div className="min-w-0">
            <span className="text-sm font-semibold">Backend unreachable — </span>
            <span className="text-sm">{message}</span>
          </div>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => void refresh()}
          disabled={loading}
          className="h-7 shrink-0 border-amber-500/40 text-amber-700 dark:text-amber-300 hover:bg-amber-500/10 text-xs"
        >
          <RefreshCw className="h-3.5 w-3.5 mr-1" />
          Retry
        </Button>
      </div>
    </div>
  );
}

interface AppLayoutProps {
  children: ReactNode;
  headerActions?: ReactNode;
  stickyTabs?: ReactNode;
}

const AppLayout: React.FC<AppLayoutProps> = ({
  children,
  headerActions,
  stickyTabs,
}) => {
  const pathname = usePathname();

  const shouldShowSidebar = pathname !== "/" && !pathname.startsWith("/handler") && !pathname.startsWith("/auth");
  const isWorkflowEditor = /^\/workflow\/\d+$/.test(pathname);

  if (!shouldShowSidebar) {
    return (
      <div className="flex-1 w-full bg-background">
        <BackendStatusBanner />
        {children}
      </div>
    );
  }

  return (
    <DualSidebarLayout>
      <BackendStatusBanner />
      {!isWorkflowEditor && pathname !== '/workflow' && !pathname.startsWith('/campaigns') && pathname !== '/model-configurations' && pathname !== '/tools' && pathname !== '/files' && pathname !== '/recordings' && !pathname.startsWith('/telephony-configurations') && pathname !== '/usage' && pathname !== '/reports' && pathname !== '/billing' && pathname !== '/api-keys' && <NeuralHeader />}

      {headerActions && (
        <header className="neural-header sticky top-0 z-50 w-full">
          <div className="container mx-auto px-4 py-3">
            <div className="flex items-center justify-center">
              {headerActions}
            </div>
          </div>
        </header>
      )}

      {stickyTabs && (
        <div className="neural-header sticky top-11 z-40">
          <div className="container mx-auto px-4">
            <div className="flex items-center justify-center py-2">
              {stickyTabs}
            </div>
          </div>
        </div>
      )}

      <div className="relative z-10 flex-1 h-full page-enter" style={{backgroundColor: '#161715'}}>
        {children}
      </div>
    </DualSidebarLayout>
  );
};


export default AppLayout;
