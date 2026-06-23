"use client";

import { AlertTriangle, Menu, RefreshCw, Search } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import React, { ReactNode } from "react";

import { Button } from "@/components/ui/button";
import { SidebarInset, SidebarProvider, useSidebar } from "@/components/ui/sidebar";
import { useAppConfig } from "@/context/AppConfigContext";

import { AppSidebar } from "./AppSidebar";
import { WalletBalance } from "./WalletBalance";

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
  const { toggleSidebar } = useSidebar();
  const pathname = usePathname();
  const pageName = getPageName(pathname);

  return (
    <header className="neural-header sticky top-0 z-50 flex h-11 items-center justify-between px-4 transition-all duration-300">
      {/* Left: mobile menu + page name */}
      <div className="flex items-center gap-3">
        <Button
          variant="ghost"
          size="icon"
          onClick={toggleSidebar}
          aria-label="Open menu"
          className="md:hidden h-7 w-7 rounded-md hover:bg-accent text-muted-foreground hover:text-foreground"
        >
          <Menu className="h-4 w-4" />
        </Button>

        {/* Mobile logo */}
        <Link href="/" className="flex items-center gap-2 text-sm font-bold md:hidden">
          <Image
            src="/logo.webp"
            alt="Swarvo AI"
            width={22}
            height={22}
            className="rounded-md object-cover dark:invert"
            unoptimized
          />
          <span className="font-bold tracking-tight">Swarvo AI</span>
        </Link>

        {/* Page breadcrumb — desktop only */}
        {pageName && (
          <div className="hidden md:flex items-center gap-2">
            <span className="text-sm font-semibold text-foreground tracking-tight">{pageName}</span>
          </div>
        )}
      </div>

      {/* Right: search hint + wallet + actions */}
      <div className="flex items-center gap-2">
        {/* Search hint button */}
        <button
          className="hidden md:flex items-center gap-2 rounded-md border border-border/60 bg-muted/40 px-2.5 py-1 text-xs text-muted-foreground hover:bg-muted hover:text-foreground transition-all duration-150"
          onClick={() => {/* future: open command palette */}}
          aria-label="Search"
        >
          <Search className="h-3 w-3" />
          <span>Search</span>
          <kbd className="ml-1 rounded border border-border px-1 font-mono text-[10px] text-muted-foreground/60">⌘K</kbd>
        </button>

        <div className="h-4 w-px bg-border/50 hidden md:block" />
        <WalletBalance />
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

  return (
    <SidebarProvider defaultOpen>
      {shouldShowSidebar ? (
        <div className="flex min-h-screen w-full bg-background">
          <div className="relative z-20 flex-shrink-0">
            <AppSidebar />
          </div>

          <SidebarInset className="relative z-10 flex-1 flex flex-col min-w-0 border-l border-border/30">
            <BackendStatusBanner />
            {!isWorkflowEditor && <NeuralHeader />}

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

            <main className="relative z-10 flex-1 page-enter">
              {children}
            </main>
          </SidebarInset>
        </div>
      ) : (
        <div className="flex-1 w-full bg-background">
          <BackendStatusBanner />
          {children}
        </div>
      )}
    </SidebarProvider>
  );
};

export default AppLayout;
