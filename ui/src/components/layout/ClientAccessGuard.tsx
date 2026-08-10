"use client";

import React from "react";
import { ShieldAlert, ArrowLeft, Lock } from "lucide-react";
import { useRouter } from "next/navigation";
import { useCurrentUserRole } from "@/hooks/useCurrentUserRole";

interface ClientAccessGuardProps {
  children: React.ReactNode;
  featureName?: string;
}

export const ClientAccessGuard: React.FC<ClientAccessGuardProps> = ({
  children,
  featureName = "this page",
}) => {
  const router = useRouter();
  const { role, isSuperadmin, loading } = useCurrentUserRole();

  if (loading) {
    return (
      <div className="w-full h-full flex items-center justify-center py-20">
        <div className="w-8 h-8 rounded-full border-2 border-emerald-500 border-t-transparent animate-spin" />
      </div>
    );
  }

  // Block client users unless superadmin
  if (role === "client" && !isSuperadmin) {
    return (
      <div className="w-full h-full min-h-[70vh] flex flex-col items-center justify-center p-6 text-center">
        <div className="w-16 h-16 rounded-2xl bg-amber-500/10 border border-amber-500/20 flex items-center justify-center mb-4 text-amber-500 shadow-xl">
          <Lock className="w-8 h-8" />
        </div>
        <h2 className="text-2xl font-serif font-normal text-gray-900 dark:text-white mb-2">
          Access Restricted
        </h2>
        <p className="text-sm text-gray-500 dark:text-[#9ca39a] max-w-md mb-6 leading-relaxed">
          Your client role does not have permission to access {featureName}.
          Please contact your workspace administrator to upgrade your access permissions.
        </p>
        <button
          onClick={() => router.push("/workflow")}
          className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-medium text-xs transition-colors shadow-lg shadow-emerald-600/20 cursor-pointer"
        >
          <ArrowLeft className="w-4 h-4" />
          <span>Back to Voice Agents</span>
        </button>
      </div>
    );
  }

  return <>{children}</>;
};
