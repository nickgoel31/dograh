"use client";

import { Lock } from "lucide-react";
import React from "react";

import { useCurrentUserRole } from "@/hooks/useCurrentUserRole";

/** Replaces model/provider settings with a notice when the platform manages them. */
export function ManagedModelsGate({ children }: { children: React.ReactNode }) {
  const { modelsHidden, loading } = useCurrentUserRole();
  if (loading) return null;
  if (!modelsHidden) return <>{children}</>;
  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center p-6 text-center">
      <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-2xl border border-border bg-card">
        <Lock className="h-6 w-6 text-muted-foreground" />
      </div>
      <h2 className="mb-2 text-xl font-semibold">Models are managed for you</h2>
      <p className="max-w-md text-sm text-muted-foreground">
        Your service provider chooses and maintains the voice and language models behind your agents. Ask them if you
        would like a different voice quality tier.
      </p>
    </div>
  );
}
