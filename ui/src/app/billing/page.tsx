"use client";

import { ChevronLeft, ChevronRight, IndianRupee } from 'lucide-react';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';

import { client } from '@/client/client.gen';
import {
  getUsageHistoryApiV1OrganizationsUsageRunsGet,
  getWorkflowsSummaryApiV1WorkflowSummaryGet
} from '@/client/sdk.gen';
import type { WorkflowRunUsageResponse, WorkflowSummaryResponse } from '@/client/types.gen';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { DropdownMenu, DropdownMenuCheckboxItem, DropdownMenuContent, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useAuth } from '@/lib/auth';
import { getBillingConfig } from '@/lib/billing-api';
import {
  type BillingConfiguration,
  type BillingMode,
  calculateCallCharge,
  DEFAULT_PRICES,
  DEFAULT_TIER_THRESHOLDS,
  getBillableUnits,
  getNextTier,
  getPricePerUnit,
  getTier
} from '@/lib/pricing-config';

export default function BillingPage() {
  const auth = useAuth();

  // Date / Month state
  const [currentDate, setCurrentDate] = useState(new Date());

  // Billing mode (per_minute | per_30s)
  const [billingMode, setBillingMode] = useState<BillingMode>('per_minute');
  const [isModeLoaded, setIsModeLoaded] = useState(false);

  // Custom wallet billing settings
  const [wallet, setWallet] = useState<any | null>(null);

  // Billing Config
  const [billingConfig, setBillingConfig] = useState<BillingConfiguration>({
    tiers: DEFAULT_TIER_THRESHOLDS,
    prices: DEFAULT_PRICES
  });

  // Agents / Workflows
  const [workflows, setWorkflows] = useState<WorkflowSummaryResponse[]>([]);
  const [selectedAgentIds, setSelectedAgentIds] = useState<string[]>([]);

  // Runs
  const [isLoadingRuns, setIsLoadingRuns] = useState(true);
  const [currentPage, setCurrentPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);

  // Initialize billing mode from local storage
  useEffect(() => {
    if (auth.isAuthenticated && auth.user) {
      // Use org ID or user ID for the storage key
      const orgId = (auth.user as any)?.orgId || 'default';
      const stored = localStorage.getItem(`billing_config_${orgId}`);
      if (stored === 'per_minute' || stored === 'per_30s') {
        setBillingMode(stored);
      }
      setIsModeLoaded(true);
    }
  }, [auth.isAuthenticated, auth.user]);

  // Handle billing mode change
  const handleBillingModeChange = (val: string) => {
    const newMode = val as BillingMode;
    setBillingMode(newMode);
    if (auth.user) {
      const orgId = (auth.user as any)?.orgId || 'default';
      localStorage.setItem(`billing_config_${orgId}`, newMode);
    }
  };

  // Fetch workflows for dropdown
  useEffect(() => {
    async function fetchWorkflows() {
      if (!auth.isAuthenticated) return;
      try {
        const res = await getWorkflowsSummaryApiV1WorkflowSummaryGet();
        if (res.data) setWorkflows(res.data);
      } catch (err) {
        console.error("Failed to fetch workflows", err);
      }
    }
    fetchWorkflows();
  }, [auth.isAuthenticated]);

  // Fetch billing config
  useEffect(() => {
    async function fetchConfig() {
      if (!auth.isAuthenticated) return;
      try {
        const data = await getBillingConfig();
        if (data && data.configured) {
          setBillingConfig({ tiers: data.tiers, prices: data.prices });
        }
      } catch (err) {
        console.error("Failed to fetch billing config", err);
      }
    }
    fetchConfig();
  }, [auth.isAuthenticated]);

  // Fetch organization wallet details
  useEffect(() => {
    async function fetchWallet() {
      if (!auth.isAuthenticated) return;
      try {
        const year = currentDate.getFullYear();
        const month = currentDate.getMonth() + 1; // 1-indexed for backend
        const res = await client.request({
          method: "GET",
          url: `/api/v1/organizations/wallet?year=${year}&month=${month}`,
        });
        if (res.data) {
          setWallet(res.data);
        }
      } catch (err) {
        console.error("Failed to fetch wallet info", err);
      }
    }
    fetchWallet();
  }, [auth.isAuthenticated, currentDate]);

  // Fetch all runs for the month (to calculate tier)
  // We need to fetch *all* runs for the month, but API is paginated.
  // The user requested: "Fetch ALL pages if total_pages > 1 by looping through with the page param."
  const [allMonthRuns, setAllMonthRuns] = useState<WorkflowRunUsageResponse[]>([]);
  const [isFetchingAll, setIsFetchingAll] = useState(true);

  useEffect(() => {
    let isCancelled = false;

    async function fetchAllRunsForMonth() {
      if (!auth.isAuthenticated) return;
      setIsFetchingAll(true);
      setIsLoadingRuns(true);

      const year = currentDate.getFullYear();
      const month = currentDate.getMonth();
      // start of month UTC
      const start = new Date(Date.UTC(year, month, 1, 0, 0, 0)).toISOString();
      // end of month UTC
      const end = new Date(Date.UTC(year, month + 1, 0, 23, 59, 59, 999)).toISOString();

      let allFetchedRuns: WorkflowRunUsageResponse[] = [];
      let page = 1;
      let morePages = true;

      try {
        while (morePages && !isCancelled) {
          // No agent filter here, we want the org-wide total to calculate the tier correctly
          const res = await getUsageHistoryApiV1OrganizationsUsageRunsGet({
            query: {
              start_date: start,
              end_date: end,
              limit: 100,
              page: page
            }
          });

          if (res.data && res.data.runs) {
            allFetchedRuns = [...allFetchedRuns, ...res.data.runs];
            if (page >= res.data.total_pages) {
              morePages = false;
            } else {
              page++;
            }
          } else {
            morePages = false;
          }
        }

        if (!isCancelled) {
          setAllMonthRuns(allFetchedRuns);
        }
      } catch (err) {
        console.error("Failed to fetch runs", err);
        toast.error("Failed to load billing data");
      } finally {
        if (!isCancelled) {
          setIsFetchingAll(false);
          setIsLoadingRuns(false);
        }
      }
    }

    fetchAllRunsForMonth();
    return () => { isCancelled = true; };
  }, [currentDate, auth.isAuthenticated]);

  // Filter runs by selected agents
  const unsortedFilteredRuns = selectedAgentIds.length === 0
    ? allMonthRuns
    : allMonthRuns.filter(r => selectedAgentIds.includes(r.workflow_id?.toString() || 'unknown'));

  // Explicitly sort descending by created_at
  const filteredRuns = [...unsortedFilteredRuns].sort((a, b) =>
    new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
  );

  // Pagination for Call Log Table
  const ITEMS_PER_PAGE = 25;
  useEffect(() => {
    setTotalPages(Math.max(1, Math.ceil(filteredRuns.length / ITEMS_PER_PAGE)));
    setCurrentPage(1);
  }, [filteredRuns.length]);

  const paginatedRuns = filteredRuns.slice(
    (currentPage - 1) * ITEMS_PER_PAGE,
    currentPage * ITEMS_PER_PAGE
  );

  // Month navigation
  const goToPrevMonth = () => {
    setCurrentDate(prev => {
      const newDate = new Date(prev);
      newDate.setMonth(prev.getMonth() - 1);
      return newDate;
    });
  };

  const goToNextMonth = () => {
    setCurrentDate(prev => {
      const newDate = new Date(prev);
      newDate.setMonth(prev.getMonth() + 1);
      return newDate;
    });
  };

  const isCurrentMonth = () => {
    const now = new Date();
    return currentDate.getMonth() === now.getMonth() && currentDate.getFullYear() === now.getFullYear();
  };

  const getPulseUnitLabel = () => {
    if (wallet && wallet.billing_rate > 0) {
      const pulse = wallet.billing_pulse || 60;
      if (pulse === 1) return "sec";
      if (pulse === 15) return "15s pulse";
      if (pulse === 30) return "30s pulse";
      return "min";
    }
    return billingMode === 'per_minute' ? 'min' : '30s pulse';
  };

  const getPulseUnitShortLabel = () => {
    if (wallet && wallet.billing_rate > 0) {
      const pulse = wallet.billing_pulse || 60;
      if (pulse === 1) return "sec";
      if (pulse === 15) return "15s";
      if (pulse === 30) return "30s";
      return "min";
    }
    return billingMode === 'per_minute' ? 'min' : '30s';
  };

  const getRunBillableUnits = (durationSeconds: number) => {
    if (wallet && wallet.billing_rate > 0) {
      const pulse = wallet.billing_pulse || 60;
      return Math.ceil(durationSeconds / pulse);
    }
    return getBillableUnits(durationSeconds, billingMode);
  };

  const calculateRunCharge = (durationSeconds: number) => {
    if (wallet && wallet.billing_rate > 0) {
      const pulse = wallet.billing_pulse || 60;
      const rate = wallet.billing_rate; // per minute
      const pulses = Math.ceil(durationSeconds / pulse);
      return pulses * ((rate / 60) * pulse);
    }
    return calculateCallCharge(durationSeconds, tier, billingMode, billingConfig.prices);
  };

  // Computations
  const orgTotalCalls = allMonthRuns.length;
  const tier = getTier(orgTotalCalls, billingConfig.tiers);
  const nextTier = getNextTier(orgTotalCalls, billingConfig.tiers);
  const currentRate = wallet && wallet.billing_rate > 0
    ? (wallet.billing_rate / 60) * (wallet.billing_pulse || 60)
    : getPricePerUnit(tier, billingMode, billingConfig.prices);

  // Summary Card computations based on filtered runs
  const totalMinutes = filteredRuns.reduce((acc, run) => acc + (run.call_duration_seconds / 60), 0);
  const totalBillableUnits = filteredRuns.reduce((acc, run) => acc + getRunBillableUnits(run.call_duration_seconds), 0);
  const totalRevenue = filteredRuns.reduce((acc, run) => acc + calculateRunCharge(run.call_duration_seconds), 0);
  const avgRevenuePerCall = filteredRuns.length > 0 ? totalRevenue / filteredRuns.length : 0;

  // Per-Agent breakdown computation
  const breakdownByAgent = new Map<string, {
    name: string,
    calls: number,
    minutes: number,
    billableUnits: number,
    revenue: number
  }>();

  filteredRuns.forEach(run => {
    const key = run.workflow_id?.toString() || 'unknown';
    const name = run.workflow_name || 'Unknown Agent';
    const existing = breakdownByAgent.get(key) || { name, calls: 0, minutes: 0, billableUnits: 0, revenue: 0 };

    existing.calls += 1;
    existing.minutes += (run.call_duration_seconds / 60);
    existing.billableUnits += getRunBillableUnits(run.call_duration_seconds);
    existing.revenue += calculateRunCharge(run.call_duration_seconds);

    breakdownByAgent.set(key, existing);
  });

  const breakdownArray = Array.from(breakdownByAgent.values())
    .sort((a, b) => b.revenue - a.revenue);

  // Formatting helpers
  const formatDuration = (seconds: number) => {
    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = seconds % 60;
    if (minutes === 0) return `${remainingSeconds}s`;
    if (remainingSeconds === 0) return `${minutes}m`;
    return `${minutes}m ${remainingSeconds}s`;
  };

  const formatDate = (dateString: string) => {
    const d = new Date(dateString);
    return d.toLocaleString('en-IN', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      hour12: true
    });
  };

  const formatCurrency = (val: number) => {
    return `₹${val.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  };

  const monthYearString = currentDate.toLocaleString('default', { month: 'long', year: 'numeric' });

  if (!isModeLoaded) return null;

  return (
    <div className="max-w-[1600px] mx-auto w-full p-6 space-y-6 animate-fade-in">
      {/* Header & Settings Bar */}
      <div className="border-b border-[#1d1d22]/50 pb-6">
        <h1 className="text-2xl font-bold tracking-tight text-white flex items-center gap-3">
          <IndianRupee className="h-6 w-6 text-[#7c3aed]" />
          Billing & Usage
        </h1>
        <p className="text-xs text-zinc-500 mt-1">Manage client billing and pricing tiers.</p>
      </div>

      {/* Settings Bar */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          {/* Month Navigator */}
          <div className="flex items-center gap-2 bg-[#111113] border border-[#1d1d22] p-1.5 rounded-xl">
            <Button
              variant="ghost"
              size="icon"
              onClick={goToPrevMonth}
              disabled={isFetchingAll}
              className="h-8 w-8 hover:bg-[#1a1a1f] text-zinc-400 hover:text-white rounded-lg"
            >
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <span className="text-xs font-semibold text-zinc-200 px-2 min-w-[100px] text-center">{monthYearString}</span>
            <Button
              variant="ghost"
              size="icon"
              onClick={goToNextMonth}
              disabled={isCurrentMonth() || isFetchingAll}
              className="h-8 w-8 hover:bg-[#1a1a1f] text-zinc-400 hover:text-white rounded-lg"
            >
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>

          {/* Agent Filter (Multi-Select) */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="outline"
                className="bg-[#121214] border border-[#232328] hover:bg-[#1a1a1f] text-zinc-300 px-3 py-1.5 rounded-xl text-xs font-medium transition-colors h-10 w-[200px] justify-between"
              >
                {selectedAgentIds.length === 0
                  ? "All Agents"
                  : `${selectedAgentIds.length} Agent${selectedAgentIds.length > 1 ? 's' : ''} Selected`}
                <span className="opacity-50 text-[10px]">▼</span>
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent className="bg-[#111113] border border-[#1d1d22] text-zinc-300 rounded-xl" align="end">
              <DropdownMenuCheckboxItem
                checked={selectedAgentIds.length === 0}
                onCheckedChange={() => setSelectedAgentIds([])}
                className="hover:bg-[#1a1a1f] focus:bg-[#1a1a1f] text-xs"
              >
                All Agents
              </DropdownMenuCheckboxItem>
              {workflows.map(wf => {
                const wfIdStr = wf.id?.toString() || '';
                return (
                  <DropdownMenuCheckboxItem
                    key={wf.id}
                    checked={selectedAgentIds.includes(wfIdStr)}
                    onCheckedChange={(checked) => {
                      if (checked) {
                        setSelectedAgentIds(prev => [...prev, wfIdStr]);
                      } else {
                        setSelectedAgentIds(prev => prev.filter(id => id !== wfIdStr));
                      }
                    }}
                    className="hover:bg-[#1a1a1f] focus:bg-[#1a1a1f] text-xs"
                  >
                    {wf.name}
                  </DropdownMenuCheckboxItem>
                );
              })}
            </DropdownMenuContent>
          </DropdownMenu>

          {/* Clear filter button */}
          {selectedAgentIds.length > 0 && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setSelectedAgentIds([])}
              className="text-xs text-zinc-400 hover:text-white hover:bg-white/5 rounded-xl h-10"
            >
              Clear
            </Button>
          )}
        </div>

        {/* Billing Mode Toggle */}
        <div className="flex items-center">
          <Select
            value={wallet && wallet.billing_rate > 0 ? "custom" : billingMode}
            onValueChange={handleBillingModeChange}
            disabled={wallet && wallet.billing_rate > 0}
          >
            <SelectTrigger className="w-[180px] bg-[#121214] border border-[#232328] hover:bg-[#1a1a1f] text-zinc-300 rounded-xl text-xs h-10">
              <SelectValue placeholder="Billing Mode" />
            </SelectTrigger>
            <SelectContent className="bg-[#111113] border border-[#1d1d22] text-zinc-300 rounded-xl">
              {wallet && wallet.billing_rate > 0 ? (
                <SelectItem value="custom" className="hover:bg-[#1a1a1f] focus:bg-[#1a1a1f] text-xs">Custom ({getPulseUnitShortLabel()})</SelectItem>
              ) : (
                <>
                  <SelectItem value="per_minute" className="hover:bg-[#1a1a1f] focus:bg-[#1a1a1f] text-xs">Per Minute</SelectItem>
                  <SelectItem value="per_30s" className="hover:bg-[#1a1a1f] focus:bg-[#1a1a1f] text-xs">Per 30s Pulse</SelectItem>
                </>
              )}
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* Tier Badge Banner */}
      <div className="bg-[#111113] border border-[#1d1d22] rounded-2xl p-4 flex flex-col sm:flex-row items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <span className="bg-blue-500/15 text-blue-400 text-[10px] font-semibold px-2.5 py-0.5 rounded-full border border-blue-500/20">
            📊 {tier}
          </span>
          <span className="text-xs font-medium text-zinc-200">
            {orgTotalCalls.toLocaleString()} calls this month
          </span>
          <span className="text-zinc-700 hidden sm:inline">|</span>
          <span className="text-xs font-semibold text-[#7c3aed]">
            Rate: {formatCurrency(currentRate)}/{getPulseUnitLabel()}
          </span>
        </div>
        {nextTier && !(wallet && wallet.billing_rate > 0) && (
          <div className="text-xs text-zinc-400">
            {Math.max(0, nextTier.maxCalls - orgTotalCalls + 1).toLocaleString()} more calls to reach {nextTier.label} ({formatCurrency(getPricePerUnit(nextTier.label, billingMode))}/{billingMode === 'per_minute' ? 'min' : '30s'})
          </div>
        )}
        {wallet && wallet.billing_rate > 0 && (
          <div className="text-xs text-emerald-400 bg-emerald-500/10 border border-emerald-500/15 px-2.5 py-0.5 rounded-full font-semibold">
            Custom Organization Pricing Active
          </div>
        )}
        {selectedAgentIds.length > 0 && (
          <div className="text-[10px] text-amber-400 bg-amber-500/10 px-2 py-1 rounded border border-amber-500/15">
            Tier is based on org-wide total
          </div>
        )}
      </div>

      {/* Summary Cards */}
      {wallet && wallet.monthly_minutes_limit > 0 ? (
        <div className="grid gap-6 grid-cols-1 sm:grid-cols-2 lg:grid-cols-4">
          <div className="bg-[#111113] border border-[#1d1d22] rounded-2xl p-6 relative overflow-hidden">
            <div className="text-xs font-semibold text-emerald-400 mb-2">Rupees Remaining</div>
            <div className="text-2xl font-bold text-emerald-400">
              ₹{(wallet.balance ?? 0).toFixed(2)}
            </div>
            <p className="text-[10px] text-zinc-500 mt-2">
              Value of unused remaining minutes
            </p>
            <div className="absolute right-0 bottom-0 w-24 h-24 bg-emerald-500/5 rounded-full blur-3xl" />
          </div>

          <div className="bg-[#111113] border border-[#1d1d22] rounded-2xl p-6">
            <div className="text-xs font-semibold text-zinc-400 mb-2">Minutes Remaining</div>
            <div className="text-2xl font-bold text-white">
              {(wallet.minutes_remaining ?? 0).toFixed(1)} min
            </div>
            <p className="text-[10px] text-zinc-500 mt-2">
              Out of {((wallet.monthly_minutes_limit ?? 0) + (wallet.carry_forward_minutes ?? 0)).toFixed(0)} min allowance
            </p>
          </div>

          <div className="bg-[#111113] border border-[#1d1d22] rounded-2xl p-6">
            <div className="text-xs font-semibold text-zinc-400 mb-2">Minutes Used</div>
            <div className="text-2xl font-bold text-white">
              {(wallet.minutes_used ?? 0).toFixed(1)} min
            </div>
            <p className="text-[10px] text-zinc-500 mt-2">
              This cycle's total usage
            </p>
          </div>

          <div className="bg-[#111113] border border-[#1d1d22] rounded-2xl p-6">
            <div className="text-xs font-semibold text-zinc-400 mb-2">Carry Forward</div>
            <div className="text-2xl font-bold text-white">
              {(wallet.carry_forward_minutes ?? 0).toFixed(1)} min
            </div>
            <p className="text-[10px] text-zinc-500 mt-2">
              From previous cycle (2-month limit)
            </p>
          </div>
        </div>
      ) : (
        <div className="grid gap-6 grid-cols-1 sm:grid-cols-2 lg:grid-cols-4">
          <div className="bg-[#111113] border border-[#1d1d22] rounded-2xl p-6">
            <div className="text-xs font-semibold text-zinc-400 mb-2">Accumulated Minutes</div>
            <div className="text-2xl font-bold text-white">{totalMinutes.toFixed(1)}</div>
            <p className="text-[10px] text-zinc-500 mt-2">
              Raw sum of durations
            </p>
          </div>

          <div className="bg-[#111113] border border-[#1d1d22] rounded-2xl p-6">
            <div className="text-xs font-semibold text-zinc-400 mb-2">Billable Units</div>
            <div className="text-2xl font-bold text-white">{totalBillableUnits.toLocaleString()}</div>
            <p className="text-[10px] text-zinc-500 mt-2">
              {wallet && wallet.billing_rate > 0
                ? `Total billable ${getPulseUnitShortLabel()} units`
                : (billingMode === 'per_minute' ? 'Total billable minutes' : 'Total 30s pulses')}
            </p>
          </div>

          <div className="bg-[#111113] border border-[#1d1d22] rounded-2xl p-6 relative overflow-hidden">
            <div className="text-xs font-semibold text-[#7c3aed] mb-2">Total Billed</div>
            <div className="text-2xl font-bold text-white">{formatCurrency(totalRevenue)}</div>
            <p className="text-[10px] text-zinc-500 mt-2">
              Total revenue for selected filters
            </p>
            <div className="absolute right-0 bottom-0 w-24 h-24 bg-[#7c3aed]/5 rounded-full blur-3xl" />
          </div>

          <div className="bg-[#111113] border border-[#1d1d22] rounded-2xl p-6">
            <div className="text-xs font-semibold text-zinc-400 mb-2">Avg Cost Per Call</div>
            <div className="text-2xl font-bold text-white">{formatCurrency(avgRevenuePerCall)}</div>
            <p className="text-[10px] text-zinc-500 mt-2">
              Revenue / call count
            </p>
          </div>
        </div>
      )}

      {/* Breakdown Table */}
      <div className="bg-[#111113] border border-[#1d1d22] rounded-2xl p-6">
        <div className="flex justify-between items-center mb-6">
          <span className="text-sm font-semibold text-zinc-200">Per-Agent Breakdown</span>
          <span className="text-[10px] text-zinc-500">Revenue and usage separated by voice agent</span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs border-collapse">
            <thead>
              <tr className="border-b border-[#1d1d22] text-zinc-500 font-medium">
                <th className="pb-3 font-medium">Agent Name</th>
                <th className="pb-3 text-right font-medium">Calls</th>
                <th className="pb-3 text-right font-medium">Total Minutes</th>
                <th className="pb-3 text-right font-medium">Billable Units</th>
                <th className="pb-3 text-right font-medium text-white">Billed Amount</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#1d1d22]/50">
              {breakdownArray.length > 0 ? (
                <>
                  {breakdownArray.map(b => (
                    <tr key={b.name} className="group hover:bg-white/1 transition-colors">
                      <td className="py-3.5 text-zinc-300">
                        <div className="flex items-center gap-2">
                          <span className="font-semibold text-zinc-200">{b.name}</span>
                          <span className="bg-[#1c1c1f] text-zinc-400 border border-zinc-700/50 text-[9px] font-bold px-1.5 py-0.5 rounded uppercase">
                            {tier}
                          </span>
                        </div>
                      </td>
                      <td className="py-3.5 text-right text-zinc-300">{b.calls.toLocaleString()}</td>
                      <td className="py-3.5 text-right text-zinc-300">{b.minutes.toFixed(1)}</td>
                      <td className="py-3.5 text-right text-zinc-300">{b.billableUnits.toLocaleString()}</td>
                      <td className="py-3.5 text-right font-bold text-white">{formatCurrency(b.revenue)}</td>
                    </tr>
                  ))}
                  <tr className="bg-[#08080a] font-bold">
                    <td className="py-4 text-zinc-200">Totals</td>
                    <td className="py-4 text-right text-zinc-200">{filteredRuns.length.toLocaleString()}</td>
                    <td className="py-4 text-right text-zinc-200">{totalMinutes.toFixed(1)}</td>
                    <td className="py-4 text-right text-zinc-200">{totalBillableUnits.toLocaleString()}</td>
                    <td className="py-4 text-right text-[#7c3aed]">{formatCurrency(totalRevenue)}</td>
                  </tr>
                </>
              ) : (
                <tr>
                  <td colSpan={5} className="h-24 text-center text-zinc-500">
                    {isFetchingAll ? 'Loading breakdown...' : 'No calls recorded for this period'}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Call Log */}
      <div className="bg-[#111113] border border-[#1d1d22] rounded-2xl p-6">
        <div className="flex justify-between items-center mb-6">
          <span className="text-sm font-semibold text-zinc-200">Call Log</span>
          <span className="text-[10px] text-zinc-500">Individual call records for the selected period</span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs border-collapse">
            <thead>
              <tr className="border-b border-[#1d1d22] text-zinc-500 font-medium">
                <th className="pb-3 font-medium">Date & Time</th>
                <th className="pb-3 font-medium">Agent</th>
                <th className="pb-3 font-medium">Caller</th>
                <th className="pb-3 font-medium">Call Type</th>
                <th className="pb-3 text-right font-medium">Duration</th>
                <th className="pb-3 text-right font-medium">Units</th>
                <th className="pb-3 text-right font-medium">Rate Used</th>
                <th className="pb-3 text-right font-medium text-white">Billed</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#1d1d22]/50">
              {isLoadingRuns ? (
                <tr>
                  <td colSpan={8} className="h-24 text-center text-zinc-500 animate-pulse">Loading calls...</td>
                </tr>
              ) : paginatedRuns.length > 0 ? (
                paginatedRuns.map(run => {
                  const units = getRunBillableUnits(run.call_duration_seconds);
                  const charge = calculateRunCharge(run.call_duration_seconds);
                  return (
                    <tr key={run.id} className="group hover:bg-white/1 transition-colors">
                      <td className="py-3.5 text-zinc-300 whitespace-nowrap">{formatDate(run.created_at)}</td>
                      <td className="py-3.5 text-zinc-300 max-w-[150px] truncate" title={run.workflow_name || ''}>
                        {run.workflow_name || 'Unknown'}
                      </td>
                      <td className="py-3.5 text-zinc-300 font-mono">
                        {run.caller_number || run.called_number || '-'}
                      </td>
                      <td className="py-3.5 text-zinc-300 capitalize">{run.call_type || '-'}</td>
                      <td className="py-3.5 text-right text-zinc-300 whitespace-nowrap">{formatDuration(run.call_duration_seconds)}</td>
                      <td className="py-3.5 text-right text-zinc-300 whitespace-nowrap">
                        {units} {getPulseUnitShortLabel()}
                      </td>
                      <td className="py-3.5 text-right text-zinc-500 whitespace-nowrap">
                        {formatCurrency(currentRate)}/{getPulseUnitShortLabel()}
                      </td>
                      <td className="py-3.5 text-right font-semibold text-zinc-200">{formatCurrency(charge)}</td>
                    </tr>
                  );
                })
              ) : (
                <tr>
                  <td colSpan={8} className="h-32 text-center">
                    <div className="flex flex-col items-center justify-center text-zinc-500">
                      <IndianRupee className="h-8 w-8 mb-2 opacity-20" />
                      <p className="text-xs">No calls recorded for this period</p>
                    </div>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="flex items-center justify-between mt-6 pt-4 border-t border-[#1d1d22]/50">
            <p className="text-[10px] text-zinc-500">
              Page {currentPage} of {totalPages} ({filteredRuns.length} total calls)
            </p>
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                disabled={currentPage === 1}
                className="bg-[#121214] border border-[#232328] hover:bg-[#1a1a1f] px-3 py-1.5 rounded-xl text-xs text-zinc-300 transition-colors"
              >
                <ChevronLeft className="h-4 w-4 mr-1" /> Previous
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
                disabled={currentPage === totalPages}
                className="bg-[#121214] border border-[#232328] hover:bg-[#1a1a1f] px-3 py-1.5 rounded-xl text-xs text-zinc-300 transition-colors"
              >
                Next <ChevronRight className="h-4 w-4 ml-1" />
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
