import { client } from "@/client/client.gen";
import { detailFromError } from "@/lib/apiError";

export interface WalletBucket {
  id: number;
  kind: string;
  minutes_remaining: number;
  minutes_total: number;
  expires_at: string | null;
}

export interface WalletData {
  wallet_enabled: boolean;
  currency: string;
  balance: number;
  billing_rate: number;
  billing_pulse: number;
  monthly_minutes_limit: number;
  carry_forward_minutes: number;
  minutes_used: number;
  minutes_remaining: number;
  minutes_available: number;
  overage_minutes_this_period: number;
  monthly_carry_forward: boolean;
  allow_overdraft: boolean;
  period_start: string;
  period_end: string;
  next_reset: string;
  low_balance: boolean;
  out_of_balance: boolean;
  buckets: WalletBucket[];
}

export interface LedgerEntry {
  id: number;
  entry_type: string;
  created_at: string | null;
  workflow_run_id: number | null;
  minutes_delta: number;
  money_delta: number;
  overage_minutes: number;
  billed_seconds: number | null;
  rate: number | null;
  minutes_balance_after: number | null;
  money_balance_after: number | null;
  description: string | null;
}

export async function fetchWallet(): Promise<WalletData | null> {
  const res = await client.request<WalletData>({
    method: "GET",
    url: "/api/v1/organizations/wallet",
  });
  if (res.error) throw new Error(detailFromError(res.error, "Failed to load wallet"));
  return res.data ?? null;
}

export async function fetchLedger(params: {
  limit: number;
  offset: number;
  entry_type?: string;
}): Promise<{ items: LedgerEntry[]; total: number } | null> {
  const query = new URLSearchParams({
    limit: String(params.limit),
    offset: String(params.offset),
  });
  if (params.entry_type) query.set("entry_type", params.entry_type);
  const res = await client.request<{ items: LedgerEntry[]; total: number }>({
    method: "GET",
    url: `/api/v1/organizations/wallet/ledger?${query.toString()}`,
  });
  if (res.error) throw new Error(detailFromError(res.error, "Failed to load ledger"));
  return (res.data as { items: LedgerEntry[]; total: number } | undefined) ?? null;
}

export function formatMoney(amount: number, currency = "INR"): string {
  try {
    return new Intl.NumberFormat(undefined, {
      style: "currency",
      currency,
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(amount);
  } catch {
    return `${currency} ${amount.toFixed(2)}`;
  }
}

export function formatMinutes(minutes: number): string {
  return `${minutes.toFixed(minutes % 1 === 0 ? 0 : 1)} min`;
}

export const ENTRY_LABELS: Record<string, string> = {
  usage: "Call usage",
  grant: "Monthly allowance",
  topup: "Minutes top-up",
  money_topup: "Balance top-up",
  adjustment: "Adjustment",
  expiry: "Expired minutes",
};
