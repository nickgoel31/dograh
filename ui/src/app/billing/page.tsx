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
    <div className="container mx-auto p-6 space-y-6">
      {/* Header & Settings Bar */}
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <div>
          <h1 className="text-3xl font-bold mb-2 flex items-center gap-2">
            <IndianRupee className="h-8 w-8" />
            Billing & Usage
          </h1>
          <p className="text-muted-foreground">Manage client billing and pricing tiers.</p>
        </div>

        <div className="flex flex-wrap items-center gap-3 bg-muted/30 p-2 rounded-lg border">
          {/* Month Navigator */}
          <div className="flex items-center gap-2 px-2 border-r pr-4">
            <Button variant="ghost" size="icon" onClick={goToPrevMonth} disabled={isFetchingAll}>
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <span className="font-medium min-w-[120px] text-center">{monthYearString}</span>
            <Button variant="ghost" size="icon" onClick={goToNextMonth} disabled={isCurrentMonth() || isFetchingAll}>
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>

          {/* Agent Filter (Multi-Select) */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" className="w-[200px] justify-between font-normal h-9">
                {selectedAgentIds.length === 0
                  ? "All Agents"
                  : `${selectedAgentIds.length} Agent${selectedAgentIds.length > 1 ? 's' : ''} Selected`}
                <span className="opacity-50 text-xs">▼</span>
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent className="w-[200px]" align="end">
              <DropdownMenuCheckboxItem
                checked={selectedAgentIds.length === 0}
                onCheckedChange={() => setSelectedAgentIds([])}
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
                  >
                    {wf.name}
                  </DropdownMenuCheckboxItem>
                );
              })}
            </DropdownMenuContent>
          </DropdownMenu>

          {/* Clear filter button */}
          {selectedAgentIds.length > 0 && (
            <Button variant="ghost" size="sm" onClick={() => setSelectedAgentIds([])} className="h-9">
              Clear
            </Button>
          )}

          {/* Billing Mode Toggle */}
          <div className="border-l pl-4 flex items-center">
            <Select
              value={wallet && wallet.billing_rate > 0 ? "custom" : billingMode}
              onValueChange={handleBillingModeChange}
              disabled={wallet && wallet.billing_rate > 0}
            >
              <SelectTrigger className="w-[160px] h-9">
                <SelectValue placeholder="Billing Mode" />
              </SelectTrigger>
              <SelectContent>
                {wallet && wallet.billing_rate > 0 ? (
                  <SelectItem value="custom">Custom ({getPulseUnitShortLabel()})</SelectItem>
                ) : (
                  <>
                    <SelectItem value="per_minute">Per Minute</SelectItem>
                    <SelectItem value="per_30s">Per 30s Pulse</SelectItem>
                  </>
                )}
              </SelectContent>
            </Select>
          </div>
        </div>
      </div>

      {/* Tier Badge */}
      <Card className="bg-primary/5 border-primary/20">
        <CardContent className="py-4 flex flex-col sm:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <Badge variant="default" className="text-sm px-3 py-1">📊 {tier}</Badge>
            <span className="font-medium">
              {orgTotalCalls.toLocaleString()} calls this month
            </span>
            <span className="text-muted-foreground hidden sm:inline">|</span>
            <span className="font-medium text-primary">
              Rate: {formatCurrency(currentRate)}/{getPulseUnitLabel()}
            </span>
          </div>
          {nextTier && !(wallet && wallet.billing_rate > 0) && (
            <div className="text-sm text-muted-foreground flex items-center">
              {Math.max(0, nextTier.maxCalls - orgTotalCalls + 1).toLocaleString()} more calls to reach {nextTier.label} ({formatCurrency(getPricePerUnit(nextTier.label, billingMode))}/{billingMode === 'per_minute' ? 'min' : '30s'})
            </div>
          )}
          {wallet && wallet.billing_rate > 0 && (
            <div className="text-sm text-muted-foreground flex items-center">
              Custom Organization Pricing Active
            </div>
          )}
          {selectedAgentIds.length > 0 && (
            <div className="text-xs text-amber-600 bg-amber-50 px-2 py-1 rounded border border-amber-200">
              Tier is based on org-wide total
            </div>
          )}
        </CardContent>
      </Card>

      {/* Summary Cards */}
      {wallet && wallet.monthly_minutes_limit > 0 ? (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
          <Card className="border-emerald-500/20 bg-emerald-500/5 dark:border-emerald-500/30 dark:bg-emerald-500/10">
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-semibold text-emerald-600 dark:text-emerald-400">Rupees Remaining</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-extrabold text-emerald-600 dark:text-emerald-400">
                ₹{(wallet.balance ?? 0).toFixed(2)}
              </div>
              <p className="text-xs text-muted-foreground pt-1">
                Value of unused remaining minutes
              </p>
            </CardContent>
          </Card>

          <Card className="border-border/60 bg-card/50 backdrop-blur-md">
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-semibold text-foreground">Minutes Remaining</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-extrabold text-foreground">
                {(wallet.minutes_remaining ?? 0).toFixed(1)} min
              </div>
              <p className="text-xs text-muted-foreground pt-1">
                Out of {((wallet.monthly_minutes_limit ?? 0) + (wallet.carry_forward_minutes ?? 0)).toFixed(0)} min total allowance
              </p>
            </CardContent>
          </Card>

          <Card className="border-border/60 bg-card/50 backdrop-blur-md">
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-semibold text-foreground">Minutes Used</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-bold text-foreground">
                {(wallet.minutes_used ?? 0).toFixed(1)} min
              </div>
              <p className="text-xs text-muted-foreground pt-1">
                This cycle's total usage
              </p>
            </CardContent>
          </Card>

          <Card className="border-border/60 bg-card/50 backdrop-blur-md">
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-semibold text-foreground">Carry Forward</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-bold text-foreground">
                {(wallet.carry_forward_minutes ?? 0).toFixed(1)} min
              </div>
              <p className="text-xs text-muted-foreground pt-1">
                From previous cycle (2-month limit)
              </p>
            </CardContent>
          </Card>
        </div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Accumulated Minutes</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{totalMinutes.toFixed(1)}</div>
              <p className="text-xs text-muted-foreground pt-1">
                Raw sum of durations
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Billable Units</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{totalBillableUnits.toLocaleString()}</div>
              <p className="text-xs text-muted-foreground pt-1">
                {wallet && wallet.billing_rate > 0
                  ? `Total billable ${getPulseUnitShortLabel()} units`
                  : (billingMode === 'per_minute' ? 'Total billable minutes' : 'Total 30s pulses')}
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Total Billed</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{formatCurrency(totalRevenue)}</div>
              <p className="text-xs text-muted-foreground pt-1">
                Total revenue for selected filters
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Avg Cost Per Call</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{formatCurrency(avgRevenuePerCall)}</div>
              <p className="text-xs text-muted-foreground pt-1">
                Revenue / call count
              </p>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Breakdown Table */}
      <Card>
        <CardHeader>
          <CardTitle>Per-Agent Breakdown</CardTitle>
          <CardDescription>Revenue and usage separated by voice agent</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="border rounded-md">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Agent Name</TableHead>
                  <TableHead className="text-right">Calls</TableHead>
                  <TableHead className="text-right">Total Minutes</TableHead>
                  <TableHead className="text-right">Billable Units</TableHead>
                  <TableHead className="text-right">Avg/Call</TableHead>
                  <TableHead className="text-right font-bold">Billed Amount</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {breakdownArray.length > 0 ? (
                  <>
                    {breakdownArray.map(b => (
                      <TableRow key={b.name}>
                        <TableCell className="font-medium">
                          <div className="flex items-center gap-2">
                            {b.name}
                            <Badge variant="outline" className="text-[10px] h-5">{tier}</Badge>
                          </div>
                        </TableCell>
                        <TableCell className="text-right">{b.calls.toLocaleString()}</TableCell>
                        <TableCell className="text-right">{b.minutes.toFixed(1)}</TableCell>
                        <TableCell className="text-right">{b.billableUnits.toLocaleString()}</TableCell>
                        <TableCell className="text-right">{formatCurrency(b.revenue / b.calls)}</TableCell>
                        <TableCell className="text-right font-bold">{formatCurrency(b.revenue)}</TableCell>
                      </TableRow>
                    ))}
                    <TableRow className="bg-muted/50 font-bold">
                      <TableCell>Totals</TableCell>
                      <TableCell className="text-right">{filteredRuns.length.toLocaleString()}</TableCell>
                      <TableCell className="text-right">{totalMinutes.toFixed(1)}</TableCell>
                      <TableCell className="text-right">{totalBillableUnits.toLocaleString()}</TableCell>
                      <TableCell className="text-right">{formatCurrency(avgRevenuePerCall)}</TableCell>
                      <TableCell className="text-right">{formatCurrency(totalRevenue)}</TableCell>
                    </TableRow>
                  </>
                ) : (
                  <TableRow>
                    <TableCell colSpan={6} className="h-24 text-center">
                      {isFetchingAll ? 'Loading breakdown...' : 'No calls recorded for this period'}
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      {/* Call Log */}
      <Card>
        <CardHeader>
          <CardTitle>Call Log</CardTitle>
          <CardDescription>Individual call records for the selected period</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="border rounded-md">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Date & Time</TableHead>
                  <TableHead>Agent</TableHead>
                  <TableHead>Caller</TableHead>
                  <TableHead>Call Type</TableHead>
                  <TableHead className="text-right">Duration</TableHead>
                  <TableHead className="text-right">Units</TableHead>
                  <TableHead className="text-right">Rate Used</TableHead>
                  <TableHead className="text-right font-bold">Billed</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoadingRuns ? (
                  <TableRow>
                    <TableCell colSpan={8} className="h-24 text-center animate-pulse">Loading calls...</TableCell>
                  </TableRow>
                ) : paginatedRuns.length > 0 ? (
                  paginatedRuns.map(run => {
                    const units = getRunBillableUnits(run.call_duration_seconds);
                    const charge = calculateRunCharge(run.call_duration_seconds);
                    return (
                      <TableRow key={run.id}>
                        <TableCell className="text-sm whitespace-nowrap">{formatDate(run.created_at)}</TableCell>
                        <TableCell className="max-w-[150px] truncate" title={run.workflow_name || ''}>
                          {run.workflow_name || 'Unknown'}
                        </TableCell>
                        <TableCell className="text-sm font-mono">
                          {run.caller_number || run.called_number || '-'}
                        </TableCell>
                        <TableCell className="capitalize text-sm">{run.call_type || '-'}</TableCell>
                        <TableCell className="text-right whitespace-nowrap">{formatDuration(run.call_duration_seconds)}</TableCell>
                        <TableCell className="text-right text-sm">
                          {units} {getPulseUnitShortLabel()}
                        </TableCell>
                        <TableCell className="text-right text-sm text-muted-foreground whitespace-nowrap">
                          {formatCurrency(currentRate)}/{getPulseUnitShortLabel()}
                        </TableCell>
                        <TableCell className="text-right font-medium">{formatCurrency(charge)}</TableCell>
                      </TableRow>
                    );
                  })
                ) : (
                  <TableRow>
                    <TableCell colSpan={8} className="h-32 text-center">
                      <div className="flex flex-col items-center justify-center text-muted-foreground">
                        <IndianRupee className="h-8 w-8 mb-2 opacity-20" />
                        <p>No calls recorded for this period</p>
                      </div>
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="flex items-center justify-between mt-4">
              <p className="text-sm text-muted-foreground">
                Page {currentPage} of {totalPages} ({filteredRuns.length} total calls)
              </p>
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                  disabled={currentPage === 1}
                >
                  <ChevronLeft className="h-4 w-4" /> Previous
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
                  disabled={currentPage === totalPages}
                >
                  Next <ChevronRight className="h-4 w-4" />
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
