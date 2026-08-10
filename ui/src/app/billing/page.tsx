"use client";

import { ChevronDown, ChevronLeft, ChevronRight, IndianRupee } from 'lucide-react';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';

import { client } from '@/client/client.gen';
import {
  getUsageHistoryApiV1OrganizationsUsageRunsGet,
  getWorkflowsSummaryApiV1WorkflowSummaryGet
} from '@/client/sdk.gen';
import type { WorkflowRunUsageResponse, WorkflowSummaryResponse } from '@/client/types.gen';
import { DropdownMenu, DropdownMenuCheckboxItem, DropdownMenuContent, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Skeleton } from '@/components/ui/skeleton';
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

  const [currentDate, setCurrentDate] = useState(new Date());
  const [billingMode, setBillingMode] = useState<BillingMode>('per_minute');
  const [isModeLoaded, setIsModeLoaded] = useState(false);

  const [wallet, setWallet] = useState<any | null>(null);

  const [billingConfig, setBillingConfig] = useState<BillingConfiguration>({
    tiers: DEFAULT_TIER_THRESHOLDS,
    prices: DEFAULT_PRICES
  });

  const [workflows, setWorkflows] = useState<WorkflowSummaryResponse[]>([]);
  const [selectedAgentIds, setSelectedAgentIds] = useState<string[]>([]);

  const [isLoadingRuns, setIsLoadingRuns] = useState(true);
  const [currentPage, setCurrentPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);

  useEffect(() => {
    if (auth.isAuthenticated && auth.user) {
      const orgId = (auth.user as any)?.orgId || 'default';
      const stored = localStorage.getItem(`billing_config_${orgId}`);
      if (stored === 'per_minute' || stored === 'per_30s') {
        setBillingMode(stored);
      }
      setIsModeLoaded(true);
    }
  }, [auth.isAuthenticated, auth.user]);

  const handleBillingModeChange = (val: string) => {
    const newMode = val as BillingMode;
    setBillingMode(newMode);
    if (auth.user) {
      const orgId = (auth.user as any)?.orgId || 'default';
      localStorage.setItem(`billing_config_${orgId}`, newMode);
    }
  };

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

  useEffect(() => {
    async function fetchWallet() {
      if (!auth.isAuthenticated) return;
      try {
        const year = currentDate.getFullYear();
        const month = currentDate.getMonth() + 1;
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
      const start = new Date(Date.UTC(year, month, 1, 0, 0, 0)).toISOString();
      const end = new Date(Date.UTC(year, month + 1, 0, 23, 59, 59, 999)).toISOString();

      let allFetchedRuns: WorkflowRunUsageResponse[] = [];
      let page = 1;
      let morePages = true;

      try {
        while (morePages && !isCancelled) {
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

  const unsortedFilteredRuns = selectedAgentIds.length === 0
    ? allMonthRuns
    : allMonthRuns.filter(r => selectedAgentIds.includes(r.workflow_id?.toString() || 'unknown'));

  const filteredRuns = [...unsortedFilteredRuns].sort((a, b) =>
    new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
  );

  const ITEMS_PER_PAGE = 25;
  useEffect(() => {
    setTotalPages(Math.max(1, Math.ceil(filteredRuns.length / ITEMS_PER_PAGE)));
    setCurrentPage(1);
  }, [filteredRuns.length]);

  const paginatedRuns = filteredRuns.slice(
    (currentPage - 1) * ITEMS_PER_PAGE,
    currentPage * ITEMS_PER_PAGE
  );

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
      const rate = wallet.billing_rate;
      const pulses = Math.ceil(durationSeconds / pulse);
      return pulses * ((rate / 60) * pulse);
    }
    return calculateCallCharge(durationSeconds, tier, billingMode, billingConfig.prices);
  };

  const orgTotalCalls = allMonthRuns.length;
  const tier = getTier(orgTotalCalls, billingConfig.tiers);
  const nextTier = getNextTier(orgTotalCalls, billingConfig.tiers);
  const currentRate = wallet && wallet.billing_rate > 0
    ? (wallet.billing_rate / 60) * (wallet.billing_pulse || 60)
    : getPricePerUnit(tier, billingMode, billingConfig.prices);

  const totalMinutes = filteredRuns.reduce((acc, run) => acc + (run.call_duration_seconds / 60), 0);
  const totalBillableUnits = filteredRuns.reduce((acc, run) => acc + getRunBillableUnits(run.call_duration_seconds), 0);
  const totalRevenue = filteredRuns.reduce((acc, run) => acc + calculateRunCharge(run.call_duration_seconds), 0);
  const avgRevenuePerCall = filteredRuns.length > 0 ? totalRevenue / filteredRuns.length : 0;

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
    <div className="flex flex-col h-full text-gray-900 dark:text-white font-sans select-none relative" style={{ backgroundColor: '#161715' }}>
      {/* Top Page Header matching demo styling */}
      <header className="px-8 pt-6 pb-3 flex items-center justify-between sticky top-0 z-20 border-b border-gray-100 dark:border-[#282b26]" style={{ backgroundColor: '#161715' }}>
        <div className="space-y-0.5">
          <div className="flex items-center gap-2">
            <IndianRupee className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
            <h1 className="text-base font-semibold text-gray-900 dark:text-white tracking-tight">
              Billing & Usage
            </h1>
          </div>
          <p className="text-xs text-gray-500 dark:text-gray-400">
            Manage client billing and pricing tiers.
          </p>
        </div>

        {/* Top Right Filters */}
        <div className="flex items-center gap-3">
          {/* Month Selector */}
          <div className="flex items-center gap-1 border border-gray-200 dark:border-[#282b26] rounded-full px-2.5 py-1" style={{ backgroundColor: '#161715' }}>
            <button
              onClick={goToPrevMonth}
              disabled={isFetchingAll}
              className="p-1 text-gray-500 hover:text-black dark:hover:text-white cursor-pointer disabled:opacity-40"
            >
              <ChevronLeft className="w-3.5 h-3.5" />
            </button>
            <span className="text-xs font-semibold text-gray-800 dark:text-gray-200 px-1 min-w-[90px] text-center">
              {monthYearString}
            </span>
            <button
              onClick={goToNextMonth}
              disabled={isCurrentMonth() || isFetchingAll}
              className="p-1 text-gray-500 hover:text-black dark:hover:text-white cursor-pointer disabled:opacity-40"
            >
              <ChevronRight className="w-3.5 h-3.5" />
            </button>
          </div>

          {/* Agent Filter */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                className="px-3.5 py-1.5 border border-gray-200 dark:border-[#282b26] rounded-full text-xs font-semibold text-gray-800 dark:text-gray-200 flex items-center gap-2 cursor-pointer focus:outline-hidden"
                style={{ backgroundColor: '#161715' }}
              >
                <span>
                  {selectedAgentIds.length === 0
                    ? "All Agents"
                    : `${selectedAgentIds.length} Agent${selectedAgentIds.length > 1 ? 's' : ''}`}
                </span>
                <ChevronDown className="w-3.5 h-3.5 text-gray-400" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent className="border border-gray-200 dark:border-[#282b26] text-gray-800 dark:text-gray-200 rounded-xl" style={{ backgroundColor: '#1C1E1A' }} align="end">
              <DropdownMenuCheckboxItem
                checked={selectedAgentIds.length === 0}
                onCheckedChange={() => setSelectedAgentIds([])}
                className="hover:bg-gray-100 dark:hover:bg-[#161715] focus:bg-gray-100 dark:focus:bg-[#161715] text-xs cursor-pointer"
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
                    className="hover:bg-gray-100 dark:hover:bg-[#161715] focus:bg-gray-100 dark:focus:bg-[#161715] text-xs cursor-pointer"
                  >
                    {wf.name}
                  </DropdownMenuCheckboxItem>
                );
              })}
            </DropdownMenuContent>
          </DropdownMenu>

          {/* Rate Mode */}
          <div className="relative">
            <select
              value={wallet && wallet.billing_rate > 0 ? "custom" : billingMode}
              onChange={(e) => handleBillingModeChange(e.target.value)}
              disabled={!!(wallet && wallet.billing_rate > 0)}
              className="px-3.5 py-1.5 border border-gray-200 dark:border-[#282b26] rounded-full text-xs font-semibold text-gray-800 dark:text-gray-200 appearance-none pr-8 cursor-pointer focus:outline-hidden"
              style={{ backgroundColor: '#161715' }}
            >
              {wallet && wallet.billing_rate > 0 ? (
                <option value="custom">Custom ({getPulseUnitShortLabel()})</option>
              ) : (
                <>
                  <option value="per_minute">Per Minute</option>
                  <option value="per_30s">Per 30s Pulse</option>
                </>
              )}
            </select>
            <ChevronDown className="w-3.5 h-3.5 text-gray-400 absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none" />
          </div>
        </div>
      </header>

      {/* Main Workspace Container */}
      <div className="max-w-6xl w-full mx-auto px-8 pt-6 pb-16 flex flex-col gap-6">
        {/* Tier Progress Banner Card */}
        <div
          className="border border-gray-200/90 dark:border-[#282b26] rounded-2xl p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3 shadow-2xs"
          style={{ backgroundColor: '#1C1E1A' }}
        >
          <div className="flex items-center gap-3 flex-wrap">
            <span className="px-2.5 py-0.5 bg-purple-600 text-white font-bold text-[11px] rounded-full">
              {tier}
            </span>
            <span className="text-xs font-bold text-gray-900 dark:text-white">
              {orgTotalCalls.toLocaleString()} calls this month
            </span>
            <span className="text-gray-300 dark:text-gray-600">|</span>
            <span className="text-xs font-semibold text-purple-700 dark:text-purple-400">
              Rate: {formatCurrency(currentRate)}/{getPulseUnitLabel()}
            </span>
          </div>

          <span className="text-xs text-gray-500 dark:text-gray-400 font-medium">
            {nextTier && !(wallet && wallet.billing_rate > 0)
              ? `${Math.max(0, nextTier.maxCalls - orgTotalCalls + 1).toLocaleString()} more calls to reach ${nextTier.label} (${formatCurrency(getPricePerUnit(nextTier.label, billingMode))}/${billingMode === 'per_minute' ? 'min' : '30s'})`
              : 'Custom Pricing Active'}
          </span>
        </div>

        {/* Metric Cards (Row 1) */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {/* Card 1 */}
          <div
            className="border border-gray-200/90 dark:border-[#282b26] rounded-2xl p-5 shadow-2xs space-y-1"
            style={{ backgroundColor: '#1C1E1A' }}
          >
            <span className="text-[11px] font-bold text-gray-400 dark:text-gray-500 uppercase tracking-wide">
              Accumulated Minutes
            </span>
            <div className="text-2xl font-bold text-gray-900 dark:text-white">
              {totalMinutes.toFixed(1)}
            </div>
            <p className="text-[11px] text-gray-400 dark:text-gray-500">Raw sum of durations</p>
          </div>

          {/* Card 2 */}
          <div
            className="border border-gray-200/90 dark:border-[#282b26] rounded-2xl p-5 shadow-2xs space-y-1"
            style={{ backgroundColor: '#1C1E1A' }}
          >
            <span className="text-[11px] font-bold text-gray-400 dark:text-gray-500 uppercase tracking-wide">
              Billable Units
            </span>
            <div className="text-2xl font-bold text-gray-900 dark:text-white">
              {totalBillableUnits.toLocaleString()}
            </div>
            <p className="text-[11px] text-gray-400 dark:text-gray-500">
              {wallet && wallet.billing_rate > 0
                ? `Total billable ${getPulseUnitShortLabel()} units`
                : (billingMode === 'per_minute' ? 'Total billable minutes' : 'Total 30s pulses')}
            </p>
          </div>

          {/* Card 3 */}
          <div
            className="border border-gray-200/90 dark:border-[#282b26] rounded-2xl p-5 shadow-2xs space-y-1"
            style={{ backgroundColor: '#1C1E1A' }}
          >
            <span className="text-[11px] font-bold text-purple-700 dark:text-purple-400 uppercase tracking-wide">
              Total Billed
            </span>
            <div className="text-2xl font-bold text-gray-900 dark:text-white">
              {formatCurrency(totalRevenue)}
            </div>
            <p className="text-[11px] text-gray-400 dark:text-gray-500">Total revenue for selected filters</p>
          </div>

          {/* Card 4 */}
          <div
            className="border border-gray-200/90 dark:border-[#282b26] rounded-2xl p-5 shadow-2xs space-y-1"
            style={{ backgroundColor: '#1C1E1A' }}
          >
            <span className="text-[11px] font-bold text-gray-400 dark:text-gray-500 uppercase tracking-wide">
              Avg Cost Per Call
            </span>
            <div className="text-2xl font-bold text-gray-900 dark:text-white">
              {formatCurrency(avgRevenuePerCall)}
            </div>
            <p className="text-[11px] text-gray-400 dark:text-gray-500">Revenue / call count</p>
          </div>
        </div>

        {/* Per-Agent Breakdown Table Card */}
        <div
          className="border border-gray-200/90 dark:border-[#282b26] rounded-2xl p-6 shadow-2xs space-y-5"
          style={{ backgroundColor: '#1C1E1A' }}
        >
          <div className="flex items-center justify-between">
            <div className="space-y-0.5">
              <h2 className="text-xl font-normal text-gray-900 dark:text-white font-serif tracking-tight">
                Per-Agent Breakdown
              </h2>
              <p className="text-xs text-gray-400 dark:text-gray-500">
                Revenue and usage separated by voice agent
              </p>
            </div>
          </div>

          {/* Table */}
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="border-b border-gray-100 dark:border-[#282b26] text-gray-400 dark:text-gray-500 font-semibold uppercase tracking-wider text-[10.5px]">
                  <th className="pb-3 px-2">Agent Name</th>
                  <th className="pb-3 px-2 text-right">Calls</th>
                  <th className="pb-3 px-2 text-right">Total Minutes</th>
                  <th className="pb-3 px-2 text-right">Billable Units</th>
                  <th className="pb-3 px-2 text-right">Billed Amount</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 dark:divide-[#282b26]">
                {breakdownArray.length > 0 ? (
                  breakdownArray.map((item, idx) => (
                    <tr key={idx} className="hover:bg-gray-50/70 dark:hover:bg-[#161715]/70 transition-colors">
                      <td className="py-3.5 px-2">
                        <div className="flex items-center gap-2">
                          <span className="font-bold text-gray-900 dark:text-white">
                            {item.name}
                          </span>
                          <span className="px-1.5 py-0.5 bg-gray-100 dark:bg-[#161715] text-gray-600 dark:text-gray-400 font-mono text-[9.5px] font-bold rounded">
                            {tier}
                          </span>
                        </div>
                      </td>

                      <td className="py-3.5 px-2 text-right font-medium text-gray-700 dark:text-gray-300">
                        {item.calls.toLocaleString()}
                      </td>

                      <td className="py-3.5 px-2 text-right font-medium text-gray-700 dark:text-gray-300">
                        {item.minutes.toFixed(1)}
                      </td>

                      <td className="py-3.5 px-2 text-right font-medium text-gray-700 dark:text-gray-300">
                        {item.billableUnits.toLocaleString()}
                      </td>

                      <td className="py-3.5 px-2 text-right font-bold font-mono text-gray-900 dark:text-white">
                        {formatCurrency(item.revenue)}
                      </td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan={5} className="py-8 text-center text-gray-400 dark:text-gray-500">
                      {isFetchingAll ? 'Loading breakdown...' : 'No calls recorded for this period'}
                    </td>
                  </tr>
                )}
              </tbody>
              <tfoot>
                <tr className="border-t-2 border-gray-200 dark:border-[#282b26] text-gray-900 dark:text-white font-bold bg-gray-50/60 dark:bg-[#161715]/60">
                  <td className="py-3.5 px-2 font-serif text-sm">Totals</td>
                  <td className="py-3.5 px-2 text-right">{filteredRuns.length.toLocaleString()}</td>
                  <td className="py-3.5 px-2 text-right">{totalMinutes.toFixed(1)}</td>
                  <td className="py-3.5 px-2 text-right">{totalBillableUnits.toLocaleString()}</td>
                  <td className="py-3.5 px-2 text-right font-mono text-purple-700 dark:text-purple-400 text-sm">
                    {formatCurrency(totalRevenue)}
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
        </div>

        {/* Call Log Card */}
        <div
          className="border border-gray-200/90 dark:border-[#282b26] rounded-2xl p-6 shadow-2xs space-y-5"
          style={{ backgroundColor: '#1C1E1A' }}
        >
          <div className="flex items-center justify-between">
            <div className="space-y-0.5">
              <h2 className="text-xl font-normal text-gray-900 dark:text-white font-serif tracking-tight">
                Call Log
              </h2>
              <p className="text-xs text-gray-400 dark:text-gray-500">
                Individual call records for the selected period
              </p>
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="border-b border-gray-100 dark:border-[#282b26] text-gray-400 dark:text-gray-500 font-semibold uppercase tracking-wider text-[10.5px]">
                  <th className="pb-3 px-2">DATE & TIME</th>
                  <th className="pb-3 px-2">AGENT</th>
                  <th className="pb-3 px-2">CALLER</th>
                  <th className="pb-3 px-2">CALL TYPE</th>
                  <th className="pb-3 px-2 text-right">DURATION</th>
                  <th className="pb-3 px-2 text-right">UNITS</th>
                  <th className="pb-3 px-2 text-right">RATE USED</th>
                  <th className="pb-3 px-2 text-right">BILLED</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 dark:divide-[#282b26]">
                {isLoadingRuns ? (
                  <tr>
                    <td colSpan={8} className="py-8 text-center text-gray-400 dark:text-gray-500 animate-pulse">Loading calls...</td>
                  </tr>
                ) : paginatedRuns.length > 0 ? (
                  paginatedRuns.map((run) => {
                    const units = getRunBillableUnits(run.call_duration_seconds);
                    const charge = calculateRunCharge(run.call_duration_seconds);
                    return (
                      <tr key={run.id} className="hover:bg-gray-50/70 dark:hover:bg-[#161715]/70 transition-colors">
                        <td className="py-3.5 px-2 font-medium text-gray-700 dark:text-gray-300 whitespace-nowrap">
                          {formatDate(run.created_at)}
                        </td>
                        <td className="py-3.5 px-2 font-bold text-gray-900 dark:text-white max-w-[160px] truncate" title={run.workflow_name || ''}>
                          {run.workflow_name || 'Unknown'}
                        </td>
                        <td className="py-3.5 px-2 font-mono text-gray-700 dark:text-gray-300">
                          {run.caller_number || run.called_number || '-'}
                        </td>
                        <td className="py-3.5 px-2 text-gray-700 dark:text-gray-300 capitalize">
                          {run.call_type || '-'}
                        </td>
                        <td className="py-3.5 px-2 text-right font-mono font-semibold text-gray-800 dark:text-gray-200 whitespace-nowrap">
                          {formatDuration(run.call_duration_seconds)}
                        </td>
                        <td className="py-3.5 px-2 text-right font-mono text-gray-700 dark:text-gray-300 whitespace-nowrap">
                          {units} {getPulseUnitShortLabel()}
                        </td>
                        <td className="py-3.5 px-2 text-right text-gray-400 dark:text-gray-500 whitespace-nowrap">
                          {formatCurrency(currentRate)}/{getPulseUnitShortLabel()}
                        </td>
                        <td className="py-3.5 px-2 text-right font-bold font-mono text-gray-900 dark:text-white whitespace-nowrap">
                          {formatCurrency(charge)}
                        </td>
                      </tr>
                    );
                  })
                ) : (
                  <tr>
                    <td colSpan={8} className="py-12 text-center text-gray-400 dark:text-gray-500">
                      No calls recorded for this period
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="flex items-center justify-between mt-4 pt-4 border-t border-gray-100 dark:border-[#282b26]">
              <p className="text-xs text-gray-400 dark:text-gray-500">
                Page {currentPage} of {totalPages} ({filteredRuns.length} total calls)
              </p>
              <div className="flex gap-2">
                <button
                  onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                  disabled={currentPage === 1}
                  className="px-3 py-1.5 bg-gray-100 dark:bg-[#161715] hover:bg-gray-200 dark:hover:bg-[#232621] disabled:opacity-40 text-gray-700 dark:text-gray-300 text-xs font-semibold rounded-xl transition-all cursor-pointer flex items-center gap-1"
                >
                  <ChevronLeft className="h-3.5 w-3.5" />
                  <span>Previous</span>
                </button>
                <button
                  onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
                  disabled={currentPage === totalPages}
                  className="px-3 py-1.5 bg-gray-100 dark:bg-[#161715] hover:bg-gray-200 dark:hover:bg-[#232621] disabled:opacity-40 text-gray-700 dark:text-gray-300 text-xs font-semibold rounded-xl transition-all cursor-pointer flex items-center gap-1"
                >
                  <span>Next</span>
                  <ChevronRight className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
