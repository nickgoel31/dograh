import { client } from "@/client/client.gen";
import { detailFromError } from "@/lib/apiError";
import type { WalletData } from "@/lib/wallet";

export interface ModelProfileSummary {
  id: number;
  display_name: string;
  description: string | null;
  tier: string | null;
  capabilities: string[];
}

export interface ClientStats {
  calls: number;
  minutes: number;
  wholesale_cost: number;
  overage_revenue: number;
  list_value: number;
  estimated_margin: number;
}

export interface ResellerClientView {
  id: number;
  name: string | null;
  slug: string | null;
  is_active: boolean;
  wallet_enabled: boolean;
  billing_rate: number;
  billing_pulse: number;
  monthly_minutes_limit: number;
  monthly_carry_forward: boolean;
  allow_overdraft: boolean;
  quota_reset_day: number;
  concurrency_limit: number | null;
  model_profile_id: number | null;
  model_profile_name: string | null;
  wallet: WalletData | null;
  stats: ClientStats | null;
}

export interface ResellerOverview {
  organization: {
    id: number;
    name: string | null;
    wholesale_rate: number | null;
    max_child_orgs: number | null;
    wallet: WalletData;
  };
  period_days: number;
  clients: ResellerClientView[];
  totals: { calls: number; minutes: number; wholesale_cost: number; estimated_margin: number };
}

export async function resellerApi<T>(
  method: "GET" | "POST" | "PATCH" | "PUT",
  path: string,
  body?: unknown,
): Promise<T> {
  const res = await client.request<T>({
    method,
    url: `/api/v1/reseller${path}`,
    ...(body !== undefined ? { body: body as Record<string, unknown> } : {}),
  });
  if (res.error) throw new Error(detailFromError(res.error, "Request failed"));
  return res.data as T;
}
