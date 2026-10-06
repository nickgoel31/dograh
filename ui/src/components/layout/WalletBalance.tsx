"use client";

import { AlertTriangle, CreditCard, RefreshCw, Wallet } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { useAuth } from "@/lib/auth";
import { fetchWallet, formatMinutes, formatMoney, type WalletData } from "@/lib/wallet";

const REFRESH_MS = 60_000;

export function WalletBalance() {
  const { user } = useAuth();
  const [wallet, setWallet] = useState<WalletData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(false);
    try {
      const data = await fetchWallet();
      setWallet(data);
      setError(!data);
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!user) return;
    load();
    const id = setInterval(load, REFRESH_MS);
    return () => clearInterval(id);
  }, [user, load]);

  if (!user) return null;

  if (loading && !wallet) {
    return (
      <div className="flex h-8 w-28 animate-pulse items-center justify-center rounded-full border border-border/40 bg-muted/50 text-xs text-muted-foreground">
        <RefreshCw className="mr-1 h-3.5 w-3.5 animate-spin" />
        Loading...
      </div>
    );
  }

  // Don't clutter the sidebar for organizations that don't use the wallet.
  if (error || !wallet || !wallet.wallet_enabled) return null;

  const warn = wallet.low_balance || wallet.out_of_balance;
  const tone = wallet.out_of_balance
    ? "border-red-500/40 bg-red-500/10 text-red-400"
    : wallet.low_balance
      ? "border-amber-500/40 bg-amber-500/10 text-amber-400"
      : "border-emerald-500/30 bg-emerald-500/10 text-emerald-400";

  return (
    <TooltipProvider delayDuration={150}>
      <Tooltip>
        <TooltipTrigger asChild>
          <Link
            href="/billing"
            className={`flex select-none items-center gap-2 rounded-full border px-3.5 py-1.5 text-xs font-semibold shadow-sm backdrop-blur-md transition-all hover:brightness-125 ${tone}`}
          >
            {warn ? <AlertTriangle className="h-3.5 w-3.5" /> : <Wallet className="h-3.5 w-3.5" />}
            <span>{formatMinutes(wallet.minutes_available)}</span>
            {wallet.balance > 0 && (
              <span className="opacity-70">· {formatMoney(wallet.balance, wallet.currency)}</span>
            )}
          </Link>
        </TooltipTrigger>
        <TooltipContent
          align="end"
          className="w-72 space-y-3 rounded-xl border border-border/80 bg-popover/95 p-4 shadow-xl backdrop-blur-md"
        >
          <div className="flex items-center gap-2 border-b border-border/50 pb-1.5">
            <CreditCard className="h-4 w-4 text-emerald-400" />
            <span className="text-sm font-semibold">Wallet</span>
          </div>
          {wallet.out_of_balance && (
            <p className="text-xs text-red-400">No minutes or balance left - new calls are blocked.</p>
          )}
          <dl className="space-y-1.5 text-xs">
            <Row label="Minutes remaining" value={formatMinutes(wallet.minutes_remaining)} strong />
            <Row label="Money balance" value={formatMoney(wallet.balance, wallet.currency)} strong />
            <Row label="Used this period" value={formatMinutes(wallet.minutes_used)} />
            <Row label="Monthly allowance" value={formatMinutes(wallet.monthly_minutes_limit)} />
            <Row label="Rolled over" value={formatMinutes(wallet.carry_forward_minutes)} />
            <Row
              label="Overage rate"
              value={`${formatMoney(wallet.billing_rate, wallet.currency)} / min`}
            />
            <Row label="Billing pulse" value={`${wallet.billing_pulse}s`} />
            <Row label="Next reset" value={new Date(wallet.next_reset).toLocaleDateString()} />
          </dl>
          <button
            onClick={(e) => {
              e.preventDefault();
              load();
            }}
            className="flex w-full items-center justify-center gap-1.5 rounded-lg border border-border bg-background py-1.5 text-[10px] font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
          >
            <RefreshCw className="h-3 w-3" /> Refresh
          </button>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

function Row({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="flex items-center justify-between">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className={strong ? "font-bold text-foreground" : "font-medium text-foreground"}>{value}</dd>
    </div>
  );
}
