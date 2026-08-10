"use client";

import { ArrowLeft, ChevronDown, ChevronRight, Sliders } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import type { ITimezoneOption } from 'react-timezone-select';
import { toast } from 'sonner';

import {
    createCampaignApiV1CampaignCreatePost,
    getCampaignDefaultsApiV1OrganizationsCampaignDefaultsGet,
    getWorkflowsSummaryApiV1WorkflowSummaryGet,
    listTelephonyConfigurationsApiV1OrganizationsTelephonyConfigsGet
} from '@/client/sdk.gen';
import type { TelephonyConfigurationListItem, WorkflowSummaryResponse } from '@/client/types.gen';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { useAuth } from '@/lib/auth';

import CampaignAdvancedSettings, { getTimezoneValue, type TimeSlot } from '../CampaignAdvancedSettings';
import ContactSourceSelector from '../ContactSourceSelector';

export default function NewCampaignPage() {
    const { user, getAccessToken, redirectToLogin, loading } = useAuth();
    const router = useRouter();

    // Form state
    const [campaignName, setCampaignName] = useState('');
    const [selectedWorkflowId, setSelectedWorkflowId] = useState<string>('');
    const [sourceType, setSourceType] = useState<string>('csv');
    const [sourceId, setSourceId] = useState('');
    const [sourceConfig, setSourceConfig] = useState<Record<string, any>>({});
    const [autoSyncEnabled, setAutoSyncEnabled] = useState(false);
    const [autoSyncIntervalMinutes, setAutoSyncIntervalMinutes] = useState(60);
    const [autoSyncOnlyNew, setAutoSyncOnlyNew] = useState(true);
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [createError, setCreateError] = useState<string | null>(null);

    // Workflows state
    const [workflows, setWorkflows] = useState<WorkflowSummaryResponse[]>([]);
    const [isLoadingWorkflows, setIsLoadingWorkflows] = useState(true);

    // Telephony configurations state
    const [telephonyConfigs, setTelephonyConfigs] = useState<TelephonyConfigurationListItem[]>([]);
    const [selectedTelephonyConfigId, setSelectedTelephonyConfigId] = useState<string>('');
    const [isLoadingTelephonyConfigs, setIsLoadingTelephonyConfigs] = useState(true);

    // Advanced settings state
    const [showAdvancedSettings, setShowAdvancedSettings] = useState(false);
    const [orgConcurrentLimit, setOrgConcurrentLimit] = useState<number>(2);
    const [fromNumbersCount, setFromNumbersCount] = useState<number>(0);
    const [maxConcurrency, setMaxConcurrency] = useState<string>('');
    // Retry config state
    const [retryEnabled, setRetryEnabled] = useState(true);
    const [maxRetries, setMaxRetries] = useState<string>('2');
    const [retryDelaySeconds, setRetryDelaySeconds] = useState<string>('120');
    const [retryOnBusy, setRetryOnBusy] = useState(true);
    const [retryOnNoAnswer, setRetryOnNoAnswer] = useState(true);
    const [retryOnVoicemail, setRetryOnVoicemail] = useState(true);
    // Schedule config state
    const [scheduleEnabled, setScheduleEnabled] = useState(false);
    const [scheduleTimezone, setScheduleTimezone] = useState<ITimezoneOption | string>(() => {
        try {
            return Intl.DateTimeFormat().resolvedOptions().timeZone;
        } catch {
            return 'UTC';
        }
    });
    const [timeSlots, setTimeSlots] = useState<TimeSlot[]>([
        { day_of_week: 0, start_time: '09:00', end_time: '17:00' },
    ]);
    // Circuit breaker config state
    const [circuitBreakerEnabled, setCircuitBreakerEnabled] = useState(true);
    const [circuitBreakerFailureThreshold, setCircuitBreakerFailureThreshold] = useState<string>('50');
    const [circuitBreakerWindowSeconds, setCircuitBreakerWindowSeconds] = useState<string>('120');
    const [circuitBreakerMinCalls, setCircuitBreakerMinCalls] = useState<string>('5');

    // Redirect if not authenticated
    useEffect(() => {
        if (!loading && !user) {
            redirectToLogin();
        }
    }, [loading, user, redirectToLogin]);

    // Fetch workflows
    const fetchWorkflows = useCallback(async () => {
        if (!user) return;
        try {
            const accessToken = await getAccessToken();
            const response = await getWorkflowsSummaryApiV1WorkflowSummaryGet({
                headers: {
                    'Authorization': `Bearer ${accessToken}`,
                },
                query: {
                    status: 'active',
                },
            });

            if (response.data) {
                setWorkflows(response.data);
            }
        } catch (error) {
            console.error('Failed to fetch workflows:', error);
            toast.error('Failed to load workflows');
        } finally {
            setIsLoadingWorkflows(false);
        }
    }, [user, getAccessToken]);

    // Fetch telephony configurations
    const fetchTelephonyConfigs = useCallback(async () => {
        if (!user) return;
        try {
            const accessToken = await getAccessToken();
            const response = await listTelephonyConfigurationsApiV1OrganizationsTelephonyConfigsGet({
                headers: {
                    'Authorization': `Bearer ${accessToken}`,
                }
            });

            if (response.data) {
                const configs = response.data.configurations ?? [];
                setTelephonyConfigs(configs);
                const defaultConfig = configs.find((c) => c.is_default_outbound) ?? configs[0];
                if (defaultConfig) {
                    setSelectedTelephonyConfigId(String(defaultConfig.id));
                }
            }
        } catch (error) {
            console.error('Failed to fetch telephony configurations:', error);
            toast.error('Failed to load telephony configurations');
        } finally {
            setIsLoadingTelephonyConfigs(false);
        }
    }, [user, getAccessToken]);

    // Fetch campaign limits
    const fetchCampaignDefaults = useCallback(async () => {
        if (!user) return;
        try {
            const accessToken = await getAccessToken();
            const response = await getCampaignDefaultsApiV1OrganizationsCampaignDefaultsGet({
                headers: {
                    'Authorization': `Bearer ${accessToken}`,
                }
            });

            if (response.data) {
                setOrgConcurrentLimit(response.data.concurrent_call_limit);
                setFromNumbersCount(response.data.from_numbers_count);

                const last = (response.data as { last_campaign_settings?: {
                    retry_config?: { enabled: boolean; max_retries: number; retry_delay_seconds: number; retry_on_busy: boolean; retry_on_no_answer: boolean; retry_on_voicemail: boolean };
                    max_concurrency?: number | null;
                    schedule_config?: { enabled: boolean; timezone: string; slots: TimeSlot[] } | null;
                    circuit_breaker?: { enabled: boolean; failure_threshold: number; window_seconds: number; min_calls_in_window: number } | null;
                } | null }).last_campaign_settings;

                if (last) {
                    if (last.retry_config) {
                        setRetryEnabled(last.retry_config.enabled);
                        setMaxRetries(String(last.retry_config.max_retries));
                        setRetryDelaySeconds(String(last.retry_config.retry_delay_seconds));
                        setRetryOnBusy(last.retry_config.retry_on_busy);
                        setRetryOnNoAnswer(last.retry_config.retry_on_no_answer);
                        setRetryOnVoicemail(last.retry_config.retry_on_voicemail);
                    } else {
                        const retryConfig = response.data.default_retry_config;
                        setRetryEnabled(retryConfig.enabled);
                        setMaxRetries(String(retryConfig.max_retries));
                        setRetryDelaySeconds(String(retryConfig.retry_delay_seconds));
                        setRetryOnBusy(retryConfig.retry_on_busy);
                        setRetryOnNoAnswer(retryConfig.retry_on_no_answer);
                        setRetryOnVoicemail(retryConfig.retry_on_voicemail);
                    }
                    if (last.max_concurrency) {
                        setMaxConcurrency(String(last.max_concurrency));
                    }
                    if (last.schedule_config) {
                        setScheduleEnabled(last.schedule_config.enabled);
                        setScheduleTimezone(last.schedule_config.timezone);
                        setTimeSlots(last.schedule_config.slots);
                    }
                    if (last.circuit_breaker) {
                        setCircuitBreakerEnabled(last.circuit_breaker.enabled);
                        setCircuitBreakerFailureThreshold(String(Math.round(last.circuit_breaker.failure_threshold * 100)));
                        setCircuitBreakerWindowSeconds(String(last.circuit_breaker.window_seconds));
                        setCircuitBreakerMinCalls(String(last.circuit_breaker.min_calls_in_window));
                    }
                } else {
                    const retryConfig = response.data.default_retry_config;
                    setRetryEnabled(retryConfig.enabled);
                    setMaxRetries(String(retryConfig.max_retries));
                    setRetryDelaySeconds(String(retryConfig.retry_delay_seconds));
                    setRetryOnBusy(retryConfig.retry_on_busy);
                    setRetryOnNoAnswer(retryConfig.retry_on_no_answer);
                    setRetryOnVoicemail(retryConfig.retry_on_voicemail);
                }
            }
        } catch (error) {
            console.error('Failed to fetch campaign limits:', error);
        }
    }, [user, getAccessToken]);

    // Initial load
    useEffect(() => {
        if (user) {
            fetchWorkflows();
            fetchCampaignDefaults();
            fetchTelephonyConfigs();
        }
    }, [fetchWorkflows, fetchCampaignDefaults, fetchTelephonyConfigs, user]);

    const effectiveLimit = orgConcurrentLimit;

    // Handle form submission
    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setCreateError(null);

        if (!campaignName || !selectedWorkflowId || !sourceId || !selectedTelephonyConfigId) {
            toast.error('Please fill in all fields');
            return;
        }

        const maxConcurrencyValue = maxConcurrency ? parseInt(maxConcurrency) : null;
        if (maxConcurrencyValue !== null) {
            if (isNaN(maxConcurrencyValue) || maxConcurrencyValue < 1 || maxConcurrencyValue > orgConcurrentLimit) {
                toast.error(`Max concurrent calls must be between 1 and ${orgConcurrentLimit}`);
                return;
            }
        }

        setIsSubmitting(true);

        try {
            const accessToken = await getAccessToken();

            const retryConfig = {
                enabled: retryEnabled,
                max_retries: parseInt(maxRetries) || 2,
                retry_delay_seconds: parseInt(retryDelaySeconds) || 120,
                retry_on_busy: retryOnBusy,
                retry_on_no_answer: retryOnNoAnswer,
                retry_on_voicemail: retryOnVoicemail,
            };

            const timezoneValue = getTimezoneValue(scheduleTimezone);
            const scheduleConfig = scheduleEnabled && timeSlots.length > 0
                ? {
                    enabled: true,
                    timezone: timezoneValue,
                    slots: timeSlots,
                }
                : undefined;

            const circuitBreakerConfig = {
                enabled: circuitBreakerEnabled,
                failure_threshold: (parseInt(circuitBreakerFailureThreshold) || 50) / 100,
                window_seconds: parseInt(circuitBreakerWindowSeconds) || 120,
                min_calls_in_window: parseInt(circuitBreakerMinCalls) || 5,
            };

            const response = await createCampaignApiV1CampaignCreatePost({
                body: {
                    name: campaignName,
                    workflow_id: parseInt(selectedWorkflowId),
                    source_type: sourceType,
                    source_id: sourceId,
                    telephony_configuration_id: parseInt(selectedTelephonyConfigId),
                    retry_config: retryConfig,
                    max_concurrency: maxConcurrencyValue,
                    schedule_config: scheduleConfig,
                    circuit_breaker: circuitBreakerConfig,
                    source_config: sourceConfig,
                    auto_sync_enabled: autoSyncEnabled,
                    auto_sync_interval_minutes: autoSyncIntervalMinutes,
                    auto_sync_only_new: autoSyncOnlyNew,
                },
                headers: {
                    'Authorization': `Bearer ${accessToken}`,
                }
            });

            if (response.error) {
                const errorDetail = (response.error as { detail?: string })?.detail;
                const errorMessage = errorDetail || 'Failed to create campaign';
                setCreateError(errorMessage);
                toast.error(errorMessage);
                return;
            }

            if (response.data) {
                toast.success('Campaign created successfully');
                router.push(`/campaigns/${response.data.id}`);
            }
        } catch (error: unknown) {
            console.error('Failed to create campaign:', error);
            const errorMessage = 'Failed to create campaign';
            setCreateError(errorMessage);
            toast.error(errorMessage);
        } finally {
            setIsSubmitting(false);
        }
    };

    const handleBack = () => {
        router.push('/campaigns');
    };

    return (
        <div className="flex flex-col h-full text-gray-900 dark:text-white font-sans select-none relative" style={{ backgroundColor: '#161715' }}>
            {/* Top Sub-Header matching demo styling */}
            <header className="px-8 pt-6 pb-3 flex items-center justify-between sticky top-0 z-20 border-b border-gray-100 dark:border-[#282b26]" style={{ backgroundColor: '#161715' }}>
                <div className="flex items-center gap-3">
                    <button
                        onClick={handleBack}
                        className="p-1.5 rounded-lg text-gray-500 hover:bg-gray-100 dark:hover:bg-[#232621] hover:text-gray-900 dark:hover:text-white transition-colors cursor-pointer"
                        title="Back to Campaigns"
                    >
                        <ArrowLeft className="w-4 h-4 stroke-[2.2]" />
                    </button>
                    <div className="flex items-center gap-2 text-sm text-gray-400 dark:text-gray-400 font-medium">
                        <span
                            onClick={handleBack}
                            className="hover:text-gray-900 dark:hover:text-white cursor-pointer transition-colors"
                        >
                            Outbound campaigns
                        </span>
                        <span>/</span>
                        <span className="text-gray-900 dark:text-white font-semibold">New Campaign</span>
                    </div>
                </div>

                <button
                    onClick={handleBack}
                    className="px-4 py-2 bg-gray-100 dark:bg-[#1c1e1a] hover:bg-gray-200 dark:hover:bg-[#232621] text-gray-800 dark:text-gray-200 text-xs font-semibold rounded-full transition-all cursor-pointer"
                >
                    Cancel
                </button>
            </header>

            {/* Scrollable Form Workspace Container */}
            <div className="max-w-3xl w-full mx-auto px-8 pt-8 pb-16 flex flex-col gap-8">
                {/* Title Section */}
                <div className="space-y-1">
                    <h1 className="text-3xl font-normal text-gray-900 dark:text-white tracking-tight font-serif">
                        Campaign Details
                    </h1>
                    <p className="text-xs text-gray-500 dark:text-gray-400">
                        Configure your campaign settings and data source for automated outbound calling.
                    </p>
                </div>

                {/* Form Card */}
                <form
                    onSubmit={handleSubmit}
                    className="border border-gray-200/90 dark:border-[#282b26] rounded-2xl p-7 shadow-xs space-y-6"
                    style={{ backgroundColor: '#1C1E1A' }}
                >
                    {/* 1. Campaign Name */}
                    <div className="space-y-2">
                        <label htmlFor="campaign-name" className="text-xs font-bold text-gray-900 dark:text-white tracking-wide block">
                            Campaign Name
                        </label>
                        <input
                            id="campaign-name"
                            type="text"
                            placeholder="Enter campaign name"
                            value={campaignName}
                            onChange={(e) => setCampaignName(e.target.value)}
                            maxLength={255}
                            required
                            className="w-full px-4 py-2.5 bg-gray-50/70 dark:bg-[#1c1e1a] border border-gray-200 dark:border-[#282b26] rounded-xl text-xs text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-gray-500 focus:bg-white dark:focus:bg-[#1c1e1a] focus:outline-hidden focus:ring-2 focus:ring-black/10 dark:focus:ring-white/10 transition-all font-normal"
                        />
                        <p className="text-[11px] text-gray-400 dark:text-gray-500">
                            Choose a descriptive name for your campaign
                        </p>
                    </div>

                    {/* 2. Workflow Selector */}
                    <div className="space-y-2">
                        <label htmlFor="workflow" className="text-xs font-bold text-gray-900 dark:text-white tracking-wide block">
                            Workflow
                        </label>
                        <div className="relative">
                            <select
                                id="workflow"
                                value={selectedWorkflowId}
                                onChange={(e) => setSelectedWorkflowId(e.target.value)}
                                required
                                className="w-full px-4 py-2.5 bg-gray-50/70 dark:bg-[#1c1e1a] border border-gray-200 dark:border-[#282b26] rounded-xl text-xs text-gray-900 dark:text-white appearance-none focus:bg-white dark:focus:bg-[#1c1e1a] focus:outline-hidden focus:ring-2 focus:ring-black/10 dark:focus:ring-white/10 transition-all cursor-pointer"
                            >
                                <option value="" disabled className="bg-white dark:bg-[#1c1e1a] text-gray-400">
                                    {isLoadingWorkflows ? 'Loading workflows...' : 'Select a workflow'}
                                </option>
                                {workflows.map((workflow) => (
                                    <option key={workflow.id} value={workflow.id.toString()} className="bg-white dark:bg-[#1c1e1a] text-gray-900 dark:text-white">
                                        {workflow.name} (#{workflow.id})
                                    </option>
                                ))}
                            </select>
                            <ChevronDown className="w-4 h-4 text-gray-400 dark:text-gray-500 absolute right-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                        </div>
                        <p className="text-[11px] text-gray-400 dark:text-gray-500">
                            Select the workflow to execute for each row in the data source
                        </p>
                    </div>

                    {/* 3. Telephony Configuration */}
                    <div className="space-y-2">
                        <label htmlFor="telephony-config" className="text-xs font-bold text-gray-900 dark:text-white tracking-wide block">
                            Telephony Configuration
                        </label>
                        {!isLoadingTelephonyConfigs && telephonyConfigs.length === 0 ? (
                            <div className="rounded-xl border border-dashed border-gray-200 dark:border-[#282b26] p-4 text-xs text-gray-500 dark:text-gray-400 bg-gray-50/50 dark:bg-[#1c1e1a]">
                                No telephony configurations yet.{' '}
                                <Link
                                    href="/telephony-configurations"
                                    className="underline text-gray-900 dark:text-white font-medium"
                                >
                                    Add one
                                </Link>{' '}
                                to create a campaign.
                            </div>
                        ) : (
                            <div className="relative">
                                <select
                                    id="telephony-config"
                                    value={selectedTelephonyConfigId}
                                    onChange={(e) => setSelectedTelephonyConfigId(e.target.value)}
                                    required
                                    className="w-full px-4 py-2.5 bg-gray-50/70 dark:bg-[#1c1e1a] border border-gray-200 dark:border-[#282b26] rounded-xl text-xs text-gray-900 dark:text-white appearance-none focus:bg-white dark:focus:bg-[#1c1e1a] focus:outline-hidden focus:ring-2 focus:ring-black/10 dark:focus:ring-white/10 transition-all cursor-pointer"
                                >
                                    <option value="" disabled className="bg-white dark:bg-[#1c1e1a] text-gray-400">
                                        {isLoadingTelephonyConfigs ? 'Loading configurations...' : 'Select a telephony configuration'}
                                    </option>
                                    {telephonyConfigs.map((config) => (
                                        <option key={config.id} value={config.id.toString()} className="bg-white dark:bg-[#1c1e1a] text-gray-900 dark:text-white">
                                            {config.name} ({config.provider}){config.is_default_outbound ? ' — default' : ''}
                                        </option>
                                    ))}
                                </select>
                                <ChevronDown className="w-4 h-4 text-gray-400 dark:text-gray-500 absolute right-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                            </div>
                        )}
                        <p className="text-[11px] text-gray-400 dark:text-gray-500">
                            Outbound calls for this campaign will use this configuration&apos;s caller IDs
                        </p>
                    </div>

                    {/* 4. Contact Data Source Selector */}
                    <ContactSourceSelector
                        sourceType={sourceType}
                        onSourceTypeChange={setSourceType}
                        sourceId={sourceId}
                        onSourceIdChange={setSourceId}
                        sourceConfig={sourceConfig}
                        onSourceConfigChange={setSourceConfig}
                        autoSyncEnabled={autoSyncEnabled}
                        onAutoSyncEnabledChange={setAutoSyncEnabled}
                        autoSyncIntervalMinutes={autoSyncIntervalMinutes}
                        onAutoSyncIntervalMinutesChange={setAutoSyncIntervalMinutes}
                        autoSyncOnlyNew={autoSyncOnlyNew}
                        onAutoSyncOnlyNewChange={setAutoSyncOnlyNew}
                        getAccessToken={getAccessToken}
                    />

                    {/* 5. Advanced Settings Accordion */}
                    <Collapsible
                        open={showAdvancedSettings}
                        onOpenChange={setShowAdvancedSettings}
                        className="border border-gray-200/70 dark:border-[#282b26] rounded-xl overflow-hidden"
                    >
                        <CollapsibleTrigger
                            className="w-full px-4 py-3 flex items-center justify-between text-xs font-bold text-gray-900 dark:text-white transition-colors cursor-pointer hover:brightness-110"
                            style={{ backgroundColor: '#1C1E1A' }}
                        >
                            <div className="flex items-center gap-2">
                                <Sliders className="w-4 h-4 text-gray-500 dark:text-gray-400" />
                                <span>Advanced Settings</span>
                            </div>
                            <ChevronRight
                                className={`w-4 h-4 text-gray-400 dark:text-gray-500 transition-transform duration-200 ${
                                    showAdvancedSettings ? "rotate-90" : ""
                                }`}
                            />
                        </CollapsibleTrigger>
                        <CollapsibleContent
                            className="p-4 border-t border-gray-200/70 dark:border-[#282b26]"
                            style={{ backgroundColor: '#1C1E1A' }}
                        >
                            <CampaignAdvancedSettings
                                maxConcurrency={maxConcurrency}
                                onMaxConcurrencyChange={setMaxConcurrency}
                                effectiveLimit={effectiveLimit}
                                orgConcurrentLimit={orgConcurrentLimit}
                                fromNumbersCount={fromNumbersCount}
                                retryEnabled={retryEnabled}
                                onRetryEnabledChange={setRetryEnabled}
                                maxRetries={maxRetries}
                                onMaxRetriesChange={setMaxRetries}
                                retryDelaySeconds={retryDelaySeconds}
                                onRetryDelaySecondsChange={setRetryDelaySeconds}
                                retryOnBusy={retryOnBusy}
                                onRetryOnBusyChange={setRetryOnBusy}
                                retryOnNoAnswer={retryOnNoAnswer}
                                onRetryOnNoAnswerChange={setRetryOnNoAnswer}
                                retryOnVoicemail={retryOnVoicemail}
                                onRetryOnVoicemailChange={setRetryOnVoicemail}
                                scheduleEnabled={scheduleEnabled}
                                onScheduleEnabledChange={setScheduleEnabled}
                                scheduleTimezone={scheduleTimezone}
                                onScheduleTimezoneChange={setScheduleTimezone}
                                timeSlots={timeSlots}
                                onTimeSlotsChange={setTimeSlots}
                                circuitBreakerEnabled={circuitBreakerEnabled}
                                onCircuitBreakerEnabledChange={setCircuitBreakerEnabled}
                                circuitBreakerFailureThreshold={circuitBreakerFailureThreshold}
                                onCircuitBreakerFailureThresholdChange={setCircuitBreakerFailureThreshold}
                                circuitBreakerWindowSeconds={circuitBreakerWindowSeconds}
                                onCircuitBreakerWindowSecondsChange={setCircuitBreakerWindowSeconds}
                                circuitBreakerMinCalls={circuitBreakerMinCalls}
                                onCircuitBreakerMinCallsChange={setCircuitBreakerMinCalls}
                            />
                        </CollapsibleContent>
                    </Collapsible>

                    {createError && (
                        <div className="rounded-xl bg-red-500/10 border border-red-500/20 p-3 text-xs text-red-600 dark:text-red-400 font-semibold">
                            {createError}
                        </div>
                    )}

                    {/* Footer Submit & Cancel */}
                    <div className="pt-4 border-t border-gray-100 dark:border-[#282b26] flex items-center gap-3">
                        <button
                            type="submit"
                            disabled={isSubmitting || !campaignName || !selectedWorkflowId || !sourceId || !selectedTelephonyConfigId}
                            className="px-6 py-2.5 bg-black dark:bg-[#bcf0da] hover:bg-gray-800 dark:hover:bg-[#a5e9cd] text-white dark:text-[#082117] text-xs font-bold rounded-full shadow-xs transition-all active:scale-[0.98] cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                            {isSubmitting ? 'Creating...' : 'Create Campaign'}
                        </button>

                        <button
                            type="button"
                            onClick={handleBack}
                            disabled={isSubmitting}
                            className="px-5 py-2.5 bg-gray-100 dark:bg-[#1c1e1a] hover:bg-gray-200 dark:hover:bg-[#232621] text-gray-800 dark:text-gray-200 text-xs font-semibold rounded-full transition-all cursor-pointer"
                        >
                            Cancel
                        </button>
                    </div>
                </form>
            </div>
        </div>
    );
}
