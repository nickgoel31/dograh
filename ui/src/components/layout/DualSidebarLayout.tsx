"use client";

import React, { useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import Image from "next/image";
import Link from "next/link";
import { PanelLeft } from "lucide-react";
import { PrimarySidebar } from "./PrimarySidebar";
import { SecondarySidebar } from "./SecondarySidebar";
import { ThemeProvider } from "@/context/ThemeContext";
import { SidebarProvider, useSidebar } from "@/components/ui/sidebar";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { useCurrentUserRole } from "@/hooks/useCurrentUserRole";

interface DualSidebarLayoutProps {
  children: React.ReactNode;
}

const DualSidebarInner: React.FC<DualSidebarLayoutProps> = ({ children }) => {
  const pathname = usePathname();
  const router = useRouter();
  const { openMobile, setOpenMobile, toggleSidebar } = useSidebar();
  const { selectedOrgName } = useCurrentUserRole();
  
  const [isPrimaryHovered, setIsPrimaryHovered] = useState(false);
  const [isSecondaryCollapsed, setIsSecondaryCollapsed] = useState(false);

  const handleNavigate = (routePath: string) => {
    router.push(routePath);
  };

  const isWorkflowEditor = /^\/workflow\/\d+$/.test(pathname);
  const hasNeuralHeader = pathname === "/overview" || pathname === "/settings" || pathname === "/whatsapp" || pathname.startsWith("/superadmin");

  return (
    <div className="flex h-screen w-screen overflow-hidden text-[#f2f4f0] font-sans antialiased relative" style={{backgroundColor: '#161715'}}>
      {/* Mobile Navigation Sheet / Drawer */}
      <Sheet open={openMobile} onOpenChange={setOpenMobile}>
        <SheetContent side="left" className="w-[320px] max-w-[85vw] p-0 bg-white dark:bg-[#161715] border-r border-gray-200 dark:border-[#242722] [&>button]:text-gray-400 [&>button]:top-3 [&>button]:right-3 z-50">
          <SheetHeader className="sr-only">
            <SheetTitle>Navigation Menu</SheetTitle>
            <SheetDescription>Main navigation and workspace options</SheetDescription>
          </SheetHeader>
          <div className="flex h-full w-full overflow-hidden">
            <PrimarySidebar
              isHovered={false}
              setIsHovered={() => {}}
            />
            <div className="flex-1 h-full overflow-hidden">
              <SecondarySidebar
                activePath={pathname}
                isCollapsed={false}
                onToggleCollapse={() => {}}
                onNavigate={handleNavigate}
              />
            </div>
          </div>
        </SheetContent>
      </Sheet>

      {/* Desktop Primary Sidebar */}
      <div className="hidden md:block h-full flex-shrink-0">
        <PrimarySidebar
          isHovered={isPrimaryHovered}
          setIsHovered={setIsPrimaryHovered}
        />
      </div>

      {/* Main Content & Desktop Secondary Sidebar Area */}
      <div className="flex-1 flex h-full overflow-hidden relative">
        <div className="hidden md:block h-full flex-shrink-0">
          <SecondarySidebar
            activePath={pathname}
            isCollapsed={isSecondaryCollapsed}
            onToggleCollapse={() => setIsSecondaryCollapsed(!isSecondaryCollapsed)}
            onNavigate={handleNavigate}
          />
        </div>

        {/* Content Container */}
        <main className="flex-1 h-full flex flex-col overflow-hidden relative" style={{backgroundColor: '#161715'}}>
          {/* Mobile Top Header Bar */}
          {!isWorkflowEditor && !hasNeuralHeader && (
            <div className="md:hidden flex h-14 items-center justify-between px-4 border-b border-gray-200/80 dark:border-[#242722] bg-white dark:bg-[#161715] flex-shrink-0 z-30 select-none">
              <div className="flex items-center gap-3">
                <button
                  onClick={toggleSidebar}
                  className="p-1.5 rounded-xl text-gray-500 dark:text-[#9ca39a] hover:bg-gray-100 dark:hover:bg-white/8 transition-colors cursor-pointer"
                  aria-label="Toggle navigation menu"
                >
                  <PanelLeft className="w-5 h-5" />
                </button>
                <Link href="/" className="flex items-center gap-2">
                  <Image
                    src="/logo.webp"
                    alt="Swarvo AI"
                    width={26}
                    height={26}
                    className="rounded-lg object-cover dark:invert"
                    unoptimized
                  />
                  <span className="font-bold text-sm tracking-tight text-gray-900 dark:text-white">
                    Swarvo AI
                  </span>
                </Link>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-xs font-semibold text-gray-500 dark:text-[#9ca39a] truncate max-w-[130px]">
                  {selectedOrgName || "Workspace"}
                </span>
              </div>
            </div>
          )}

          <div className="flex-1 overflow-y-auto relative">
            {children}
          </div>
        </main>
      </div>
    </div>
  );
};

export const DualSidebarLayout: React.FC<DualSidebarLayoutProps> = ({ children }) => {
  return (
    <ThemeProvider>
      <SidebarProvider defaultOpen={true}>
        <DualSidebarInner>{children}</DualSidebarInner>
      </SidebarProvider>
    </ThemeProvider>
  );
};
