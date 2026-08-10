"use client";

import React, { useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { PrimarySidebar } from "./PrimarySidebar";
import { SecondarySidebar } from "./SecondarySidebar";
import { ThemeProvider } from "@/context/ThemeContext";

interface DualSidebarLayoutProps {
  children: React.ReactNode;
}

export const DualSidebarLayout: React.FC<DualSidebarLayoutProps> = ({ children }) => {
  const pathname = usePathname();
  const router = useRouter();
  
  const [isPrimaryHovered, setIsPrimaryHovered] = useState(false);
  const [isSecondaryCollapsed, setIsSecondaryCollapsed] = useState(false);

  // Keep existing app routes intact
  const handleNavigate = (routePath: string) => {
    router.push(routePath);
  };

  return (
    <ThemeProvider>
      <div className="flex h-screen w-screen overflow-hidden text-[#f2f4f0] font-sans antialiased relative" style={{backgroundColor: '#161715'}}>
        {/* 1. Primary Inner Icon Sidebar (68px / 270px on hover) */}
        <PrimarySidebar
          isHovered={isPrimaryHovered}
          setIsHovered={setIsPrimaryHovered}
        />

        {/* 2. Secondary Outer Categorized Sidebar (280px / collapsible) */}
        <div className="flex-1 flex h-full overflow-hidden relative">
          <SecondarySidebar
            activePath={pathname}
            isCollapsed={isSecondaryCollapsed}
            onToggleCollapse={() => setIsSecondaryCollapsed(!isSecondaryCollapsed)}
            onNavigate={handleNavigate}
          />

          {/* 3. Your Existing App Page Content Unchanged */}
          <main className="flex-1 h-full overflow-y-auto relative" style={{backgroundColor: '#161715'}}>
            {children}
          </main>
        </div>
      </div>
    </ThemeProvider>
  );
};
