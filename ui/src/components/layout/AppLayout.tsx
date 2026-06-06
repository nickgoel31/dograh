"use client";

import { AlertTriangle, Menu, RefreshCw } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import React, { ReactNode } from "react";

import { Button } from "@/components/ui/button";
import { SidebarInset, SidebarProvider, useSidebar } from "@/components/ui/sidebar";
import { useAppConfig } from "@/context/AppConfigContext";

import { AppSidebar } from "./AppSidebar";
import { WalletBalance } from "./WalletBalance";

function AppHeader() {
  const { toggleSidebar } = useSidebar();

  return (
    <header className="sticky top-0 z-50 flex items-center justify-between border-b border-border/40 bg-background/70 backdrop-blur-md px-4 py-3 shadow-sm transition-all duration-300">
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="icon" onClick={toggleSidebar} aria-label="Open menu" className="md:hidden hover:bg-primary/10 hover:text-primary transition-colors">
          <Menu className="h-5 w-5" />
        </Button>
        <Link href="/" className="flex items-center gap-2 text-lg font-bold md:hidden group">
          <div className="relative overflow-hidden rounded-md group-hover:shadow-[0_0_15px_color-mix(in_oklch,var(--primary)_50%,transparent)] transition-all">
            <Image
              src="/logo.png"
              alt="Parrot AI Logo"
              width={24}
              height={24}
              className="object-cover transform group-hover:scale-110 transition-transform duration-300"
              unoptimized
            />
          </div>
          <span className="text-gradient font-extrabold tracking-tight">Parrot AI</span>
        </Link>
      </div>
      <div className="flex items-center gap-3">
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
      className="border-b border-amber-300 bg-amber-50 px-4 py-3 text-amber-950 dark:border-amber-900/60 dark:bg-amber-950/30 dark:text-amber-100"
    >
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex min-w-0 items-start gap-3">
          <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0" />
          <div className="min-w-0">
            <p className="text-sm font-semibold">Backend connection failed</p>
            <p className="break-words text-sm">{message}</p>
          </div>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => void refresh()}
          disabled={loading}
          className="h-8 shrink-0 border-amber-400 bg-transparent text-amber-950 hover:bg-amber-100 dark:border-amber-700 dark:text-amber-100 dark:hover:bg-amber-900/40"
        >
          <RefreshCw className="h-4 w-4" />
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

  // Check if current route should have sidebar
  // Hide sidebar for root (/), /handler routes (Stack Auth routes), and /auth routes
  const shouldShowSidebar = pathname !== "/" && !pathname.startsWith("/handler") && !pathname.startsWith("/auth");

  // Only match the exact editor page /workflow/<id>, not sub-routes like /workflow/<id>/runs
  const isWorkflowEditor = /^\/workflow\/\d+$/.test(pathname);

  // Always render SidebarProvider to keep the component tree shape consistent
  // across route changes (avoids React hooks ordering violations during navigation).
  return (
    <SidebarProvider defaultOpen>
      {shouldShowSidebar ? (
        <div className="flex min-h-screen w-full bg-background relative overflow-hidden transition-colors duration-300">
          {/* Space background glows */}
          <div className="absolute top-[-20%] left-[-10%] w-[500px] h-[500px] rounded-full bg-primary/15 blur-[120px] pointer-events-none opacity-60 dark:opacity-30 dark:bg-primary/20" />
          <div className="absolute bottom-[-10%] right-[-10%] w-[600px] h-[600px] rounded-full bg-indigo-500/10 blur-[140px] pointer-events-none opacity-50 dark:opacity-20" />

          <AppSidebar />
          <SidebarInset className="flex-1 flex flex-col min-w-0 bg-transparent border-l border-border/50">
            <BackendStatusBanner />
            {!isWorkflowEditor && <AppHeader />}
            {/* Optional header area for specific pages */}
            {headerActions && (
              <header className="sticky top-0 z-50 w-full border-b bg-background/80 backdrop-blur-md">
                <div className="container mx-auto px-4 py-4">
                  <div className="flex items-center justify-center">
                    {headerActions}
                  </div>
                </div>
              </header>
            )}

            {/* Optional sticky tabs */}
            {stickyTabs && (
              <div className="sticky top-0 z-40 bg-background/80 backdrop-blur-md border-b border-border/80">
                <div className="container mx-auto px-4">
                  <div className="flex items-center justify-center py-2">
                    {stickyTabs}
                  </div>
                </div>
              </div>
            )}

            {/* Main content area */}
            <main className="flex-1">
              {children}
            </main>
          </SidebarInset>
        </div>
      ) : (
        <div className="flex-1 w-full bg-background relative overflow-hidden transition-colors duration-300">
          <div className="absolute top-[-20%] left-[-10%] w-[500px] h-[500px] rounded-full bg-primary/15 blur-[120px] pointer-events-none opacity-60 dark:opacity-30 dark:bg-primary/20" />
          <div className="absolute bottom-[-10%] right-[-10%] w-[600px] h-[600px] rounded-full bg-indigo-500/10 blur-[140px] pointer-events-none opacity-50 dark:opacity-20" />
          <BackendStatusBanner />
          {children}
        </div>
      )}
    </SidebarProvider>
  );
};

export default AppLayout;
