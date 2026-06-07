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
  SidebarGroupLabel,
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
import { useCurrentUserRole } from "@/hooks/useCurrentUserRole";
import { useLatestReleaseVersion } from "@/hooks/useLatestReleaseVersion";
import type { LocalUser } from "@/lib/auth";
import { useAuth } from "@/lib/auth";
import { useUserConfig } from "@/context/UserConfigContext";
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

const TELEPHONY_WARNING_COPY = "Action required";

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

// Lazy load SelectedTeamSwitcher - we'll pass selectedTeam from our context
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

  // Get selected team for Stack auth (cast to Team type from Stack)
  // Stabilize the reference so SelectedTeamSwitcher only sees a change when the team ID changes,
  // preventing unnecessary PATCH calls to Stack Auth on every route navigation.
  const selectedTeamRef = useRef<Team | null>(null);
  const rawSelectedTeam = provider === "stack" && getSelectedTeam ? getSelectedTeam() as Team | null : null;
  if (rawSelectedTeam?.id !== selectedTeamRef.current?.id) {
    selectedTeamRef.current = rawSelectedTeam;
  }
  const selectedTeam = selectedTeamRef.current;

  // Version info from app config context
  const versionInfo = config ? { ui: config.uiVersion, api: config.apiVersion } : null;

  // Check for updates only on self-hosted (OSS) deployments — cloud is managed for the user.
  const { latest: latestRelease, isBehind, isLatest } = useLatestReleaseVersion(
    versionInfo?.ui,
    { enabled: config?.deploymentMode === "oss" },
  );

  React.useEffect(() => {
    if (!roleLoading) {
      if (role === "client") {
        const restrictedPaths = ["/telephony-configurations", "/model-configurations", "/settings", "/tools", "/api-keys", "/reports", "/usage", "/superadmin"];
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

  const SidebarLink = ({ item }: { item: SidebarNavItem }) => {
    const isItemActive = isActive(item.url);
    const Icon = item.icon;
    const showWarningDot = item.showsTelephonyWarning && hasTelephonyWarning;
    const tooltip = {
      children: (
        <div className="notranslate" translate="no">
          <p>{item.title}</p>
          {showWarningDot && (
            <p className="text-amber-600 dark:text-amber-400">{TELEPHONY_WARNING_COPY}</p>
          )}
        </div>
      ),
    };
    const warningIndicator = (
      <AlertTriangle
        aria-label="Action required on a telephony configuration"
        className={cn(
          "text-amber-500",
          isCollapsed ? "absolute -right-0.5 -top-0.5 h-3 w-3" : "ml-auto h-3.5 w-3.5"
        )}
      />
    );

    return (
      <SidebarMenuButton
        asChild
        tooltip={tooltip}
        className={cn(
          "rounded-lg transition-all duration-200 hover:bg-primary/8 hover:text-primary hover:translate-x-0.5",
          isItemActive && "bg-gradient-to-r from-primary/18 via-primary/10 to-transparent text-primary font-semibold shadow-[inset_0_0_0_1px_color-mix(in_oklch,var(--primary)_20%,transparent)] border-l-2 border-primary rounded-l-none"
        )}
      >
        <Link
          href={item.url}
          onClick={handleMobileNavClick}
          className={cn("relative", isCollapsed && "justify-center")}
          translate="no"
        >
          <Icon className={cn("h-4 w-4 shrink-0 transition-transform duration-300", isItemActive && "text-primary scale-110")} />
          <span
            className={cn("notranslate min-w-0 flex-1 truncate", isCollapsed && "sr-only")}
            translate="no"
          >
            {item.title}
          </span>
          {showWarningDot && (
            isCollapsed ? (
              warningIndicator
            ) : (
              <Tooltip>
                <TooltipTrigger asChild>
                  {warningIndicator}
                </TooltipTrigger>
                <TooltipContent side="right">
                  <p>{TELEPHONY_WARNING_COPY}</p>
                </TooltipContent>
              </Tooltip>
            )
          )}
        </Link>
      </SidebarMenuButton>
    );
  };

  return (
    <Sidebar collapsible="icon" className="sidebar-glass border-r-0">
      <SidebarHeader className="relative border-b border-border/40 px-2 py-3 notranslate" translate="no">
        {/* Premium gradient top accent strip */}
        <div className="pointer-events-none absolute top-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-primary/50 to-transparent" />
        {isImpersonating && (
          <div className={cn("mb-3 mt-1 rounded-md bg-amber-500 px-3 py-2 text-xs font-medium text-white shadow-sm flex flex-col gap-2", isCollapsed && "hidden")}>
            <div className="flex items-center gap-1.5">
              <Shield className="h-4 w-4 shrink-0" />
              <span>Impersonating Workspace</span>
            </div>
            <Button size="sm" variant="secondary" className="w-full text-[10px] h-6 text-black" onClick={handleStopImpersonation}>
              Exit Impersonation
            </Button>
          </div>
        )}
        <div className="flex items-center justify-between">
          <div className={cn("flex items-center gap-2", isCollapsed && "hidden")}>
              <Link
              href="/"
              className="notranslate flex items-center gap-2.5 px-2 text-xl font-bold hover:opacity-90 transition-opacity"
              translate="no"
            >
              <div className="logo-glow">
                <Image
                  src="/logo.png"
                  alt="Parrot AI Logo"
                  width={32}
                  height={32}
                  className="rounded-lg object-cover ring-1 ring-primary/30 shadow-sm"
                  unoptimized
                />
              </div>
              <span className="text-gradient tracking-tight font-extrabold">Parrot AI</span>
              {versionInfo && (
                <span
                  className="notranslate text-xs font-normal text-muted-foreground self-end mb-0.5"
                  translate="no"
                >
                  v{versionInfo.ui}
                </span>
              )}
            </Link>
            {isBehind && latestRelease && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <a
                    href="https://docs.dograh.com/deployment/update"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 rounded-md border bg-amber-50 px-1.5 py-0.5 text-[10px] font-medium leading-none text-amber-900 transition-opacity hover:opacity-80 dark:bg-amber-950 dark:text-amber-200"
                  >
                    <ArrowUpCircle className="h-3 w-3" />
                    Update
                  </a>
                </TooltipTrigger>
                <TooltipContent side="bottom">
                  <p>Latest: {latestRelease} — click to see the update guide</p>
                </TooltipContent>
              </Tooltip>
            )}
            {isLatest && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <span className="inline-flex items-center rounded-md border bg-emerald-50 px-1.5 py-0.5 text-[10px] font-medium leading-none text-emerald-900 dark:bg-emerald-950 dark:text-emerald-200">
                    Latest
                  </span>
                </TooltipTrigger>
                <TooltipContent side="bottom">
                  <p>You&apos;re running the latest release</p>
                </TooltipContent>
              </Tooltip>
            )}
          </div>

          <SidebarTrigger className={cn("hover:bg-accent", isCollapsed && "mx-auto")}>
            {isCollapsed ? (
              <ChevronRight className="h-4 w-4" />
            ) : (
              <ChevronLeft className="h-4 w-4" />
            )}
          </SidebarTrigger>
        </div>

        {provider === "stack" && isSuperadmin && (
          <div className={cn("mt-3 notranslate", isCollapsed && "hidden")} translate="no">
            <React.Suspense
              fallback={
                <div className="h-9 w-full animate-pulse rounded bg-muted" />
              }
            >
              <StackTeamSwitcher
                selectedTeam={selectedTeam || undefined}
                onChange={() => {
                  router.refresh();
                }}
              />
            </React.Suspense>
          </div>
        )}
      </SidebarHeader>

      <SidebarContent className={cn("notranslate", isCollapsed && "px-0")} translate="no">
        {!roleLoading && (() => {
          let sections = [...NAV_SECTIONS];
          
          if (userConfig?.whatsapp_enabled) {
            sections = sections.map(sec => {
              if (sec.label === "OBSERVE") {
                return {
                  ...sec,
                  items: [
                    ...sec.items,
                    {
                      title: "WhatsApp Logs",
                      url: "/whatsapp",
                      icon: MessageSquare,
                    }
                  ]
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
                  {
                    title: "Platform Orgs",
                    url: "/superadmin",
                    icon: Shield,
                  },
                  {
                    title: "Users Directory",
                    url: "/superadmin/users",
                    icon: Users,
                  },
                ],
              },
            ];
          }
          return sections.map((section, index) => {
            const filteredItems = section.items.filter(item => {
              if (role === "client") {
                return ["Voice Agents", "Recordings", "Campaigns", "Billing"].includes(item.title);
              }
              return true;
            });

            if (filteredItems.length === 0) return null;

            return (
              <SidebarGroup
                key={section.label ?? "overview"}
                className={index === 0 ? "mt-2" : "mt-6"}
              >
                {section.label && (
                  <SidebarGroupLabel
                    className={cn(
                      "notranslate text-xs font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-2 before:content-[''] before:block before:w-1 before:h-1 before:rounded-full before:bg-primary/50",
                      isCollapsed && "hidden"
                    )}
                    translate="no"
                  >
                    {section.label}
                  </SidebarGroupLabel>
                )}
                <SidebarMenu>
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

      <SidebarFooter
        className={cn("border-t border-border/40 p-4 notranslate", isCollapsed && "p-2")}
        translate="no"
      >
        <div className="space-y-2">
          {provider !== "stack" && (
            <div className={cn("flex", isCollapsed ? "justify-center" : "justify-start")}>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="icon" className="h-8 w-8 cursor-pointer rounded-full ring-2 ring-primary/20 ring-offset-1 ring-offset-background hover:ring-primary/40 transition-all">
                    <span className="text-xs font-medium">
                      {(user?.displayName || (user as LocalUser | undefined)?.email || "")
                        .split(/[\s@]/)
                        .filter(Boolean)
                        .slice(0, 2)
                        .map((s: string) => s[0]?.toUpperCase())
                        .join("")
                        || "U"}
                    </span>
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent side="top" align="start" className="w-56">
                  <DropdownMenuLabel className="font-normal">
                    <div className="flex flex-col space-y-1">
                      {(user as LocalUser | undefined)?.email && (
                        <p className="text-xs text-muted-foreground">{(user as LocalUser).email}</p>
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
            </div>
          )}

          {provider === "stack" && (
            <div className={cn("flex", isCollapsed ? "justify-center" : "justify-start")}>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="icon" className="h-8 w-8 cursor-pointer rounded-full ring-2 ring-primary/20 ring-offset-1 ring-offset-background hover:ring-primary/40 transition-all">
                    <span className="text-xs font-medium">
                      {(user?.displayName || (user as { primaryEmail?: string })?.primaryEmail || "")
                        .split(/[\s@]/)
                        .filter(Boolean)
                        .slice(0, 2)
                        .map((s: string) => s[0]?.toUpperCase())
                        .join("")
                        || "U"}
                    </span>
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent side="top" align="start" className="w-56">
                  <DropdownMenuLabel className="font-normal">
                    <div className="flex flex-col space-y-1">
                      {user?.displayName && (
                        <p className="text-sm font-medium">{user.displayName}</p>
                      )}
                      {(user as { primaryEmail?: string })?.primaryEmail && (
                        <p className="text-xs text-muted-foreground">{(user as { primaryEmail?: string }).primaryEmail}</p>
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
            </div>
          )}

          <div className={cn("mt-2 border-t pt-2", isCollapsed && "flex justify-center")}>
            {isCollapsed ? (
              <Tooltip>
                <TooltipTrigger asChild>
                  <div className="notranslate" translate="no">
                    <ThemeToggle
                      showLabel={false}
                      className="hover:bg-accent hover:text-accent-foreground"
                    />
                  </div>
                </TooltipTrigger>
                <TooltipContent side="right">
                  <p>Toggle theme</p>
                </TooltipContent>
              </Tooltip>
            ) : (
              <div className="notranslate" translate="no">
                <ThemeToggle
                  showLabel={true}
                  className="hover:bg-accent hover:text-accent-foreground"
                />
              </div>
            )}
          </div>
        </div>
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  );
}
