"use client";

import React from "react";
import { usePathname, useRouter } from "next/navigation";
import {
  PanelLeftClose,
  PanelLeft,
  Bot,
  Megaphone,
  Cpu,
  Wrench,
  Folder,
  Radio,
  Phone,
  Activity,
  BarChart3,
  CreditCard,
  Key,
} from "lucide-react";

interface SecondarySidebarProps {
  isCollapsed: boolean;
  onToggleCollapse: () => void;
  onNavigate?: (path: string) => void;
  activePath?: string;
}

export const SecondarySidebar: React.FC<SecondarySidebarProps> = ({
  isCollapsed,
  onToggleCollapse,
}) => {
  const pathname = usePathname();
  const router = useRouter();

  // Navigation schema mapping existing app routes
  const navigationGroups = [
    {
      heading: "BUILD",
      items: [
        { label: "Voice agents", path: "/workflow", icon: Bot },
        { label: "Campaigns", path: "/campaigns", icon: Megaphone },
        { label: "Models", path: "/model-configurations", icon: Cpu },
        { label: "Tools", path: "/tools", icon: Wrench },
        { label: "Files", path: "/files", icon: Folder },
        { label: "Recordings", path: "/recordings", icon: Radio },
      ],
    },
    {
      heading: "TELEPHONY",
      items: [
        { label: "Telephony", path: "/telephony-configurations", icon: Phone },
      ],
    },
    {
      heading: "MANAGE",
      items: [
        { label: "Agent Runs", path: "/usage", icon: Activity },
        { label: "Reports", path: "/reports", icon: BarChart3 },
        { label: "Billing", path: "/billing", icon: CreditCard },
      ],
    },
  ];

  if (pathname?.startsWith("/api-keys") || pathname?.startsWith("/developers")) {
    navigationGroups.length = 0;
    navigationGroups.push({
      heading: "API & ACCESS",
      items: [{ label: "API Keys", path: "/api-keys", icon: Key }],
    });
  }

  if (isCollapsed) {
    return (
      <div className="h-full border-r border-gray-200/80 dark:border-[#242722] bg-white dark:bg-[#161715] p-3 flex flex-col items-center select-none">
        <button
          onClick={onToggleCollapse}
          className="p-2 rounded-xl text-gray-500 dark:text-[#9ca39a] hover:bg-gray-100 dark:hover:bg-white/8 transition-colors"
        >
          <PanelLeft className="w-5 h-5" />
        </button>
      </div>
    );
  }

  return (
    <div className="w-[280px] h-full border-r border-gray-200/70 dark:border-[#242722] bg-white dark:bg-[#161715] flex flex-col flex-shrink-0 select-none transition-colors duration-200">
      {/* Header */}
      <div className="px-6 pt-6 pb-4 flex items-center justify-between border-b border-gray-100/80 dark:border-[#1e2118]">
        <h2 className="text-xl font-normal text-gray-900 dark:text-[#f2f4f0] font-serif tracking-tight">
          {pathname?.startsWith("/api-keys") || pathname?.startsWith("/developers") ? "Developer Portal" : "AI voice agents"}
        </h2>
        <button
          onClick={onToggleCollapse}
          className="p-1.5 text-gray-500 dark:text-[#9ca39a] hover:bg-gray-100 dark:hover:bg-white/8 rounded-lg transition-colors"
        >
          <PanelLeftClose className="w-5 h-5 stroke-[1.75]" />
        </button>
      </div>

      {/* Item Groups */}
      <div className="px-4 flex flex-col gap-5 overflow-y-auto py-3">
        {navigationGroups.map((group, groupIdx) => (
          <div key={groupIdx} className="flex flex-col gap-1">
            <div className="mb-1 px-3 text-[10.5px] font-bold text-gray-400 dark:text-[#5e6660] uppercase tracking-wider">
              {group.heading}
            </div>

            {group.items.map((item) => {
              const isActive = pathname.startsWith(item.path);
              const Icon = item.icon;

              return (
                <button
                  key={item.path}
                  onClick={() => router.push(item.path)}
                  className={`w-full flex items-center justify-between px-3.5 py-2 rounded-full text-sm transition-all group ${
                    isActive
                      ? "bg-gray-200/80 dark:bg-white/10 text-gray-900 dark:text-white font-semibold shadow-2xs"
                      : "text-gray-700 dark:text-[#a1a69d] hover:bg-gray-100 dark:hover:bg-white/6 hover:text-gray-900 dark:hover:text-white font-medium"
                  }`}
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <Icon className={`w-4 h-4 ${isActive ? "text-gray-900 dark:text-white" : "text-gray-500 dark:text-[#9ca39a]"}`} />
                    <span className="truncate">{item.label}</span>
                  </div>
                </button>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
};
