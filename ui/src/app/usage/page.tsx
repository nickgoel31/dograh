"use client";

import { ChevronLeft, ChevronRight, Database, Download, Globe } from 'lucide-react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useId, useState } from 'react';
import TimezoneSelect, { type ITimezoneOption } from 'react-timezone-select';
import { toast } from 'sonner';

import { downloadUsageRunsReportApiV1OrganizationsUsageRunsReportGet, getDailyUsageBreakdownApiV1OrganizationsUsageDailyBreakdownGet, getMpsCreditsApiV1OrganizationsUsageMpsCreditsGet, getUsageHistoryApiV1OrganizationsUsageRunsGet } from '@/client/sdk.gen';
import type { DailyUsageBreakdownResponse, MpsCreditsResponse, UsageHistoryResponse, WorkflowRunUsageResponse } from '@/client/types.gen';
import { CallTypeCell } from '@/components/CallTypeCell';
import { DailyUsageTable } from '@/components/DailyUsageTable';
import { FilterBuilder } from '@/components/filters/FilterBuilder';
import { MediaPreviewButton, MediaPreviewDialog } from '@/components/MediaPreviewDialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from '@/components/ui/table';
import { useUserConfig } from '@/context/UserConfigContext';
import { useAuth } from '@/lib/auth';
import { usageFilterAttributes } from '@/lib/filterAttributes';
import { decodeFiltersFromURL, encodeFiltersToURL } from '@/lib/filters';
import { ActiveFilter, DateRangeValue } from '@/types/filters';

// Get local timezone
const getLocalTimezone = () => Intl.DateTimeFormat().resolvedOptions().timeZone;

export default function UsagePage() {
    const router = useRouter();
    const searchParams = useSearchParams();
    const { userConfig, saveUserConfig, loading: userConfigLoading, organizationPricing } = useUserConfig();
    const auth = useAuth();

    // MPS credits state
    const [mpsCredits, setMpsCredits] = useState<MpsCreditsResponse | null>(null);
    const [isLoadingCredits, setIsLoadingCredits] = useState(true);

    // Usage history state
    const [usageHistory, setUsageHistory] = useState<UsageHistoryResponse | null>(null);
    const [isLoadingHistory, setIsLoadingHistory] = useState(false);
    const [currentPage, setCurrentPage] = useState(() => {
        const pageParam = searchParams.get('page');
        return pageParam ? parseInt(pageParam, 10) : 1;
    });
    const [isExecutingFilters, setIsExecutingFilters] = useState(false);
    const [isDownloadingReport, setIsDownloadingReport] = useState(false);

    // Daily usage breakdown state (only for paid orgs)
    const [dailyUsage, setDailyUsage] = useState<DailyUsageBreakdownResponse | null>(null);
    const [isLoadingDaily, setIsLoadingDaily] = useState(false);

    // Initialize filters from URL. `activeFilters` tracks the in-progress
    // edits in the FilterBuilder; `appliedFilters` is what's actually been
    // committed via Apply (and what drives fetching + the download button).
    const [activeFilters, setActiveFilters] = useState<ActiveFilter[]>(() => {
        return decodeFiltersFromURL(searchParams, usageFilterAttributes);
    });
    const [appliedFilters, setAppliedFilters] = useState<ActiveFilter[]>(() => {
        return decodeFiltersFromURL(searchParams, usageFilterAttributes);
    });

    // Media preview dialog
    const mediaPreview = MediaPreviewDialog();

    // Timezone state - initialize with empty string to avoid hydration mismatch
    const localTimezone = getLocalTimezone();
    const [selectedTimezone, setSelectedTimezone] = useState<ITimezoneOption | string>('');
    const [savingTimezone, setSavingTimezone] = useState(false);
    const timezoneSelectId = useId(); // Stable ID for react-select to prevent hydration mismatch

    // Fetch MPS credits
    const fetchMpsCredits = useCallback(async () => {
        if (!auth.isAuthenticated) return;
        try {
            const response = await getMpsCreditsApiV1OrganizationsUsageMpsCreditsGet();
            if (response.data) {
                setMpsCredits(response.data);
            }
        } catch (error) {
            console.error('Failed to fetch MPS credits:', error);
        } finally {
            setIsLoadingCredits(false);
        }
    }, [auth.isAuthenticated]);

    // Translate the FilterBuilder state into the query-param shape the
    // backend expects. Shared between the listing fetch and the CSV export
    // so they stay in lockstep.
    const buildUsageQueryParams = (filters?: ActiveFilter[]) => {
        let filterParam: string | undefined;
        let startDate = '';
        let endDate = '';

        if (filters && filters.length > 0) {
            const dateRangeFilter = filters.find(f => f.attribute.id === 'dateRange');
            if (dateRangeFilter && dateRangeFilter.value) {
                const dateValue = dateRangeFilter.value as DateRangeValue;
                if (dateValue.from) startDate = dateValue.from.toISOString();
                if (dateValue.to) endDate = dateValue.to.toISOString();
            }

            const otherFilters = filters.filter(f => f.attribute.id !== 'dateRange');
            if (otherFilters.length > 0) {
                const filterData = otherFilters.map(filter => ({
                    attribute: filter.attribute.id,
                    type: filter.attribute.type,
                    value: filter.value,
                }));
                filterParam = JSON.stringify(filterData);
            }
        }

        return {
            ...(startDate && { start_date: startDate }),
            ...(endDate && { end_date: endDate }),
            ...(filterParam && { filters: filterParam }),
        };
    };

    // Fetch usage history
    const fetchUsageHistory = useCallback(async (page: number, filters?: ActiveFilter[]) => {
        if (!auth.isAuthenticated) return;
        setIsLoadingHistory(true);
        try {
            const response = await getUsageHistoryApiV1OrganizationsUsageRunsGet({
                query: {
                    page,
                    limit: 50,
                    ...buildUsageQueryParams(filters),
                },
            });

            if (response.data) {
                setUsageHistory(response.data);
            }
        } catch (error) {
            console.error('Failed to fetch usage history:', error);
        } finally {
            setIsLoadingHistory(false);
        }
    }, [auth.isAuthenticated]);

    // Fetch daily usage breakdown
    const fetchDailyUsage = useCallback(async () => {
        if (!auth.isAuthenticated || !organizationPricing?.price_per_second_usd) return;

        setIsLoadingDaily(true);
        try {
            const response = await getDailyUsageBreakdownApiV1OrganizationsUsageDailyBreakdownGet({
                query: { days: 7 },
            });

            if (response.data) {
                setDailyUsage(response.data);
            }
        } catch (error) {
            console.error('Failed to fetch daily usage:', error);
        } finally {
            setIsLoadingDaily(false);
        }
    }, [auth.isAuthenticated, organizationPricing]);

    // Download a CSV of all runs matching the current filters.
    const handleDownloadReport = async () => {
        if (!auth.isAuthenticated) return;
        setIsDownloadingReport(true);
        try {
            const response = await downloadUsageRunsReportApiV1OrganizationsUsageRunsReportGet({
                query: buildUsageQueryParams(appliedFilters),
                parseAs: 'blob',
            });

            if (response.data) {
                const blob = response.data as Blob;
                const url = window.URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                a.download = 'usage_runs_report.csv';
                document.body.appendChild(a);
                a.click();
                a.remove();
                window.URL.revokeObjectURL(url);
            } else {
                toast.error('Failed to download report');
            }
        } catch (error) {
            console.error('Failed to download usage report:', error);
            toast.error('Failed to download report');
        } finally {
            setIsDownloadingReport(false);
        }
    };

    // Handle timezone change
    const handleTimezoneChange = async (timezone: ITimezoneOption | string) => {
        setSelectedTimezone(timezone);
        setSavingTimezone(true);
        try {
            const tzValue = typeof timezone === 'string' ? timezone : timezone.value;
            await saveUserConfig({ timezone: tzValue });
        } catch (error) {
            console.error('Failed to save timezone:', error);
            // Revert to previous timezone on error
            const prevTz = userConfig?.timezone || localTimezone;
            setSelectedTimezone(prevTz);
        } finally {
            setSavingTimezone(false);
        }
    };

    // Update timezone when userConfig loads
    useEffect(() => {
        if (!userConfigLoading) {
            // Config has loaded - set the timezone
            if (userConfig?.timezone) {
                setSelectedTimezone(userConfig.timezone);
            } else {
                // No saved timezone, use local
                setSelectedTimezone(localTimezone);
            }
        }
    }, [userConfig, userConfigLoading, localTimezone]);

    // Initial load - fetch when auth becomes available
    useEffect(() => {
        if (auth.isAuthenticated) {
            fetchMpsCredits();
            fetchUsageHistory(currentPage, appliedFilters);
        }
    }, [auth.isAuthenticated, currentPage, appliedFilters, fetchUsageHistory, fetchMpsCredits]);

    // Fetch daily usage when organizationPricing becomes available
    useEffect(() => {
        if (auth.isAuthenticated && organizationPricing?.price_per_second_usd) {
            fetchDailyUsage();
        }
    }, [auth.isAuthenticated, organizationPricing, fetchDailyUsage]);

    // Update URL with query parameters
    const updateUrlParams = useCallback((params: { page?: number; filters?: ActiveFilter[] }) => {
        const newParams = new URLSearchParams();

        if (params.page !== undefined) {
            newParams.set('page', params.page.toString());
        }

        // Add filters to URL if present
        if (params.filters && params.filters.length > 0) {
            const filterString = encodeFiltersToURL(params.filters);
            if (filterString) {
                const filterParams = new URLSearchParams(filterString);
                filterParams.forEach((value, key) => newParams.set(key, value));
            }
        }

        router.push(`/usage?${newParams.toString()}`);
    }, [router]);

    const handleApplyFilters = useCallback(async () => {
        setIsExecutingFilters(true);
        setCurrentPage(1); // Reset to first page when applying filters
        setAppliedFilters(activeFilters);
        updateUrlParams({ page: 1, filters: activeFilters });
        await fetchUsageHistory(1, activeFilters);
        setIsExecutingFilters(false);
    }, [activeFilters, fetchUsageHistory, updateUrlParams]);

    const handleFiltersChange = useCallback((filters: ActiveFilter[]) => {
        setActiveFilters(filters);
    }, []);

    const handleClearFilters = useCallback(async () => {
        setIsExecutingFilters(true);
        setCurrentPage(1);
        setActiveFilters([]);
        setAppliedFilters([]);
        updateUrlParams({ page: 1, filters: [] }); // Clear filters from URL
        await fetchUsageHistory(1, []); // Fetch all runs without filters
        setIsExecutingFilters(false);
    }, [fetchUsageHistory, updateUrlParams]);

    // Handle page change
    const handlePageChange = (newPage: number) => {
        setCurrentPage(newPage);
        updateUrlParams({ page: newPage, filters: appliedFilters });
        fetchUsageHistory(newPage, appliedFilters);
    };

    // Handle row click to navigate to workflow run
    const handleRowClick = (run: WorkflowRunUsageResponse) => {
        router.push(`/workflow/${run.workflow_id}/run/${run.id}`);
    };

    // Format datetime for display with timezone support
    const formatDateTime = (dateString: string) => {
        const date = new Date(dateString);
        const tzValue = typeof selectedTimezone === 'string' ? selectedTimezone : selectedTimezone.value;
        // Use local timezone if none selected (during loading)
        const effectiveTz = tzValue || localTimezone;
        return date.toLocaleString('en-US', {
            timeZone: effectiveTz,
            year: 'numeric',
            month: 'short',
            day: 'numeric',
            hour: '2-digit',
            minute: '2-digit',
            hour12: true
        });
    };

    // Format duration for display
    const formatDuration = (seconds: number) => {
        const minutes = Math.floor(seconds / 60);
        const remainingSeconds = seconds % 60;
        if (minutes === 0) return `${remainingSeconds}s`;
        if (remainingSeconds === 0) return `${minutes}m`;
        return `${minutes}m ${remainingSeconds}s`;
    };

    return (
        <div className="container mx-auto p-6 space-y-6 max-w-[1600px] w-full text-zinc-300">
            <div className="fade-in-up">
                <div className="flex justify-between items-start page-header border-b border-[#1d1d22]/50 pb-6 mb-6">
                    <div>
                        <h1 className="text-2xl font-bold tracking-tight text-white mb-1.5">Agent Runs</h1>
                        <p className="text-xs text-zinc-500 leading-relaxed">See all your Agent Runs across all Voice Agents. You can use filters to find specific runs.</p>
                    </div>
                    <div className="flex items-center gap-2.5">
                        <Globe className="h-4 w-4 text-zinc-500" />
                        <div className="w-[300px]">
                            <TimezoneSelect
                                instanceId={timezoneSelectId}
                                value={selectedTimezone}
                                onChange={handleTimezoneChange}
                                isDisabled={savingTimezone || userConfigLoading}
                                placeholder={userConfigLoading ? "Loading..." : "Select timezone"}
                                styles={{
                                    control: (base, state) => ({
                                        ...base,
                                        minHeight: '36px',
                                        fontSize: '12px',
                                        backgroundColor: '#08080a',
                                        borderColor: state.isFocused ? '#7c3aed' : '#1d1d22',
                                        boxShadow: 'none',
                                        borderRadius: '12px',
                                        color: '#ffffff',
                                        '&:hover': {
                                            borderColor: '#1d1d22',
                                        },
                                    }),
                                    menu: (base) => ({
                                        ...base,
                                        zIndex: 9999,
                                        backgroundColor: '#111113',
                                        border: '1px solid #232328',
                                        borderRadius: '12px',
                                        boxShadow: 'none',
                                    }),
                                    menuList: (base) => ({
                                        ...base,
                                        backgroundColor: '#111113',
                                        padding: 0,
                                    }),
                                    option: (base, state) => ({
                                        ...base,
                                        backgroundColor: state.isSelected
                                            ? '#1c1c1f'
                                            : state.isFocused
                                            ? '#1a1a1f'
                                            : '#111113',
                                        color: '#ffffff',
                                        fontSize: '12px',
                                        cursor: 'pointer',
                                        '&:active': {
                                            backgroundColor: '#1c1c1f',
                                        },
                                    }),
                                    singleValue: (base) => ({
                                        ...base,
                                        color: '#ffffff',
                                    }),
                                    input: (base) => ({
                                        ...base,
                                        color: '#ffffff',
                                    }),
                                    placeholder: (base) => ({
                                        ...base,
                                        color: '#71717a',
                                    }),
                                    indicatorSeparator: (base) => ({
                                        ...base,
                                        backgroundColor: '#1d1d22',
                                    }),
                                    dropdownIndicator: (base) => ({
                                        ...base,
                                        color: '#71717a',
                                        '&:hover': {
                                            color: '#ffffff',
                                        },
                                    }),
                                }}
                            />
                        </div>
                    </div>
                </div>
            </div>

            {/* Daily Usage Table - Only for paid organizations */}
            {organizationPricing?.price_per_second_usd && (
                <div className="mb-6 fade-in-up" style={{ animationDelay: '0.2s' }}>
                    <DailyUsageTable
                        data={dailyUsage}
                        isLoading={isLoadingDaily}
                    />
                </div>
            )}

            {/* Filter Builder */}
            <div className="mb-6 space-y-3 fade-in-up" style={{ animationDelay: '0.3s' }}>
                <FilterBuilder
                    availableAttributes={usageFilterAttributes}
                    activeFilters={activeFilters}
                    onFiltersChange={handleFiltersChange}
                    onApplyFilters={handleApplyFilters}
                    onClearFilters={handleClearFilters}
                    isExecuting={isExecutingFilters}
                />
                {appliedFilters.length > 0 && (
                    <div className="flex justify-end">
                        <Button
                            variant="outline"
                            size="sm"
                            onClick={handleDownloadReport}
                            disabled={isDownloadingReport}
                            className="bg-[#1c1c1f] hover:bg-[#27272a] border border-[#232328] hover:border-zinc-700/60 text-zinc-300 hover:text-white rounded-xl text-xs font-bold px-3.5 py-1.5 h-8 transition-all cursor-pointer"
                        >
                            <Download className="h-3.5 w-3.5 mr-1.5" />
                            {isDownloadingReport ? 'Preparing...' : 'Download Filtered Results'}
                        </Button>
                    </div>
                )}
            </div>

            {/* Usage History */}
            <Card className="bg-[#111113] border border-[#1d1d22] rounded-2xl shadow-none overflow-hidden p-0 fade-in-up" style={{ animationDelay: '0.4s' }}>
                <CardHeader className="border-b border-[#1d1d22]/50 p-6 pb-5 mb-5">
                    <div className="flex justify-between items-start">
                        <div className="space-y-1">
                            <CardTitle className="text-base font-bold text-white">All Runs</CardTitle>
                            <CardDescription className="text-xs text-zinc-500 mt-1">
                                Every agent run across your organization, with usage details
                            </CardDescription>
                        </div>
                    </div>
                </CardHeader>
                <CardContent className="p-6 pt-0">
                    {isLoadingHistory ? (
                        <div className="animate-pulse space-y-3">
                            {[...Array(5)].map((_, i) => (
                                <div key={i} className="h-12 bg-muted rounded"></div>
                            ))}
                        </div>
                    ) : usageHistory && usageHistory.runs.length > 0 ? (
                        <>
                            <div className="rounded-2xl border border-[#1d1d22] overflow-hidden shadow-none">
                                <Table className="w-full text-left text-xs border-collapse">
                                    <TableHeader className="bg-[#18181b]/20 border-b border-[#1d1d22]">
                                        <TableRow className="border-none hover:bg-transparent">
                                            <TableHead className="font-bold text-zinc-400 text-xs uppercase tracking-wider h-11">Run ID</TableHead>
                                            <TableHead className="font-bold text-zinc-400 text-xs uppercase tracking-wider h-11">Agent Name</TableHead>
                                            <TableHead className="font-bold text-zinc-400 text-xs uppercase tracking-wider h-11">Call Type</TableHead>
                                            <TableHead className="font-bold text-zinc-400 text-xs uppercase tracking-wider h-11">Phone Number</TableHead>
                                            <TableHead className="font-bold text-zinc-400 text-xs uppercase tracking-wider h-11">Disposition</TableHead>
                                            <TableHead className="font-bold text-zinc-400 text-xs uppercase tracking-wider h-11">Date</TableHead>
                                            <TableHead className="font-bold text-zinc-400 text-xs uppercase tracking-wider h-11 text-right">Duration</TableHead>
                                            <TableHead className="font-bold text-zinc-400 text-xs uppercase tracking-wider h-11 text-right">
                                                {organizationPricing?.price_per_second_usd ? 'Cost (USD)' : 'Tokens'}
                                            </TableHead>
                                            <TableHead className="font-bold text-zinc-400 text-xs uppercase tracking-wider h-11">Actions</TableHead>
                                        </TableRow>
                                    </TableHeader>
                                    <TableBody>
                                        {usageHistory.runs.map((run) => (
                                            <TableRow
                                                key={run.id}
                                                className="hover:bg-[#1a1a1f]/60 transition-colors border-b border-[#1d1d22]/50"
                                            >
                                                <TableCell
                                                    className="font-mono text-xs cursor-pointer hover:underline text-zinc-500 hover:text-white py-3.5"
                                                    onClick={() => handleRowClick(run)}
                                                >
                                                    #{run.id}
                                                </TableCell>
                                                <TableCell className="text-white font-semibold py-3.5">{run.workflow_name || 'Unknown'}</TableCell>
                                                <TableCell className="py-3.5">
                                                    <CallTypeCell mode={run.mode} callType={run.call_type} />
                                                </TableCell>
                                                <TableCell className="text-zinc-300 text-xs py-3.5">
                                                    {(run.call_type === 'inbound'
                                                        ? run.caller_number
                                                        : run.called_number) || '-'}
                                                </TableCell>
                                                <TableCell className="py-3.5">
                                                    {run.disposition ? (
                                                        <Badge variant="outline" className="bg-[#1c1c1f] text-zinc-400 border border-zinc-700/50 text-[10px] font-semibold px-2.5 py-0.5 rounded-full">
                                                            {run.disposition}
                                                        </Badge>
                                                    ) : (
                                                        <span className="text-xs text-zinc-500">-</span>
                                                    )}
                                                </TableCell>
                                                <TableCell className="text-zinc-400 text-xs py-3.5">{formatDateTime(run.created_at)}</TableCell>
                                                <TableCell className="text-right text-zinc-300 text-xs py-3.5 text-semibold">
                                                    {formatDuration(run.call_duration_seconds)}
                                                </TableCell>
                                                <TableCell className="text-right font-medium text-white py-3.5">
                                                    {organizationPricing?.price_per_second_usd && run.charge_usd !== undefined && run.charge_usd !== null
                                                        ? `$${run.charge_usd.toFixed(2)}`
                                                        : run.dograh_token_usage.toLocaleString()
                                                    }
                                                </TableCell>
                                                <TableCell className="py-3.5">
                                                    <MediaPreviewButton
                                                        recordingUrl={run.recording_url}
                                                        transcriptUrl={run.transcript_url}
                                                        runId={run.id}
                                                        onOpenPreview={mediaPreview.openPreview}
                                                    />
                                                </TableCell>
                                            </TableRow>
                                        ))}
                                    </TableBody>
                                </Table>
                            </div>

                            {/* Summary */}
                            {appliedFilters.length > 0 && (
                                <div className="mt-4 p-4 bg-[#08080a] border border-[#1d1d22] rounded-xl text-xs">
                                    <p className="text-xs text-zinc-400">
                                        Total for filtered period: <span className="font-bold text-white">
                                            {usageHistory.total_dograh_tokens.toLocaleString()} Tokens
                                        </span>
                                        {' • '}
                                        <span className="font-bold text-white">
                                            {formatDuration(usageHistory.total_duration_seconds)}
                                        </span>
                                    </p>
                                </div>
                            )}

                            {/* Pagination */}
                            {usageHistory.total_pages > 1 && (
                                <div className="flex items-center justify-between mt-6">
                                    <p className="text-xs text-zinc-500">
                                        Page {usageHistory.page} of {usageHistory.total_pages} ({usageHistory.total_count} total runs)
                                    </p>
                                    <div className="flex gap-2">
                                        <Button
                                            variant="outline"
                                            size="sm"
                                            onClick={() => handlePageChange(currentPage - 1)}
                                            disabled={currentPage === 1}
                                            className="bg-[#1c1c1f] hover:bg-[#27272a] border border-[#232328] hover:border-zinc-700/60 text-zinc-300 hover:text-white rounded-xl text-xs font-bold px-3 py-1.5 h-8 transition-all cursor-pointer"
                                        >
                                            <ChevronLeft className="h-3.5 w-3.5 mr-1" />
                                            Previous
                                        </Button>
                                        <Button
                                            variant="outline"
                                            size="sm"
                                            onClick={() => handlePageChange(currentPage + 1)}
                                            disabled={currentPage === usageHistory.total_pages}
                                            className="bg-[#1c1c1f] hover:bg-[#27272a] border border-[#232328] hover:border-zinc-700/60 text-zinc-300 hover:text-white rounded-xl text-xs font-bold px-3 py-1.5 h-8 transition-all cursor-pointer"
                                        >
                                            Next
                                            <ChevronRight className="h-3.5 w-3.5 ml-1" />
                                        </Button>
                                    </div>
                                </div>
                            )}
                        </>
                    ) : (
                                        color: '#71717a',
                                    }),
                                    indicatorSeparator: (base) => ({
                                        ...base,
                                        backgroundColor: '#1d1d22',
                                    }),
                                    dropdownIndicator: (base) => ({
                                        ...base,
                                        color: '#71717a',
                                        '&:hover': {
                                            color: '#ffffff',
                                        },
                                    }),
                                }}
                            />
                        </div>
                    </div>
                </div>
            </div>

            {/* Daily Usage Table - Only for paid organizations */}
            {organizationPricing?.price_per_second_usd && (
                <div className="mb-6 fade-in-up" style={{ animationDelay: '0.2s' }}>
                    <DailyUsageTable
                        data={dailyUsage}
                        isLoading={isLoadingDaily}
                    />
                </div>
            )}

            {/* Filter Builder */}
            <div className="mb-6 space-y-3 fade-in-up" style={{ animationDelay: '0.3s' }}>
                <FilterBuilder
                    availableAttributes={usageFilterAttributes}
                    activeFilters={activeFilters}
                    onFiltersChange={handleFiltersChange}
                    onApplyFilters={handleApplyFilters}
                    onClearFilters={handleClearFilters}
                    isExecuting={isExecutingFilters}
                />
                {appliedFilters.length > 0 && (
                    <div className="flex justify-end">
                        <Button
                            variant="outline"
                            size="sm"
                            onClick={handleDownloadReport}
                            disabled={isDownloadingReport}
                            className="bg-[#1c1c1f] hover:bg-[#27272a] border border-[#232328] hover:border-zinc-700/60 text-zinc-300 hover:text-white rounded-xl text-xs font-bold px-3.5 py-1.5 h-8 transition-all cursor-pointer"
                        >
                            <Download className="h-3.5 w-3.5 mr-1.5" />
                            {isDownloadingReport ? 'Preparing...' : 'Download Filtered Results'}
                        </Button>
                    </div>
                )}
            </div>

            {/* Usage History */}
            <Card className="bg-[#111113] border border-[#1d1d22] rounded-2xl shadow-none overflow-hidden p-0 fade-in-up" style={{ animationDelay: '0.4s' }}>
                <CardHeader className="border-b border-[#1d1d22]/50 p-6 pb-5 mb-5">
                    <div className="flex justify-between items-start">
                        <div className="space-y-1">
                            <CardTitle className="text-base font-bold text-white">All Runs</CardTitle>
                            <CardDescription className="text-xs text-zinc-500 mt-1">
                                Every agent run across your organization, with usage details
                            </CardDescription>
                        </div>
                    </div>
                </CardHeader>
                <CardContent className="p-6 pt-0">
                    {isLoadingHistory ? (
                        <div className="animate-pulse space-y-3">
                            {[...Array(5)].map((_, i) => (
                                <div key={i} className="h-12 bg-muted rounded"></div>
                            ))}
                        </div>
                    ) : usageHistory && usageHistory.runs.length > 0 ? (
                        <>
                            <div className="rounded-2xl border border-[#1d1d22] overflow-hidden shadow-none">
                                <Table className="w-full text-left text-xs border-collapse">
                                    <TableHeader className="bg-[#18181b]/20 border-b border-[#1d1d22]">
                                        <TableRow className="border-none hover:bg-transparent">
                                            <TableHead className="font-bold text-zinc-400 text-xs uppercase tracking-wider h-11">Run ID</TableHead>
                                            <TableHead className="font-bold text-zinc-400 text-xs uppercase tracking-wider h-11">Agent Name</TableHead>
                                            <TableHead className="font-bold text-zinc-400 text-xs uppercase tracking-wider h-11">Call Type</TableHead>
                                            <TableHead className="font-bold text-zinc-400 text-xs uppercase tracking-wider h-11">Phone Number</TableHead>
                                            <TableHead className="font-bold text-zinc-400 text-xs uppercase tracking-wider h-11">Disposition</TableHead>
                                            <TableHead className="font-bold text-zinc-400 text-xs uppercase tracking-wider h-11">Date</TableHead>
                                            <TableHead className="font-bold text-zinc-400 text-xs uppercase tracking-wider h-11 text-right">Duration</TableHead>
                                            <TableHead className="font-bold text-zinc-400 text-xs uppercase tracking-wider h-11 text-right">
                                                {organizationPricing?.price_per_second_usd ? 'Cost (USD)' : 'Tokens'}
                                            </TableHead>
                                            <TableHead className="font-bold text-zinc-400 text-xs uppercase tracking-wider h-11">Actions</TableHead>
                                        </TableRow>
                                    </TableHeader>
                                    <TableBody>
                                        {usageHistory.runs.map((run) => (
                                            <TableRow
                                                key={run.id}
                                                className="hover:bg-[#1a1a1f]/60 transition-colors border-b border-[#1d1d22]/50"
                                            >
                                                <TableCell
                                                    className="font-mono text-xs cursor-pointer hover:underline text-zinc-500 hover:text-white py-3.5"
                                                    onClick={() => handleRowClick(run)}
                                                >
                                                    #{run.id}
                                                </TableCell>
                                                <TableCell className="text-white font-semibold py-3.5">{run.workflow_name || 'Unknown'}</TableCell>
                                                <TableCell className="py-3.5">
                                                    <CallTypeCell mode={run.mode} callType={run.call_type} />
                                                </TableCell>
                                                <TableCell className="text-zinc-300 text-xs py-3.5">
                                                    {(run.call_type === 'inbound'
                                                        ? run.caller_number
                                                        : run.called_number) || '-'}
                                                </TableCell>
                                                <TableCell className="py-3.5">
                                                    {run.disposition ? (
                                                        <Badge variant="outline" className="bg-[#1c1c1f] text-zinc-400 border border-zinc-700/50 text-[10px] font-semibold px-2.5 py-0.5 rounded-full">
                                                            {run.disposition}
                                                        </Badge>
                                                    ) : (
                                                        <span className="text-xs text-zinc-500">-</span>
                                                    )}
                                                </TableCell>
                                                <TableCell className="text-zinc-400 text-xs py-3.5">{formatDateTime(run.created_at)}</TableCell>
                                                <TableCell className="text-right text-zinc-300 text-xs py-3.5 text-semibold">
                                                    {formatDuration(run.call_duration_seconds)}
                                                </TableCell>
                                                <TableCell className="text-right font-medium text-white py-3.5">
                                                    {organizationPricing?.price_per_second_usd && run.charge_usd !== undefined && run.charge_usd !== null
                                                        ? `$${run.charge_usd.toFixed(2)}`
                                                        : run.dograh_token_usage.toLocaleString()
                                                    }
                                                </TableCell>
                                                <TableCell className="py-3.5">
                                                    <MediaPreviewButton
                                                        recordingUrl={run.recording_url}
                                                        transcriptUrl={run.transcript_url}
                                                        runId={run.id}
                                                        onOpenPreview={mediaPreview.openPreview}
                                                    />
                                                </TableCell>
                                            </TableRow>
                                        ))}
                                    </TableBody>
                                </Table>
                            </div>

                            {/* Summary */}
                            {appliedFilters.length > 0 && (
                                <div className="mt-4 p-4 bg-[#08080a] border border-[#1d1d22] rounded-xl text-xs">
                                    <p className="text-xs text-zinc-400">
                                        Total for filtered period: <span className="font-bold text-white">
                                            {usageHistory.total_dograh_tokens.toLocaleString()} Tokens
                                        </span>
                                        {' • '}
                                        <span className="font-bold text-white">
                                            {formatDuration(usageHistory.total_duration_seconds)}
                                        </span>
                                    </p>
                                </div>
                            )}

                            {/* Pagination */}
                            {usageHistory.total_pages > 1 && (
                                <div className="flex items-center justify-between mt-6">
                                    <p className="text-xs text-zinc-500">
                                        Page {usageHistory.page} of {usageHistory.total_pages} ({usageHistory.total_count} total runs)
                                    </p>
                                    <div className="flex gap-2">
                                        <Button
                                            variant="outline"
                                            size="sm"
                                            onClick={() => handlePageChange(currentPage - 1)}
                                            disabled={currentPage === 1}
                                            className="bg-[#1c1c1f] hover:bg-[#27272a] border border-[#232328] hover:border-zinc-700/60 text-zinc-300 hover:text-white rounded-xl text-xs font-bold px-3 py-1.5 h-8 transition-all cursor-pointer"
                                        >
                                            <ChevronLeft className="h-3.5 w-3.5 mr-1" />
                                            Previous
                                        </Button>
                                        <Button
                                            variant="outline"
                                            size="sm"
                                            onClick={() => handlePageChange(currentPage + 1)}
                                            disabled={currentPage === usageHistory.total_pages}
                                            className="bg-[#1c1c1f] hover:bg-[#27272a] border border-[#232328] hover:border-zinc-700/60 text-zinc-300 hover:text-white rounded-xl text-xs font-bold px-3 py-1.5 h-8 transition-all cursor-pointer"
                                        >
                                            Next
                                            <ChevronRight className="h-3.5 w-3.5 ml-1" />
                                        </Button>
                                    </div>
                                </div>
                            )}
                        </>
                    ) : (
                        <p className="text-center py-8 text-xs text-zinc-500">No runs found</p>
                    )}
                </CardContent>
            </Card>

            {/* Media Preview Dialog */}
            {mediaPreview.dialog}
        </div>
    );
}
