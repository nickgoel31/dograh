"use client";

import React, { useState, useRef, useEffect } from "react";
import { usePathname, useRouter } from "next/navigation";
import {
  ChevronDown,
  ChevronUp,
  Wallet,
  Sun,
  Moon,
  Settings,
  LogOut,
} from "lucide-react";
import { useTheme } from "@/context/ThemeContext";
import { useAuth } from "@/lib/auth";
import {
  OrgGearIcon,
  AiVoiceAgentsIcon,
  AiChatbotsIcon,
  DevelopersIcon,
  UserAvatar,
} from "./CustomIcons";
import { WalletBalance } from "./WalletBalance";

interface PrimarySidebarProps {
  isHovered: boolean;
  setIsHovered: (hovered: boolean) => void;
}

export const PrimarySidebar: React.FC<PrimarySidebarProps> = ({
  isHovered,
  setIsHovered,
}) => {
  const pathname = usePathname();
  const router = useRouter();
  const { toggleTheme, isDark } = useTheme();
  const { logout, user } = useAuth();
  
  const [showProfileMenu, setShowProfileMenu] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setShowProfileMenu(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const categories = [
    { id: "ai-voice-agents", name: "AI voice agents", icon: AiVoiceAgentsIcon, path: "/workflow" },
    { id: "ai-chatbots", name: "AI Chatbots", icon: AiChatbotsIcon, path: "/overview" },
    { id: "developers", name: "Developers", icon: DevelopersIcon, path: "/api-keys" },
  ];

  const activeCategory = categories.find((c) => pathname?.startsWith(c.path)) || categories[0];

  return (
    <div
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      className="relative h-full w-[68px] flex-shrink-0 z-40 select-none"
    >
      <div
        className={`absolute top-0 left-0 bottom-0 border-r border-gray-200/80 dark:border-[#242722] bg-white dark:bg-[#161715] flex flex-col justify-between transition-all duration-300 ease-in-out z-50 ${
          isHovered
            ? "w-[270px] shadow-2xl shadow-gray-900/15 dark:shadow-black/40 px-3.5 py-4"
            : "w-[68px] px-3 py-4 items-center"
        }`}
      >
        {/* Top Org Section */}
        <div className="flex flex-col gap-6 w-full">
          {!isHovered ? (
            <div className="flex justify-center w-full">
              <button
                className="w-10 h-10 rounded-xl border border-gray-200/90 dark:border-[#2e312b] shadow-2xs flex items-center justify-center bg-white dark:bg-[#1a1c18] hover:bg-gray-50 dark:hover:bg-[#232621] transition-colors"
                title="Workspace"
              >
                <OrgGearIcon className="w-5 h-5 text-gray-700 dark:text-[#c8ccc5]" />
              </button>
            </div>
          ) : (
            <div className="flex items-center justify-between px-1.5 py-1 rounded-xl hover:bg-gray-50 dark:hover:bg-white/5 transition-colors cursor-pointer group">
              <div className="flex items-center gap-3 min-w-0">
                <div className="w-9 h-9 rounded-xl border border-gray-200/90 dark:border-[#2e312b] shadow-2xs flex items-center justify-center bg-white dark:bg-[#1a1c18] flex-shrink-0">
                  <OrgGearIcon className="w-5 h-5 text-gray-700 dark:text-[#c8ccc5]" />
                </div>
                <div className="flex flex-col min-w-0">
                  <span className="text-sm font-semibold text-gray-900 dark:text-[#f2f4f0] truncate leading-tight">
                    Harsh's Organisation
                  </span>
                  <span className="text-xs text-gray-400 dark:text-[#9ca39a] truncate">
                    Harsh's Workspace
                  </span>
                </div>
              </div>
              <ChevronDown className="w-4 h-4 text-gray-400 dark:text-[#9ca39a]" />
            </div>
          )}

          {/* Navigation Categories */}
          <nav className="flex flex-col gap-1.5 w-full">
            {categories.map((category) => {
              const isActive = activeCategory.id === category.id;
              const Icon = category.icon;

              return (
                <button
                  key={category.id}
                  onClick={() => {
                    if (category.id !== "ai-chatbots") {
                      router.push(category.path);
                    }
                  }}
                  className={`flex items-center transition-all duration-200 text-left ${
                    isHovered
                      ? `w-full px-3 py-2.5 rounded-xl gap-3 text-sm font-medium ${
                          isActive
                            ? "bg-gray-200/80 dark:bg-white/10 text-gray-900 dark:text-white font-semibold shadow-2xs"
                            : "text-gray-700 dark:text-[#a1a69d] hover:bg-gray-100 dark:hover:bg-white/6 hover:text-gray-900 dark:hover:text-white"
                        }`
                      : `w-11 h-11 rounded-xl justify-center ${
                          isActive
                            ? "bg-gray-200/80 dark:bg-white/10 text-gray-900 dark:text-white shadow-2xs"
                            : "text-gray-700 dark:text-[#a1a69d] hover:bg-gray-100 dark:hover:bg-white/6 hover:text-gray-900 dark:hover:text-white"
                        }`
                  }`}
                >
                  <div className="flex items-center justify-center flex-shrink-0">
                    <Icon className={`w-5 h-5 ${isActive ? "text-gray-900 dark:text-white" : "text-gray-500 dark:text-[#9ca39a]"}`} />
                  </div>

                  {isHovered && <span className="truncate font-medium">{category.name}</span>}
                </button>
              );
            })}
          </nav>
        </div>

        {/* Bottom Section */}
        <div className="flex flex-col gap-3 w-full">
          {!isHovered ? (
            <div className="flex flex-col items-center gap-4 w-full">
              <button
                onClick={toggleTheme}
                className="w-10 h-10 rounded-xl flex items-center justify-center text-gray-600 dark:text-[#9ca39a] hover:bg-gray-100 dark:hover:bg-white/8 transition-colors"
              >
                {isDark ? <Sun className="w-5 h-5 text-amber-300" /> : <Moon className="w-5 h-5 text-gray-600" />}
              </button>

              <button onClick={() => router.push("/billing")} className="w-10 h-10 rounded-xl flex items-center justify-center text-gray-600 dark:text-[#9ca39a]">
                <Wallet className="w-5 h-5 text-gray-600 dark:text-[#9ca39a]" />
              </button>

              <div className="relative" ref={menuRef}>
                <button
                  onClick={() => setShowProfileMenu(!showProfileMenu)}
                  className="w-8 h-8 flex items-center justify-center rounded-full hover:ring-2 hover:ring-amber-400 transition-all cursor-pointer"
                >
                  <UserAvatar size="w-7 h-7" />
                </button>

                {showProfileMenu && (
                  <div className="absolute left-12 bottom-0 w-52 bg-white dark:bg-[#1c1e1a] border border-gray-200 dark:border-[#282b26] rounded-2xl shadow-xl p-1.5 z-50 space-y-0.5">
                    <button
                      onClick={() => { setShowProfileMenu(false); router.push("/settings"); }}
                      className="w-full flex items-center gap-2.5 px-3 py-2 text-xs font-semibold text-gray-700 dark:text-[#c8ccc5] hover:bg-gray-100 dark:hover:bg-white/8 rounded-xl transition-colors text-left"
                    >
                      <Settings className="w-4 h-4 text-gray-500" />
                      <span>Platform Settings</span>
                    </button>
                    <button
                      onClick={() => { setShowProfileMenu(false); logout(); }}
                      className="w-full flex items-center gap-2.5 px-3 py-2 text-xs font-semibold text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/30 rounded-xl transition-colors text-left"
                    >
                      <LogOut className="w-4 h-4 text-red-500" />
                      <span>Logout</span>
                    </button>
                  </div>
                )}
              </div>
            </div>
          ) : (
            <div className="flex flex-col gap-3.5 w-full">
              <button
                onClick={toggleTheme}
                className="flex items-center justify-between px-3 py-2.5 rounded-xl bg-gray-100/80 dark:bg-white/6 border border-gray-200/40 dark:border-white/8 text-xs font-semibold text-gray-800 dark:text-[#c8ccc5]"
              >
                <div className="flex items-center gap-2.5">
                  {isDark ? <Sun className="w-4 h-4 text-amber-300" /> : <Moon className="w-4 h-4 text-gray-600" />}
                  <span>{isDark ? "Light Mode" : "Dark Mode"}</span>
                </div>
                <span className="text-[10px] font-bold uppercase px-2 py-0.5 rounded bg-gray-200/70 dark:bg-white/10">
                  {isDark ? "DARK" : "LIGHT"}
                </span>
              </button>

              <div className="px-1">
                <WalletBalance />
              </div>

              <div className="relative" ref={menuRef}>
                <div
                  onClick={() => setShowProfileMenu(!showProfileMenu)}
                  className="flex items-center justify-between px-2 py-1.5 rounded-xl hover:bg-gray-100/70 dark:hover:bg-white/6 transition-colors cursor-pointer"
                >
                  <div className="flex items-center gap-2.5 min-w-0">
                    <UserAvatar size="w-7 h-7" />
                    <span className="text-xs font-semibold text-gray-800 dark:text-[#c8ccc5] truncate">
                      Harsh Goel (Nick)
                    </span>
                  </div>
                  <ChevronUp className="w-4 h-4 text-gray-400" />
                </div>

                {showProfileMenu && (
                  <div className="absolute left-0 bottom-12 w-full bg-white dark:bg-[#1c1e1a] border border-gray-200 dark:border-[#282b26] rounded-2xl shadow-xl p-1.5 z-50 space-y-0.5">
                    <button
                      onClick={() => { setShowProfileMenu(false); router.push("/settings"); }}
                      className="w-full flex items-center gap-2.5 px-3 py-2 text-xs font-semibold text-gray-700 dark:text-[#c8ccc5] hover:bg-gray-100 dark:hover:bg-white/8 rounded-xl transition-colors text-left"
                    >
                      <Settings className="w-4 h-4 text-gray-500" />
                      <span>Platform Settings</span>
                    </button>
                    <button
                      onClick={() => { setShowProfileMenu(false); logout(); }}
                      className="w-full flex items-center gap-2.5 px-3 py-2 text-xs font-semibold text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/30 rounded-xl transition-colors text-left"
                    >
                      <LogOut className="w-4 h-4 text-red-500" />
                      <span>Logout</span>
                    </button>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
