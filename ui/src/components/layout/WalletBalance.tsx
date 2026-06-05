"use client";

import { CreditCard, RefreshCw, Wallet } from "lucide-react";
import { useEffect, useState } from "react";

import { client } from "@/client/client.gen";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { useAuth } from "@/lib/auth";

interface WalletData {
  balance: number;
  billing_rate: number;
  billing_pulse: number;
}

export function WalletBalance() {
  const { user } = useAuth();
  const [wallet, setWallet] = useState<WalletData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  const fetchWallet = async () => {
    setLoading(true);
    setError(false);
    try {
      const res = await client.request<WalletData>({
        method: "GET",
        url: "/api/v1/organizations/wallet",
      });
      if (res.data) {
        setWallet(res.data);
      } else {
        setError(true);
      }
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (user) {
      fetchWallet();
    }
  }, [user]);

  if (!user) return null;

  if (loading && !wallet) {
    return (
      <div className="flex h-8 w-28 animate-pulse items-center justify-center rounded-full bg-muted/50 text-xs text-muted-foreground border border-border/40">
        <RefreshCw className="mr-1 h-3.5 w-3.5 animate-spin" />
        Loading...
      </div>
    );
  }

  if (error || !wallet) {
    return null; // Don't block header if not configured/errored
  }

  const pulseLabel =
    wallet.billing_pulse === 1
      ? "1s"
      : wallet.billing_pulse === 15
      ? "15s"
      : wallet.billing_pulse === 30
      ? "30s"
      : "60s";

  return (
    <TooltipProvider delayDuration={150}>
      <Tooltip>
        <TooltipTrigger asChild>
          <div className="flex items-center gap-1.5 cursor-pointer select-none">
            {/* Glassmorphic Balance Pill */}
            <div className="flex items-center gap-2 rounded-full border border-emerald-500/20 bg-emerald-500/5 px-3.5 py-1.5 text-xs font-semibold text-emerald-600 shadow-sm backdrop-blur-md transition-all hover:bg-emerald-500/10 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-400 dark:hover:bg-emerald-500/15">
              <Wallet className="h-3.5 w-3.5 text-emerald-500 dark:text-emerald-400" />
              <span>₹{(wallet.balance ?? 0).toFixed(2)}</span>
            </div>
          </div>
        </TooltipTrigger>
        <TooltipContent align="end" className="w-64 p-3 bg-popover/95 backdrop-blur-md border border-border/80 shadow-lg rounded-xl">
          <div className="space-y-2.5">
            <div className="flex items-center gap-2 pb-1 border-b border-border/50">
              <CreditCard className="h-4 w-4 text-primary" />
              <span className="font-semibold text-sm">Wallet & Billing</span>
            </div>

            <div className="flex justify-between items-center text-xs">
              <span className="text-muted-foreground">Available Balance</span>
              <span className="font-semibold text-emerald-600 dark:text-emerald-400">
                ₹{(wallet.balance ?? 0).toFixed(2)}
              </span>
            </div>

            <div className="flex justify-between items-center text-xs">
              <span className="text-muted-foreground">Call Rate</span>
              <span className="font-medium text-foreground">
                ₹{(wallet.billing_rate ?? 0).toFixed(2)} / min
              </span>
            </div>

            <div className="flex justify-between items-center text-xs">
              <span className="text-muted-foreground">Billing Pulse</span>
              <span className="font-medium text-foreground">{pulseLabel}</span>
            </div>

            <button
              onClick={(e) => {
                e.stopPropagation();
                fetchWallet();
              }}
              className="mt-1 flex w-full items-center justify-center gap-1.5 rounded-lg border border-border bg-background py-1.5 text-[10px] font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
            >
              <RefreshCw className="h-3 w-3" />
              Refresh Balance
            </button>
          </div>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
