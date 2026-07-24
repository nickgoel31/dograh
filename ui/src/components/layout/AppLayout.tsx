"use client";

import { AlertTriangle, Bell, HelpCircle, Menu, Plus, RefreshCw, Search, Upload } from "lucide-react";
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
    <header className="sticky top-0 z-50 flex h-16 items-center justify-between px-6 border-b border-white/5 bg-surface/80 backdrop-blur-xl shadow-sm transition-all duration-300">
      {/* Left: Mobile toggle & Search Input */}
      <div className="flex items-center gap-4 flex-1 max-w-md">
        <Button
          variant="ghost"
          size="icon"
          onClick={toggleSidebar}
          aria-label="Open menu"
          className="md:hidden h-8 w-8 rounded-xl hover:bg-white/5 border border-transparent text-slate-400 hover:text-white"
        >
          <Menu className="h-4 w-4" />
        </Button>

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

        {/* Reference Image Search Input */}
        <div className="relative w-full hidden md:block group">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-on-surface-variant group-focus-within:text-primary transition-colors" />
          <input
            type="text"
            placeholder="Search agents, campaigns, or logs..."
            className="w-full h-10 pl-10 pr-4 rounded-full bg-surface-container-lowest border border-white/10 text-sm text-on-surface placeholder:text-on-surface-variant focus:outline-none focus:border-primary/50 focus:ring-1 focus:ring-primary/50 transition-all"
          />
        </div>
      </div>

      {/* Right: Actions, Notifications, Avatar */}
      <div className="flex items-center gap-4">
        <Button
          variant="ghost"
          size="icon"
          className="h-9 w-9 rounded-full text-on-surface-variant hover:text-primary hover:bg-white/5 border border-transparent transition-colors active:scale-95"
        >
          <Bell className="h-4 w-4" />
        </Button>

        <Button
          variant="ghost"
          size="icon"
          className="h-9 w-9 rounded-full text-on-surface-variant hover:text-primary hover:bg-white/5 border border-transparent transition-colors active:scale-95"
        >
          <HelpCircle className="h-4 w-4" />
        </Button>

        <Link href="/workflow">
          <Button
            size="sm"
            className="hidden sm:inline-flex items-center gap-1.5 h-9 px-3.5 rounded-xl bg-[#0d121f] border border-[#1c273e] text-xs font-semibold text-slate-200 hover:bg-[#151c2e] hover:text-white transition-all cursor-pointer"
          >
            <Upload className="h-3.5 w-3.5 text-slate-400" />
            Upload Agent Definition
          </Button>
        </Link>

        <div className="h-6 w-px bg-white/10 hidden md:block" />

        <Link href="/workflow">
          <Button
            size="sm"
            className="hidden sm:inline-flex items-center gap-2 h-10 px-6 rounded-full bg-primary hover:opacity-90 text-sm font-bold text-on-primary transition-all cursor-pointer active:scale-95"
          >
            <Plus className="h-[18px] w-[18px]" />
            Create Agent
          </Button>
        </Link>
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
