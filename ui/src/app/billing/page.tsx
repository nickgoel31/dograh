"use client";

import { AlertTriangle, ChevronLeft, ChevronRight, Wallet } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";

import { Skeleton } from "@/components/ui/skeleton";
import { useAuth } from "@/lib/auth";
import {
  ENTRY_LABELS,
  fetchLedger,
  fetchWallet,
  formatMinutes,
  formatMoney,
  type LedgerEntry,
  type WalletData,
} from "@/lib/wallet";

const PAGE_SIZE = 25;
const FILTERS: { value: string; label: string }[] = [
  { value: "", label: "All activity" },
  { value: "usage", label: "Calls" },
  { value: "grant", label: "Allowances" },
  { value: "topup", label: "Minute top-ups" },
  { value: "money_topup", label: "Balance top-ups" },
  { value: "adjustment", label: "Adjustments" },
  { value: "expiry", label: "Expired" },
];

export default function BillingPage() {
  const auth = useAuth();
  const [wallet, setWallet] = useState<WalletData | null>(null);
  const [entries, setEntries] = useState<LedgerEntry[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(0);
  const [filter, setFilter] = useState("");
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [w, l] = await Promise.all([
        fetchWallet(),
        fetchLedger({ limit: PAGE_SIZE, offset: page * PAGE_SIZE, entry_type: filter || undefined }),
      ]);
      setWallet(w);
      setEntries(l?.items ?? []);
      setTotal(l?.total ?? 0);
    } catch {
      toast.error("Failed to load billing data");
    } finally {
      setLoading(false);
    }
  }, [page, filter]);

  useEffect(() => {
    if (auth.isAuthenticated) load();
  }, [auth.isAuthenticated, load]);

  const currency = wallet?.currency ?? "INR";
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <div className="flex h-full flex-col bg-background text-foreground">
      <header className="sticky top-0 z-20 flex items-center justify-between border-b border-border bg-background px-8 pb-3 pt-6">
        <div className="space-y-0.5">
          <div className="flex items-center gap-2">
            <Wallet className="h-4 w-4 text-emerald-400" />
            <h1 className="text-base font-semibold tracking-tight">Wallet &amp; Billing</h1>
          </div>
          <p className="text-xs text-muted-foreground">
            Every minute and every payment, from one ledger. These are exactly the balances calls are billed against.
          </p>
        </div>
      </header>

      <main className="flex-1 space-y-6 overflow-y-auto px-8 py-6">
        {wallet && !wallet.wallet_enabled && (
          <div className="rounded-xl border border-border bg-card p-4 text-sm text-muted-foreground">
            The wallet is not enabled for this workspace, so calls are not limited. Usage is still recorded below.
          </div>
        )}
        {wallet?.out_of_balance && (
          <Banner tone="red">You are out of minutes and balance. New calls are blocked until you top up.</Banner>
        )}
        {wallet && !wallet.out_of_balance && wallet.low_balance && (
          <Banner tone="amber">
            Running low: about {formatMinutes(wallet.minutes_available)} of calling left.
          </Banner>
        )}

        <section className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {loading && !wallet ? (
            Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-24 rounded-xl" />)
          ) : wallet ? (
            <>
              <Stat
                label="Minutes available"
                value={formatMinutes(wallet.minutes_available)}
                hint={`${formatMinutes(wallet.minutes_remaining)} prepaid + balance at ${formatMoney(wallet.billing_rate, currency)}/min`}
              />
              <Stat
                label="Money balance"
                value={formatMoney(wallet.balance, currency)}
                hint={wallet.allow_overdraft ? "Overdraft allowed" : "Pays for calls beyond your minutes"}
              />
              <Stat
                label="Used this period"
                value={formatMinutes(wallet.minutes_used)}
                hint={
                  wallet.overage_minutes_this_period > 0
                    ? `${formatMinutes(wallet.overage_minutes_this_period)} billed as overage`
                    : "All within your minutes"
                }
              />
              <Stat
                label="Next reset"
                value={new Date(wallet.next_reset).toLocaleDateString()}
                hint={wallet.monthly_carry_forward ? "Unused minutes roll over" : "Unused monthly minutes expire"}
              />
            </>
          ) : null}
        </section>

        {wallet && wallet.buckets.length > 0 && (
          <section className="rounded-xl border border-border bg-card">
            <h2 className="border-b border-border px-5 py-3 text-sm font-semibold">Minute pools</h2>
            <ul className="divide-y divide-border">
              {wallet.buckets.map((b) => (
                <li key={b.id} className="flex items-center justify-between px-5 py-3 text-sm">
                  <div>
                    <p className="font-medium capitalize">{b.kind.replace("_", " ")}</p>
                    <p className="text-xs text-muted-foreground">
                      {b.expires_at ? `Expires ${new Date(b.expires_at).toLocaleDateString()}` : "Never expires"}
                    </p>
                  </div>
                  <p className="tabular-nums">
                    <span className="font-semibold">{formatMinutes(b.minutes_remaining)}</span>
                    <span className="text-muted-foreground"> / {formatMinutes(b.minutes_total)}</span>
                  </p>
                </li>
              ))}
            </ul>
          </section>
        )}

        <section className="rounded-xl border border-border bg-card">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-5 py-3">
            <h2 className="text-sm font-semibold">Ledger</h2>
            <select
              value={filter}
              onChange={(e) => {
                setPage(0);
                setFilter(e.target.value);
              }}
              className="rounded-md border border-border bg-background px-2.5 py-1.5 text-xs"
            >
              {FILTERS.map((f) => (
                <option key={f.value} value={f.value}>
                  {f.label}
                </option>
              ))}
            </select>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-xs text-muted-foreground">
                <tr>
                  <th className="px-5 py-2.5 font-medium">When</th>
                  <th className="px-3 py-2.5 font-medium">Type</th>
                  <th className="px-3 py-2.5 font-medium">Details</th>
                  <th className="px-3 py-2.5 text-right font-medium">Minutes</th>
                  <th className="px-3 py-2.5 text-right font-medium">Money</th>
                  <th className="px-5 py-2.5 text-right font-medium">Minutes left</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {entries.map((e) => (
                  <tr key={e.id} className="hover:bg-muted/30">
                    <td className="whitespace-nowrap px-5 py-2.5 text-xs text-muted-foreground">
                      {e.created_at ? new Date(e.created_at).toLocaleString() : "-"}
                    </td>
                    <td className="px-3 py-2.5">{ENTRY_LABELS[e.entry_type] ?? e.entry_type}</td>
                    <td className="px-3 py-2.5 text-xs text-muted-foreground">
                      {e.description}
                      {e.entry_type === "usage" && e.billed_seconds != null && (
                        <span>
                          {" "}
                          · billed {Math.round(e.billed_seconds)}s
                          {e.overage_minutes > 0 ? ` · ${e.overage_minutes.toFixed(2)} min overage` : ""}
                        </span>
                      )}
                    </td>
                    <td className={`px-3 py-2.5 text-right tabular-nums ${signTone(e.minutes_delta)}`}>
                      {e.minutes_delta === 0 ? "-" : `${e.minutes_delta > 0 ? "+" : ""}${e.minutes_delta.toFixed(2)}`}
                    </td>
                    <td className={`px-3 py-2.5 text-right tabular-nums ${signTone(e.money_delta)}`}>
                      {e.money_delta === 0 ? "-" : formatMoney(e.money_delta, currency)}
                    </td>
                    <td className="px-5 py-2.5 text-right tabular-nums text-muted-foreground">
                      {e.minutes_balance_after != null ? e.minutes_balance_after.toFixed(1) : "-"}
                    </td>
                  </tr>
                ))}
                {!loading && entries.length === 0 && (
                  <tr>
                    <td colSpan={6} className="px-5 py-10 text-center text-sm text-muted-foreground">
                      No activity yet.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          <div className="flex items-center justify-between border-t border-border px-5 py-3 text-xs text-muted-foreground">
            <span>{total} entries</span>
            <div className="flex items-center gap-2">
              <button
                disabled={page === 0}
                onClick={() => setPage((p) => p - 1)}
                className="rounded-md border border-border p-1 disabled:opacity-40"
              >
                <ChevronLeft className="h-4 w-4" />
              </button>
              <span>
                Page {page + 1} of {pages}
              </span>
              <button
                disabled={page + 1 >= pages}
                onClick={() => setPage((p) => p + 1)}
                className="rounded-md border border-border p-1 disabled:opacity-40"
              >
                <ChevronRight className="h-4 w-4" />
              </button>
            </div>
          </div>
        </section>
      </main>
    </div>
  );
}

function signTone(v: number): string {
  if (v < 0) return "text-red-400";
  if (v > 0) return "text-emerald-400";
  return "text-muted-foreground";
}

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-1 text-2xl font-semibold tabular-nums">{value}</p>
      {hint && <p className="mt-1 text-[11px] text-muted-foreground">{hint}</p>}
    </div>
  );
}

function Banner({ tone, children }: { tone: "red" | "amber"; children: React.ReactNode }) {
  const cls =
    tone === "red"
      ? "border-red-500/40 bg-red-500/10 text-red-300"
      : "border-amber-500/40 bg-amber-500/10 text-amber-300";
  return (
    <div className={`flex items-center gap-2 rounded-xl border px-4 py-3 text-sm ${cls}`}>
      <AlertTriangle className="h-4 w-4 shrink-0" />
      {children}
    </div>
  );
}
