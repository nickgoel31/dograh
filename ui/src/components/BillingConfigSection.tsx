"use client";

import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Trash2, Plus } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useAuth } from "@/lib/auth";
import { getBillingConfig, saveBillingConfig } from "@/lib/billing-api";
import { DEFAULT_TIER_THRESHOLDS, DEFAULT_PRICES, BillingConfiguration, TierConfig } from "@/lib/pricing-config";

export function BillingConfigSection() {
  const { user, loading: authLoading } = useAuth();
  
  const [config, setConfig] = useState<BillingConfiguration>({
    tiers: DEFAULT_TIER_THRESHOLDS,
    prices: DEFAULT_PRICES
  });
  
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const hasFetched = useRef(false);

  useEffect(() => {
    if (authLoading || !user || hasFetched.current) {
      return;
    }
    hasFetched.current = true;
    fetchConfig();
  }, [authLoading, user]);

  async function fetchConfig() {
    try {
      const data = await getBillingConfig();
      if (data && data.configured) {
        setConfig({ tiers: data.tiers, prices: data.prices });
      }
    } catch {
      // Fallback to defaults
    } finally {
      setLoading(false);
    }
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    try {
      await saveBillingConfig(config);
      toast.success("Billing configuration saved");
    } catch {
      toast.error("Failed to save billing configuration");
    } finally {
      setSaving(false);
    }
  }

  const updateTier = (index: number, field: keyof TierConfig, value: string | number | null) => {
    const newTiers = [...config.tiers];
    newTiers[index] = { ...newTiers[index], [field]: value };
    setConfig({ ...config, tiers: newTiers });
  };

  const updatePrice = (label: string, mode: 'per_minute' | 'per_30s', value: number) => {
    const newPrices = { ...config.prices };
    if (!newPrices[label]) {
      newPrices[label] = { per_minute: 0, per_30s: 0 };
    }
    newPrices[label][mode] = value;
    setConfig({ ...config, prices: newPrices });
  };

  const removeTier = (index: number) => {
    const newTiers = [...config.tiers];
    const removedLabel = newTiers[index].label;
    newTiers.splice(index, 1);
    
    const newPrices = { ...config.prices };
    delete newPrices[removedLabel];
    
    setConfig({ tiers: newTiers, prices: newPrices });
  };

  const addTier = () => {
    const label = `Tier ${config.tiers.length + 1}`;
    setConfig({
      tiers: [...config.tiers, { label, maxCalls: 5000 }],
      prices: { ...config.prices, [label]: { per_minute: 0, per_30s: 0 } }
    });
  };

  if (loading) {
    return <p className="text-sm text-muted-foreground">Loading...</p>;
  }

  return (
    <form onSubmit={handleSave} className="space-y-6">
      <p className="text-sm text-muted-foreground">
        Configure the billing tiers and prices for this organization.
      </p>

      <div className="space-y-4">
        {config.tiers.map((tier, index) => (
          <div key={index} className="flex flex-col gap-3 p-4 border rounded-md bg-muted/20 relative">
            <div className="absolute right-2 top-2">
              <Button type="button" variant="ghost" size="sm" onClick={() => removeTier(index)}>
                <Trash2 className="h-4 w-4 text-destructive" />
              </Button>
            </div>
            
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1">
                <Label>Tier Name</Label>
                <Input 
                  value={tier.label} 
                  onChange={(e) => updateTier(index, 'label', e.target.value)} 
                  required
                />
              </div>
              <div className="space-y-1">
                <Label>Max Monthly Calls</Label>
                <Input 
                  type="number"
                  placeholder="Leave empty for Infinity"
                  value={tier.maxCalls === null ? "" : tier.maxCalls} 
                  onChange={(e) => updateTier(index, 'maxCalls', e.target.value ? parseInt(e.target.value) : null)} 
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1">
                <Label>Price per Minute (₹)</Label>
                <Input 
                  type="number"
                  step="0.01"
                  value={config.prices[tier.label]?.per_minute ?? 0}
                  onChange={(e) => updatePrice(tier.label, 'per_minute', parseFloat(e.target.value))}
                  required
                />
              </div>
              <div className="space-y-1">
                <Label>Price per 30s (₹)</Label>
                <Input 
                  type="number"
                  step="0.01"
                  value={config.prices[tier.label]?.per_30s ?? 0}
                  onChange={(e) => updatePrice(tier.label, 'per_30s', parseFloat(e.target.value))}
                  required
                />
              </div>
            </div>
          </div>
        ))}
      </div>

      <div className="flex gap-2">
        <Button type="button" variant="outline" onClick={addTier}>
          <Plus className="h-4 w-4 mr-2" />
          Add Tier
        </Button>
        <Button type="submit" disabled={saving}>
          {saving ? "Saving..." : "Save Configuration"}
        </Button>
      </div>
    </form>
  );
}
