import { client } from '@/client/client.gen';
import { BillingConfiguration } from './pricing-config';

export async function getBillingConfig() {
  const res = await client.request<{ tiers: any[]; prices: any; configured: boolean }>({
    method: 'GET',
    url: '/api/v1/organizations/billing-config',
  });
  return res.data;
}

export async function saveBillingConfig(config: BillingConfiguration) {
  const res = await client.request<{ tiers: any[]; prices: any; configured: boolean }>({
    method: 'POST',
    url: '/api/v1/organizations/billing-config',
    body: config,
  });
  return res.data;
}
