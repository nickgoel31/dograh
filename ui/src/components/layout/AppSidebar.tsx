"use client";

import type { Team } from "@stackframe/stack";
import {
  AlertTriangle,
  ArrowUpCircle,
  AudioLines,
  Brain,
  ChevronLeft,
  ChevronRight,
  CircleDollarSign,
  Database,
  FileText,
  Home,
  IndianRupee,
  Key,
  LogOut,
  type LucideIcon,
  Megaphone,
  MessageSquare,
  Phone,
  Settings,
  Shield,
  TrendingUp,
  Users,
  Workflow,
  Wrench,
} from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import React, { useRef } from "react";
import { toast } from "sonner";

import ThemeToggle from "@/components/ThemeSwitcher";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
  SidebarTrigger,
  useSidebar,
} from "@/components/ui/sidebar";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useAppConfig } from "@/context/AppConfigContext";
import { useTelephonyConfigWarnings } from "@/context/TelephonyConfigWarningsContext";
import { useUserConfig } from "@/context/UserConfigContext";
import { useCurrentUserRole } from "@/hooks/useCurrentUserRole";
import { useLatestReleaseVersion } from "@/hooks/useLatestReleaseVersion";
import type { LocalUser } from "@/lib/auth";
import { useAuth } from "@/lib/auth";
import { cn } from "@/lib/utils";


type SidebarNavItem = {
  title: string;
  url: string;
  icon: LucideIcon;
  showsTelephonyWarning?: boolean;
};

type SidebarNavSection = {
  label?: string;
  items: SidebarNavItem[];
};

const NAV_SECTIONS: SidebarNavSection[] = [
  {
    items: [
      {
        title: "Overview",
        url: "/overview",
        icon: Home,
      },
    ],
  },
  {
    label: "BUILD",
    items: [
      {
        title: "Voice Agents",
        url: "/workflow",
        icon: Workflow,
      },
      {
        title: "Campaigns",
        url: "/campaigns",
        icon: Megaphone,
      },
      {
        title: "Models",
        url: "/model-configurations",
        icon: Brain,
      },
      {
        title: "Telephony",
        url: "/telephony-configurations",
        icon: Phone,
        showsTelephonyWarning: true,
      },
      {
        title: "Tools",
        url: "/tools",
        icon: Wrench,
      },
      {
        title: "Files",
        url: "/files",
        icon: Database,
      },
      {
        title: "Recordings",
        url: "/recordings",
        icon: AudioLines,
      },
      {
        title: "Developers",
        url: "/api-keys",
        icon: Key,
      },
    ],
  },
  {
    label: "OBSERVE",
    items: [
      {
        title: "Agent Runs",
        url: "/usage",
        icon: TrendingUp,
      },
      {
        title: "Billing",
        url: "/billing",
        icon: IndianRupee,
      },
      {
        title: "Reports",
        url: "/reports",
        icon: FileText,
      },
    ],
  },
];

const StackTeamSwitcher = React.lazy(() =>
  import("@stackframe/stack").then((mod) => ({
    default: mod.SelectedTeamSwitcher,
  }))
);

export function AppSidebar() {
  const pathname = usePathname();
  const router = useRouter();
  const { state, isMobile, setOpenMobile } = useSidebar();
  const { provider, getSelectedTeam, logout, user } = useAuth();
  const { config } = useAppConfig();
  const { role, isSuperadmin, loading: roleLoading } = useCurrentUserRole();
  const { userConfig } = useUserConfig();
  const { telnyxMissingWebhookPublicKeyCount } = useTelephonyConfigWarnings();
  const hasTelephonyWarning = telnyxMissingWebhookPublicKeyCount > 0;
  const isCollapsed = !isMobile && state === "collapsed";

  const [isImpersonating, setIsImpersonating] = React.useState(false);

  React.useEffect(() => {
    if (typeof window !== 'undefined') {
      const hasLocalToken = !!sessionStorage.getItem('impersonation_token');
      const hasStackCookie = document.cookie.includes('__stack_impersonation');
      setIsImpersonating(hasLocalToken || hasStackCookie);
    }
  }, []);

  const handleStopImpersonation = () => {
    if (typeof window !== 'undefined') {
      sessionStorage.removeItem('impersonation_token');
      document.cookie = '__stack_impersonation=; expires=Thu, 01 Jan 1970 00:00:00 UTC; path=/;';
      window.location.href = '/superadmin/users';
    }
  };

  const selectedTeamRef = useRef<Team | null>(null);
  const rawSelectedTeam = provider === "stack" && getSelectedTeam ? getSelectedTeam() as Team | null : null;
  if (rawSelectedTeam?.id !== selectedTeamRef.current?.id) {
    selectedTeamRef.current = rawSelectedTeam;
  }
  const selectedTeam = selectedTeamRef.current;

  const versionInfo = config ? { ui: config.uiVersion, api: config.apiVersion } : null;

  const { latest: latestRelease, isBehind, isLatest } = useLatestReleaseVersion(
    versionInfo?.ui,
    { enabled: config?.deploymentMode === "oss" },
  );

  React.useEffect(() => {
    if (!roleLoading) {
      if (role === "client") {
        const restrictedPaths = ["/telephony-configurations", "/model-configurations", "/settings", "/tools", "/api-keys", "/reports", "/superadmin"];
        if (restrictedPaths.some(p => pathname.startsWith(p))) {
          toast.error("You don't have permission to access this page.");
          router.push("/overview");
        }
      } else if (role !== "super_admin" && !isSuperadmin) {
        if (pathname.startsWith("/superadmin")) {
          toast.error("Access denied. Superadmin only.");
          router.push("/overview");
        }
      }
    }
  }, [pathname, role, isSuperadmin, roleLoading, router]);

  const isActive = (path: string) => pathname.startsWith(path);

  const handleMobileNavClick = () => {
    if (isMobile) {
      setOpenMobile(false);
    }
  };

  // Build user initials
  const getInitials = (nameOrEmail: string) =>
    nameOrEmail
      .split(/[\s@]/)
      .filter(Boolean)
      .slice(0, 2)
      .map((s: string) => s[0]?.toUpperCase())
      .join("") || "U";

  const SidebarLink = ({ item }: { item: SidebarNavItem }) => {
    const isItemActive = isActive(item.url);
    const Icon = item.icon;
    const showWarningDot = item.showsTelephonyWarning && hasTelephonyWarning;

    return (
      <SidebarMenuButton
        asChild
        tooltip={{ children: <span className="notranslate">{item.title}</span> }}
        className={cn(
          "relative transition-all duration-200 font-medium group",
          isCollapsed
            ? "h-11 w-11 mx-auto rounded flex items-center justify-center"
            : "h-10 w-full rounded flex items-center text-sm",
          isItemActive
            ? "text-primary bg-primary/10 border-r-2 border-primary active-nav-indicator"
            : "text-slate-400 border border-transparent hover:text-white hover:bg-white/5 active:translate-x-1"
        )}
      >
        <Link
          href={item.url}
          onClick={handleMobileNavClick}
          className={cn("flex items-center gap-3 w-full", isCollapsed ? "justify-center p-0" : "px-3")}
          translate="no"
        >
          <Icon className={cn(
            "h-[20px] w-[20px] shrink-0 stroke-[1.75] transition-transform duration-200",
            isItemActive ? "text-[#a855f7] scale-105" : "text-slate-400 group-hover:text-white"
          )} />
          <span className={cn("notranslate truncate text-xs", isCollapsed && "sr-only")} translate="no">
            {item.title}
          </span>
          {showWarningDot && (
            <AlertTriangle
              aria-label="Action required"
              className={cn(
                "h-3 w-3 text-amber-500",
                isCollapsed ? "absolute -right-0.5 -top-0.5" : "ml-auto shrink-0"
              )}
            />
          )}
        </Link>
      </SidebarMenuButton>
    );
  };

  return (
    <Sidebar collapsible="icon" className="neural-sidebar">
      {/* ── Header ── */}
      <SidebarHeader className={cn("px-3 py-3 notranslate", isCollapsed && "px-2")} translate="no">
        {/* Impersonation banner */}
        {isImpersonating && (
          <div className={cn("mb-2 rounded-md bg-amber-500/15 border border-amber-500/30 px-2.5 py-2 text-xs font-medium text-amber-600 dark:text-amber-400 flex flex-col gap-1.5", isCollapsed && "hidden")}>
            <div className="flex items-center gap-1.5">
              <Shield className="h-3.5 w-3.5 shrink-0" />
              <span>Impersonating workspace</span>
            </div>
            <Button size="sm" variant="secondary" className="w-full h-6 text-[10px]" onClick={handleStopImpersonation}>
              Exit Impersonation
            </Button>
          </div>
        )}

        <div className={cn("flex items-center justify-between", isCollapsed ? "flex-col gap-3" : "w-full")}>
          {/* Logo */}
          <div className={cn("flex items-center gap-2.5 min-w-0", isCollapsed && "hidden")}>
            <Link
              href="/"
              className="notranslate flex items-center gap-3 hover:opacity-90 transition-opacity cursor-pointer"
              translate="no"
            >
              <div className="w-8 h-8 rounded bg-primary flex items-center justify-center">
                <img
                  src="/logo.webp"
                  alt="Swarvo AI"
                  className="w-5 h-5 rounded-sm object-cover dark:invert"
                />
              </div>
              <div className="flex flex-col">
                <span className="font-serif-heading text-[24px] text-primary leading-none">
                  Swarvo AI
                </span>
                <span className="text-[10px] uppercase tracking-widest text-slate-400 font-bold mt-1">
                  Enterprise Platform
                </span>
              </div>
            </Link>
          </div>

          {/* Collapsed: just the logo icon */}
          <div className={cn("mx-auto cursor-pointer hover:opacity-90 transition-opacity", !isCollapsed && "hidden")}>
            <Link href="/">
              <div className="w-8 h-8 rounded bg-primary flex items-center justify-center">
                <img
                  src="/logo.webp"
                  alt="Swarvo AI"
                  className="w-5 h-5 rounded-sm object-cover dark:invert"
                />
              </div>
            </Link>
          </div>

          <SidebarTrigger className={cn("h-8 w-8 rounded-xl hover:bg-white/5 border border-transparent text-[#626266] hover:text-white transition-colors flex items-center justify-center", isCollapsed && "mx-auto mt-1")}>
            {isCollapsed ? (
              <ChevronRight className="h-4 w-4" />
            ) : (
              <ChevronLeft className="h-4 w-4" />
            )}
          </SidebarTrigger>
        </div>

        {/* Stack team switcher */}
        {provider === "stack" && isSuperadmin && (
          <div className={cn("mt-2 notranslate", isCollapsed && "hidden")} translate="no">
            <React.Suspense fallback={<div className="h-8 rounded bg-muted animate-pulse" />}>
              <StackTeamSwitcher
                selectedTeam={selectedTeam || undefined}
                onChange={() => { router.refresh(); }}
              />
            </React.Suspense>
          </div>
        )}
      </SidebarHeader>

      {/* ── Nav content ── */}
      <SidebarContent className={cn("notranslate px-2 py-1", isCollapsed && "px-1")} translate="no">
        {!roleLoading && (() => {
          let sections = [...NAV_SECTIONS];

          if (userConfig?.whatsapp_enabled) {
            sections = sections.map(sec => {
              if (sec.label === "OBSERVE") {
                return {
                  ...sec,
                  items: [...sec.items, { title: "WhatsApp Logs", url: "/whatsapp", icon: MessageSquare }],
                };
              }
              return sec;
            });
          }

          if (role === "super_admin" || isSuperadmin) {
            sections = [
              ...sections,
              {
                label: "ADMIN",
                items: [
                  { title: "Platform Orgs", url: "/superadmin", icon: Shield },
                  { title: "Users Directory", url: "/superadmin/users", icon: Users },
                ],
              },
            ];
          }

          return sections.map((section, index) => {
            const filteredItems = section.items.filter(item => {
              if (role === "client") {
                return ["Voice Agents", "Recordings", "Campaigns", "Billing", "Agent Runs"].includes(item.title);
              }
              return true;
            });

            if (filteredItems.length === 0) return null;

            return (
              <SidebarGroup key={section.label ?? "overview"} className={index === 0 ? "mt-1" : "mt-3"}>
                {section.label && !isCollapsed && (
                  <div className="mt-3 mb-1 px-3">
                    <span className="text-[10px] font-bold uppercase tracking-widest text-slate-500 notranslate" translate="no">
                      {section.label}
                    </span>
                  </div>
                )}
                {section.label && isCollapsed && (
                  <div className="my-1.5 mx-auto w-4 h-px bg-[#141a29]" />
                )}
                <SidebarMenu className="gap-0.5">
                  {filteredItems.map((item) => (
                    <SidebarMenuItem key={item.title}>
                      <SidebarLink item={item} />
                    </SidebarMenuItem>
                  ))}
                </SidebarMenu>
              </SidebarGroup>
            );
          });
        })()}
      </SidebarContent>

      {/* ── Footer ── */}
      <SidebarFooter
        className={cn("border-t border-[#1b253b] p-2 notranslate")}
        translate="no"
      >
        {!isCollapsed && (
          <div className="mb-2 px-0.5">
            <Button
              className="w-full h-9 rounded-xl bg-[#201936] hover:bg-[#2a2147] text-[#c4b5fd] border border-[#3b2d5d] font-semibold text-xs flex items-center justify-center gap-2 shadow-[0_0_12px_rgba(139,92,246,0.15)] transition-all cursor-pointer"
              onClick={() => router.push('/billing')}
            >
              <ArrowUpCircle className="h-4 w-4 text-[#a78bfa]" />
              Upgrade Plan
            </Button>
          </div>
        )}

        {/* Non-Stack provider footer */}
        {provider !== "stack" && (
          <div className={cn("flex items-center", isCollapsed ? "justify-center flex-col gap-2" : "justify-between gap-2")}>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7 rounded-full bg-primary/10 border border-primary/20 text-primary hover:bg-primary/20 transition-all text-xs font-semibold shrink-0"
                >
                  {getInitials(
                    (user?.displayName || (user as LocalUser | undefined)?.email || "")
                  )}
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent side="top" align="start" className="w-52">
                <DropdownMenuLabel className="font-normal">
                  {(user as LocalUser | undefined)?.email && (
                    <p className="text-xs text-muted-foreground truncate">{(user as LocalUser).email}</p>
                  )}
                </DropdownMenuLabel>
                <DropdownMenuSeparator />
                {isImpersonating && (
                  <DropdownMenuItem onClick={handleStopImpersonation} className="cursor-pointer text-amber-600 focus:text-amber-600">
                    <LogOut className="mr-2 h-4 w-4" />
                    Stop Impersonating
                  </DropdownMenuItem>
                )}
                <DropdownMenuItem onClick={() => router.push("/settings")} className="cursor-pointer">
                  <Settings className="mr-2 h-4 w-4" />
                  Platform Settings
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => logout()} className="cursor-pointer">
                  <LogOut className="mr-2 h-4 w-4" />
                  Sign out
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>

            {!isCollapsed && (
              <div className="notranslate" translate="no">
                <ThemeToggle showLabel={false} className="h-7 w-7 hover:bg-accent" />
              </div>
            )}
          </div>
        )}

        {/* Stack provider footer */}
        {provider === "stack" && (
          <div className={cn("flex items-center", isCollapsed ? "justify-center flex-col gap-2" : "justify-between gap-2")}>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7 rounded-full bg-primary/10 border border-primary/20 text-primary hover:bg-primary/20 transition-all text-xs font-semibold shrink-0"
                >
                  {getInitials(
                    (user?.displayName || (user as { primaryEmail?: string })?.primaryEmail || "")
                  )}
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent side="top" align="start" className="w-52">
                <DropdownMenuLabel className="font-normal">
                  <div className="flex flex-col gap-0.5">
                    {user?.displayName && (
                      <p className="text-sm font-medium">{user.displayName}</p>
                    )}
                    {(user as { primaryEmail?: string })?.primaryEmail && (
                      <p className="text-xs text-muted-foreground truncate">{(user as { primaryEmail?: string }).primaryEmail}</p>
                    )}
                  </div>
                </DropdownMenuLabel>
                <DropdownMenuSeparator />
                {isImpersonating && (
                  <DropdownMenuItem onClick={handleStopImpersonation} className="cursor-pointer text-amber-600 focus:text-amber-600">
                    <LogOut className="mr-2 h-4 w-4" />
                    Stop Impersonating
                  </DropdownMenuItem>
                )}
                <DropdownMenuItem onClick={() => router.push("/handler/account-settings")} className="cursor-pointer">
                  <Settings className="mr-2 h-4 w-4" />
                  Account settings
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => router.push("/settings")} className="cursor-pointer">
                  <Settings className="mr-2 h-4 w-4" />
                  Platform Settings
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => router.push("/usage")} className="cursor-pointer">
                  <CircleDollarSign className="mr-2 h-4 w-4" />
                  Usage
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => logout()} className="cursor-pointer">
                  <LogOut className="mr-2 h-4 w-4" />
                  Sign out
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>

            {!isCollapsed && (
              <div className="notranslate" translate="no">
                <ThemeToggle showLabel={false} className="h-7 w-7 hover:bg-accent" />
              </div>
            )}
          </div>
        )}

        {/* Collapsed theme toggle */}
        {isCollapsed && (
          <div className="mt-1 flex justify-center notranslate" translate="no">
            <Tooltip>
              <TooltipTrigger asChild>
                <div>
                  <ThemeToggle showLabel={false} className="h-7 w-7 hover:bg-accent" />
                </div>
              </TooltipTrigger>
              <TooltipContent side="right">Toggle theme</TooltipContent>
            </Tooltip>
          </div>
        )}
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  );
}
