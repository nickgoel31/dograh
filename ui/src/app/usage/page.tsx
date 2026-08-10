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
import { Skeleton } from '@/components/ui/skeleton';
import { useUserConfig } from '@/context/UserConfigContext';
import { useAuth } from '@/lib/auth';
import { usageFilterAttributes } from '@/lib/filterAttributes';
import { decodeFiltersFromURL, encodeFiltersToURL } from '@/lib/filters';
import { ActiveFilter, DateRangeValue } from '@/types/filters';

const getLocalTimezone = () => Intl.DateTimeFormat().resolvedOptions().timeZone;

export default function UsagePage() {
    const router = useRouter();
    const searchParams = useSearchParams();
    const { userConfig, saveUserConfig, loading: userConfigLoading, organizationPricing } = useUserConfig();
    const auth = useAuth();

    const [mpsCredits, setMpsCredits] = useState<MpsCreditsResponse | null>(null);
    const [isLoadingCredits, setIsLoadingCredits] = useState(true);

    const [usageHistory, setUsageHistory] = useState<UsageHistoryResponse | null>(null);
    const [isLoadingHistory, setIsLoadingHistory] = useState(false);
    const [currentPage, setCurrentPage] = useState(() => {
        const pageParam = searchParams.get('page');
        return pageParam ? parseInt(pageParam, 10) : 1;
    });
    const [isExecutingFilters, setIsExecutingFilters] = useState(false);
    const [isDownloadingReport, setIsDownloadingReport] = useState(false);

    const [dailyUsage, setDailyUsage] = useState<DailyUsageBreakdownResponse | null>(null);
    const [isLoadingDaily, setIsLoadingDaily] = useState(false);

    const [activeFilters, setActiveFilters] = useState<ActiveFilter[]>(() => {
        return decodeFiltersFromURL(searchParams, usageFilterAttributes);
    });
    const [appliedFilters, setAppliedFilters] = useState<ActiveFilter[]>(() => {
        return decodeFiltersFromURL(searchParams, usageFilterAttributes);
    });

    const mediaPreview = MediaPreviewDialog();

    const localTimezone = getLocalTimezone();
    const [selectedTimezone, setSelectedTimezone] = useState<ITimezoneOption | string>('');
    const [savingTimezone, setSavingTimezone] = useState(false);
    const timezoneSelectId = useId();

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

    const handleTimezoneChange = async (timezone: ITimezoneOption | string) => {
        setSelectedTimezone(timezone);
        setSavingTimezone(true);
        try {
            const tzValue = typeof timezone === 'string' ? timezone : timezone.value;
            await saveUserConfig({ timezone: tzValue });
        } catch (error) {
            console.error('Failed to save timezone:', error);
            const prevTz = userConfig?.timezone || localTimezone;
            setSelectedTimezone(prevTz);
        } finally {
            setSavingTimezone(false);
        }
    };

    useEffect(() => {
        if (!userConfigLoading) {
            if (userConfig?.timezone) {
                setSelectedTimezone(userConfig.timezone);
            } else {
                setSelectedTimezone(localTimezone);
            }
        }
    }, [userConfig, userConfigLoading, localTimezone]);

    useEffect(() => {
        if (auth.isAuthenticated) {
            fetchMpsCredits();
            fetchUsageHistory(currentPage, appliedFilters);
        }
    }, [auth.isAuthenticated, currentPage, appliedFilters, fetchUsageHistory, fetchMpsCredits]);

    useEffect(() => {
        if (auth.isAuthenticated && organizationPricing?.price_per_second_usd) {
            fetchDailyUsage();
        }
    }, [auth.isAuthenticated, organizationPricing, fetchDailyUsage]);

    const updateUrlParams = useCallback((params: { page?: number; filters?: ActiveFilter[] }) => {
        const newParams = new URLSearchParams();

        if (params.page !== undefined) {
            newParams.set('page', params.page.toString());
        }

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
        setCurrentPage(1);
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
        updateUrlParams({ page: 1, filters: [] });
        await fetchUsageHistory(1, []);
        setIsExecutingFilters(false);
    }, [fetchUsageHistory, updateUrlParams]);

    const handlePageChange = (newPage: number) => {
        setCurrentPage(newPage);
        updateUrlParams({ page: newPage, filters: appliedFilters });
        fetchUsageHistory(newPage, appliedFilters);
    };

    const handleRowClick = (run: WorkflowRunUsageResponse) => {
        router.push(`/workflow/${run.workflow_id}/run/${run.id}`);
    };

    const formatDateTime = (dateString: string) => {
        const date = new Date(dateString);
        const tzValue = typeof selectedTimezone === 'string' ? selectedTimezone : selectedTimezone.value;
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

    const formatDuration = (seconds: number) => {
        const minutes = Math.floor(seconds / 60);
        const remainingSeconds = seconds % 60;
        if (minutes === 0) return `${remainingSeconds}s`;
        if (remainingSeconds === 0) return `${minutes}m`;
        return `${minutes}m ${remainingSeconds}s`;
    };

    return (
        <div className="flex flex-col h-full text-gray-900 dark:text-white font-sans select-none relative" style={{ backgroundColor: '#161715' }}>
            {/* Top Sub-Header matching demo styling */}
            <header className="px-8 pt-6 pb-3 flex items-center justify-between sticky top-0 z-20 border-b border-gray-100 dark:border-[#282b26]" style={{ backgroundColor: '#161715' }}>
                <div className="space-y-0.5">
                    <div className="flex items-center gap-2">
                        <Database className="w-4 h-4 text-amber-600 dark:text-amber-400" />
                        <h1 className="text-base font-semibold text-gray-900 dark:text-white tracking-tight">
                            Agent Runs
                        </h1>
                    </div>
                    <p className="text-xs text-gray-500 dark:text-gray-400">
                        See all your Agent Runs across all Voice Agents. You can use filters to find specific runs.
                    </p>
                </div>

                {/* Timezone Selector */}
                <div className="flex items-center gap-2">
                    <Globe className="w-4 h-4 text-gray-400 dark:text-gray-500 shrink-0" />
                    <div className="w-[280px]">
                        <TimezoneSelect
                            instanceId={timezoneSelectId}
                            value={selectedTimezone}
                            onChange={handleTimezoneChange}
                            isDisabled={savingTimezone || userConfigLoading}
                            placeholder={userConfigLoading ? "Loading..." : "Select timezone"}
                            styles={{
                                control: (base, state) => ({
                                    ...base,
                                    minHeight: '34px',
                                    height: '34px',
                                    fontSize: '12px',
                                    backgroundColor: '#161715',
                                    borderColor: state.isFocused ? '#383c35' : '#282b26',
                                    borderRadius: '9999px',
                                    boxShadow: 'none',
                                    color: '#ffffff',
                                    '&:hover': {
                                        borderColor: '#383c35',
                                    },
                                }),
                                menu: (base) => ({
                                    ...base,
                                    zIndex: 9999,
                                    backgroundColor: '#1C1E1A',
                                    border: '1px solid #282b26',
                                    borderRadius: '0.75rem',
                                    boxShadow: '0 10px 25px -5px rgba(0, 0, 0, 0.5)',
                                }),
                                menuList: (base) => ({
                                    ...base,
                                    backgroundColor: '#1C1E1A',
                                    padding: '4px',
                                }),
                                option: (base, state) => ({
                                    ...base,
                                    backgroundColor: state.isSelected
                                        ? '#282b26'
                                        : state.isFocused
                                        ? '#161715'
                                        : '#1C1E1A',
                                    color: '#ffffff',
                                    fontSize: '12px',
                                    borderRadius: '0.5rem',
                                    cursor: 'pointer',
                                    '&:active': {
                                        backgroundColor: '#282b26',
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
                                    display: 'none',
                                }),
                                dropdownIndicator: (base) => ({
                                    ...base,
                                    color: '#71717a',
                                    padding: '4px',
                                    '&:hover': {
                                        color: '#ffffff',
                                    },
                                }),
                            }}
                        />
                    </div>
                </div>
            </header>

            {/* Main Content Workspace Container */}
            <div className="max-w-6xl w-full mx-auto px-8 pt-6 pb-16 flex flex-col gap-6">
                {/* Daily Usage Table - Paid Orgs */}
                {organizationPricing?.price_per_second_usd && (
                    <div className="border border-gray-200/90 dark:border-[#282b26] rounded-2xl p-6 shadow-2xs" style={{ backgroundColor: '#1C1E1A' }}>
                        <DailyUsageTable
                            data={dailyUsage}
                            isLoading={isLoadingDaily}
                        />
                    </div>
                )}

                {/* Filter Workflow Runs Card Container */}
                <div
                    className="border border-gray-200/90 dark:border-[#282b26] rounded-2xl p-6 shadow-2xs space-y-4"
                    style={{ backgroundColor: '#1C1E1A' }}
                >
                    <div className="flex items-center justify-between">
                        <div className="space-y-0.5">
                            <h2 className="text-xl font-normal text-gray-900 dark:text-white font-serif tracking-tight">
                                Filter Workflow Runs
                            </h2>
                            <p className="text-xs text-gray-400 dark:text-gray-500">
                                Build custom filters to find specific workflow runs
                            </p>
                        </div>

                        {appliedFilters.length > 0 && (
                            <button
                                onClick={handleDownloadReport}
                                disabled={isDownloadingReport}
                                className="flex items-center gap-1.5 px-4 py-1.5 bg-black dark:bg-[#bcf0da] hover:bg-gray-800 dark:hover:bg-[#a5e9cd] text-white dark:text-[#082117] text-xs font-semibold rounded-full shadow-xs transition-all cursor-pointer"
                            >
                                <Download className="w-3.5 h-3.5" />
                                <span>{isDownloadingReport ? 'Preparing...' : 'Download Report'}</span>
                            </button>
                        )}
                    </div>

                    <FilterBuilder
                        availableAttributes={usageFilterAttributes}
                        activeFilters={activeFilters}
                        onFiltersChange={handleFiltersChange}
                        onApplyFilters={handleApplyFilters}
                        onClearFilters={handleClearFilters}
                        isExecuting={isExecutingFilters}
                    />
                </div>

                {/* All Runs Table Card */}
                <div
                    className="border border-gray-200/90 dark:border-[#282b26] rounded-2xl p-6 shadow-2xs space-y-5"
                    style={{ backgroundColor: '#1C1E1A' }}
                >
                    <div className="flex items-center justify-between">
                        <div className="space-y-0.5">
                            <h2 className="text-xl font-normal text-gray-900 dark:text-white font-serif tracking-tight">
                                All Runs
                            </h2>
                            <p className="text-xs text-gray-400 dark:text-gray-500">
                                Every agent run across your organization, with usage details
                            </p>
                        </div>

                        <span className="text-xs font-semibold px-2.5 py-1 rounded-full bg-gray-100 dark:bg-[#161715] text-gray-700 dark:text-gray-300 border border-gray-200/50 dark:border-[#282b26]">
                            {usageHistory?.total_count ?? 0} runs
                        </span>
                    </div>

                    {/* Runs Table */}
                    {isLoadingHistory ? (
                        <div className="space-y-3 py-4">
                            {[...Array(4)].map((_, i) => (
                                <Skeleton key={i} className="h-12 w-full rounded-xl bg-gray-100 dark:bg-[#161715]" />
                            ))}
                        </div>
                    ) : usageHistory && usageHistory.runs.length > 0 ? (
                        <>
                            <div className="overflow-x-auto">
                                <table className="w-full text-left text-xs">
                                    <thead>
                                        <tr className="border-b border-gray-100 dark:border-[#282b26] text-gray-400 dark:text-gray-500 font-semibold uppercase tracking-wider text-[10.5px]">
                                            <th className="pb-3 px-2">RUN ID</th>
                                            <th className="pb-3 px-2">AGENT NAME</th>
                                            <th className="pb-3 px-2">CALL TYPE</th>
                                            <th className="pb-3 px-2">PHONE NUMBER</th>
                                            <th className="pb-3 px-2">DISPOSITION</th>
                                            <th className="pb-3 px-2">DATE</th>
                                            <th className="pb-3 px-2">DURATION</th>
                                            <th className="pb-3 px-2">
                                                {organizationPricing?.price_per_second_usd ? 'COST (USD)' : 'TOKENS'}
                                            </th>
                                            <th className="pb-3 px-2 text-right">ACTIONS</th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-gray-100 dark:divide-[#282b26]">
                                        {usageHistory.runs.map((run) => (
                                            <tr
                                                key={run.id}
                                                onClick={() => handleRowClick(run)}
                                                className="hover:bg-gray-50/70 dark:hover:bg-[#161715]/70 transition-colors group cursor-pointer"
                                            >
                                                {/* RUN ID */}
                                                <td className="py-4 px-2 font-mono font-semibold text-gray-600 dark:text-gray-400 group-hover:text-black dark:group-hover:text-white">
                                                    #{run.id}
                                                </td>

                                                {/* AGENT NAME */}
                                                <td className="py-4 px-2 font-bold text-gray-900 dark:text-white max-w-[220px] truncate">
                                                    {run.workflow_name || 'Unknown'}
                                                </td>

                                                {/* CALL TYPE */}
                                                <td className="py-4 px-2">
                                                    <CallTypeCell mode={run.mode} callType={run.call_type} />
                                                </td>

                                                {/* PHONE NUMBER */}
                                                <td className="py-4 px-2 font-mono text-gray-700 dark:text-gray-300">
                                                    {(run.call_type === 'inbound'
                                                        ? run.caller_number
                                                        : run.called_number) || '-'}
                                                </td>

                                                {/* DISPOSITION */}
                                                <td className="py-4 px-2">
                                                    {run.disposition ? (
                                                        <span className="px-2.5 py-0.5 bg-gray-100 dark:bg-[#161715] text-gray-600 dark:text-gray-300 border border-gray-200/80 dark:border-[#282b26] rounded-full font-mono text-[11px] font-medium">
                                                            {run.disposition}
                                                        </span>
                                                    ) : (
                                                        <span className="text-gray-400 dark:text-gray-500">-</span>
                                                    )}
                                                </td>

                                                {/* DATE */}
                                                <td className="py-4 px-2 text-gray-500 dark:text-gray-400 font-medium">
                                                    {formatDateTime(run.created_at)}
                                                </td>

                                                {/* DURATION */}
                                                <td className="py-4 px-2 text-gray-800 dark:text-gray-200 font-semibold font-mono">
                                                    {formatDuration(run.call_duration_seconds)}
                                                </td>

                                                {/* TOKENS / COST */}
                                                <td className="py-4 px-2 font-mono font-bold text-gray-900 dark:text-white">
                                                    {organizationPricing?.price_per_second_usd && run.charge_usd !== undefined && run.charge_usd !== null
                                                        ? `$${run.charge_usd.toFixed(2)}`
                                                        : run.dograh_token_usage.toLocaleString()
                                                    }
                                                </td>

                                                {/* ACTIONS */}
                                                <td className="py-4 px-2 text-right" onClick={(e) => e.stopPropagation()}>
                                                    <MediaPreviewButton
                                                        recordingUrl={run.recording_url}
                                                        transcriptUrl={run.transcript_url}
                                                        runId={run.id}
                                                        onOpenPreview={mediaPreview.openPreview}
                                                    />
                                                </td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>

                            {/* Summary */}
                            {appliedFilters.length > 0 && (
                                <div
                                    className="p-4 border border-gray-200 dark:border-[#282b26] rounded-xl text-xs"
                                    style={{ backgroundColor: '#161715' }}
                                >
                                    <p className="text-xs text-gray-400 dark:text-gray-500">
                                        Total for filtered period: <span className="font-bold text-gray-900 dark:text-white">
                                            {usageHistory.total_dograh_tokens.toLocaleString()} Tokens
                                        </span>
                                        {' • '}
                                        <span className="font-bold text-gray-900 dark:text-white">
                                            {formatDuration(usageHistory.total_duration_seconds)}
                                        </span>
                                    </p>
                                </div>
                            )}

                            {/* Pagination */}
                            {usageHistory.total_pages > 1 && (
                                <div className="flex items-center justify-between mt-4 pt-4 border-t border-gray-100 dark:border-[#282b26]">
                                    <p className="text-xs text-gray-400 dark:text-gray-500">
                                        Page {usageHistory.page} of {usageHistory.total_pages} ({usageHistory.total_count} total runs)
                                    </p>
                                    <div className="flex gap-2">
                                        <button
                                            onClick={() => handlePageChange(currentPage - 1)}
                                            disabled={currentPage === 1}
                                            className="px-3 py-1.5 bg-gray-100 dark:bg-[#161715] hover:bg-gray-200 dark:hover:bg-[#232621] disabled:opacity-50 text-gray-700 dark:text-gray-300 text-xs font-semibold rounded-xl transition-all cursor-pointer flex items-center gap-1"
                                        >
                                            <ChevronLeft className="h-3.5 w-3.5" />
                                            <span>Previous</span>
                                        </button>
                                        <button
                                            onClick={() => handlePageChange(currentPage + 1)}
                                            disabled={currentPage === usageHistory.total_pages}
                                            className="px-3 py-1.5 bg-gray-100 dark:bg-[#161715] hover:bg-gray-200 dark:hover:bg-[#232621] disabled:opacity-50 text-gray-700 dark:text-gray-300 text-xs font-semibold rounded-xl transition-all cursor-pointer flex items-center gap-1"
                                        >
                                            <span>Next</span>
                                            <ChevronRight className="h-3.5 w-3.5" />
                                        </button>
                                    </div>
                                </div>
                            )}
                        </>
                    ) : (
                        <p className="text-center py-12 text-xs text-gray-400 dark:text-gray-500">No agent runs found</p>
                    )}
                </div>
            </div>

            {/* Media Preview Dialog */}
            {mediaPreview.dialog}
        </div>
    );
}
