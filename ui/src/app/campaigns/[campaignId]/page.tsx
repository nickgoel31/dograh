"use client";

import { format } from 'date-fns';
import { AlertCircle, AlertTriangle, ArrowLeft, CalendarIcon, Check, Clock, Download, Info, Pause, Pencil, Phone, Play, RefreshCw, X } from 'lucide-react';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';

import {
    downloadCampaignReportApiV1CampaignCampaignIdReportGet,
    getCampaignApiV1CampaignCampaignIdGet,
    getCampaignSourceDownloadUrlApiV1CampaignCampaignIdSourceDownloadUrlGet,
    pauseCampaignApiV1CampaignCampaignIdPausePost,
    redialCampaignApiV1CampaignCampaignIdRedialPost,
    resumeCampaignApiV1CampaignCampaignIdResumePost,
    startCampaignApiV1CampaignCampaignIdStartPost,
} from '@/client/sdk.gen';
import type { CampaignResponse } from '@/client/types.gen';
import { Button } from '@/components/ui/button';
import { Calendar } from '@/components/ui/calendar';
import { Checkbox } from '@/components/ui/checkbox';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Separator } from '@/components/ui/separator';
import { CampaignRuns } from '@/components/workflow-runs';
import { useAuth } from '@/lib/auth';
import { cn } from '@/lib/utils';

const STATE_CONFIG: Record<string, { label: string; dot: string; bg: string; text: string }> = {
    created:   { label: 'Created',   dot: 'bg-zinc-400', bg: 'bg-zinc-800/40 border-zinc-700/50', text: 'text-zinc-300' },
    running:   { label: 'Running',   dot: 'bg-emerald-400 animate-pulse', bg: 'bg-emerald-900/30 border-emerald-700/50', text: 'text-emerald-400' },
    paused:    { label: 'Paused',    dot: 'bg-amber-400', bg: 'bg-amber-900/30 border-amber-700/50', text: 'text-amber-400' },
    completed: { label: 'Completed', dot: 'bg-emerald-500', bg: 'bg-emerald-900/30 border-emerald-700/50', text: 'text-emerald-400' },
    failed:    { label: 'Failed',    dot: 'bg-rose-500', bg: 'bg-rose-900/30 border-rose-700/50', text: 'text-rose-400' },
};

function StateBadge({ state }: { state: string }) {
    const cfg = STATE_CONFIG[state] ?? STATE_CONFIG.created;
    return (
        <span className={cn("inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold border", cfg.bg, cfg.text)}>
            <span className={cn("w-1.5 h-1.5 rounded-full", cfg.dot)} />
            {cfg.label}
        </span>
    );
}

export default function CampaignDetailPage() {
    const { user, getAccessToken, redirectToLogin, loading } = useAuth();
    const router = useRouter();
    const params = useParams();
    const searchParams = useSearchParams();
    const campaignId = parseInt(params.campaignId as string);

    useEffect(() => {
        if (!loading && !user) {
            redirectToLogin();
        }
    }, [loading, user, redirectToLogin]);

    const [campaign, setCampaign] = useState<CampaignResponse | null>(null);
    const [isLoadingCampaign, setIsLoadingCampaign] = useState(true);

    const [isExecutingAction, setIsExecutingAction] = useState(false);
    const [isDownloadingReport, setIsDownloadingReport] = useState(false);

    const [reportStartDate, setReportStartDate] = useState<Date | undefined>(undefined);
    const [reportStartTime, setReportStartTime] = useState('00:00');
    const [reportEndDate, setReportEndDate] = useState<Date | undefined>(undefined);
    const [reportEndTime, setReportEndTime] = useState('23:59');
    const [isReportPopoverOpen, setIsReportPopoverOpen] = useState(false);

    const [isRedialDialogOpen, setIsRedialDialogOpen] = useState(false);
    const [redialName, setRedialName] = useState('');
    const [redialOnVoicemail, setRedialOnVoicemail] = useState(true);
    const [redialOnNoAnswer, setRedialOnNoAnswer] = useState(true);
    const [redialOnBusy, setRedialOnBusy] = useState(true);
    const [isRedialing, setIsRedialing] = useState(false);

    const fetchCampaign = useCallback(async () => {
        if (!user) return;
        setIsLoadingCampaign(true);
        try {
            const accessToken = await getAccessToken();
            const response = await getCampaignApiV1CampaignCampaignIdGet({
                path: { campaign_id: campaignId },
                headers: { 'Authorization': `Bearer ${accessToken}` }
            });

            if (response.data) {
                setCampaign(response.data);
            }
        } catch (error) {
            console.error('Failed to fetch campaign:', error);
            toast.error('Failed to load campaign details');
        } finally {
            setIsLoadingCampaign(false);
        }
    }, [user, getAccessToken, campaignId]);

    useEffect(() => {
        fetchCampaign();
    }, [fetchCampaign]);

    const handleBack = () => {
        router.push('/campaigns');
    };

    const handleWorkflowClick = () => {
        if (campaign) {
            router.push(`/workflow/${campaign.workflow_id}`);
        }
    };

    const handleDownloadCsv = async () => {
        if (!user || !campaign || campaign.source_type !== 'csv') return;

        try {
            const accessToken = await getAccessToken();
            const response = await getCampaignSourceDownloadUrlApiV1CampaignCampaignIdSourceDownloadUrlGet({
                path: { campaign_id: campaignId },
                headers: { 'Authorization': `Bearer ${accessToken}` }
            });

            if (response.data?.download_url) {
                window.open(response.data.download_url, '_blank');
            } else {
                toast.error('Failed to get download URL');
            }
        } catch (error) {
            console.error('Failed to download CSV:', error);
            toast.error('Failed to download CSV file');
        }
    };

    const buildDateTime = (date: Date | undefined, time: string): string | undefined => {
        if (!date) return undefined;
        const [hours, minutes] = time.split(':').map(Number);
        const combined = new Date(date);
        combined.setHours(hours, minutes, 0, 0);
        return combined.toISOString();
    };

    const handleDownloadReport = async () => {
        if (!user) return;
        setIsDownloadingReport(true);
        setIsReportPopoverOpen(false);
        try {
            const accessToken = await getAccessToken();
            const startDate = buildDateTime(reportStartDate, reportStartTime);
            const endDate = buildDateTime(reportEndDate, reportEndTime);

            const response = await downloadCampaignReportApiV1CampaignCampaignIdReportGet({
                path: { campaign_id: campaignId },
                query: { start_date: startDate, end_date: endDate },
                headers: { 'Authorization': `Bearer ${accessToken}` },
                parseAs: 'blob',
            });

            if (response.data) {
                const blob = response.data as Blob;
                const url = window.URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                a.download = `campaign_${campaignId}_report.csv`;
                document.body.appendChild(a);
                a.click();
                a.remove();
                window.URL.revokeObjectURL(url);
            } else {
                toast.error('Failed to download report');
            }
        } catch (error) {
            console.error('Failed to download report:', error);
            toast.error('Failed to download report');
        } finally {
            setIsDownloadingReport(false);
        }
    };

    const handleClearDateRange = () => {
        setReportStartDate(undefined);
        setReportStartTime('00:00');
        setReportEndDate(undefined);
        setReportEndTime('23:59');
    };

    const handleStart = async () => {
        if (!user) return;
        setIsExecutingAction(true);
        try {
            const accessToken = await getAccessToken();
            const response = await startCampaignApiV1CampaignCampaignIdStartPost({
                path: { campaign_id: campaignId },
                headers: { 'Authorization': `Bearer ${accessToken}` }
            });

            if (response.data) {
                setCampaign(response.data);
                toast.success('Campaign started');
            } else if (response.error) {
                let errorMsg = 'Failed to start campaign';
                if (typeof response.error === 'string') {
                    errorMsg = response.error;
                } else if (response.error && typeof response.error === 'object') {
                    errorMsg = (response.error as unknown as { detail?: string }).detail || JSON.stringify(response.error);
                }
                toast.error(errorMsg);
            }
        } catch (error) {
            console.error('Failed to start campaign:', error);
            toast.error('Failed to start campaign');
        } finally {
            setIsExecutingAction(false);
        }
    };

    const handleResume = async () => {
        if (!user) return;
        setIsExecutingAction(true);
        try {
            const accessToken = await getAccessToken();
            const response = await resumeCampaignApiV1CampaignCampaignIdResumePost({
                path: { campaign_id: campaignId },
                headers: { 'Authorization': `Bearer ${accessToken}` }
            });

            if (response.data) {
                setCampaign(response.data);
                toast.success('Campaign resumed');
            } else if (response.error) {
                let errorMsg = 'Failed to resume campaign';
                if (typeof response.error === 'string') {
                    errorMsg = response.error;
                } else if (response.error && typeof response.error === 'object') {
                    errorMsg = (response.error as unknown as { detail?: string }).detail || JSON.stringify(response.error);
                }
                toast.error(errorMsg);
            }
        } catch (error) {
            console.error('Failed to resume campaign:', error);
            toast.error('Failed to resume campaign');
        } finally {
            setIsExecutingAction(false);
        }
    };

    const openRedialDialog = () => {
        if (!campaign) return;
        setRedialName(`${campaign.name} (Redial)`);
        setRedialOnVoicemail(true);
        setRedialOnNoAnswer(true);
        setRedialOnBusy(true);
        setIsRedialDialogOpen(true);
    };

    const handleRedial = async () => {
        if (!user || !campaign) return;
        if (!redialOnVoicemail && !redialOnNoAnswer && !redialOnBusy) {
            toast.error('Select at least one reason to redial');
            return;
        }
        setIsRedialing(true);
        try {
            const accessToken = await getAccessToken();
            const response = await redialCampaignApiV1CampaignCampaignIdRedialPost({
                path: { campaign_id: campaignId },
                body: {
                    name: redialName || null,
                    retry_on_voicemail: redialOnVoicemail,
                    retry_on_no_answer: redialOnNoAnswer,
                    retry_on_busy: redialOnBusy,
                },
                headers: { 'Authorization': `Bearer ${accessToken}` }
            });

            if (response.data) {
                toast.success('Redial campaign created');
                setIsRedialDialogOpen(false);
                router.push(`/campaigns/${response.data.id}`);
            } else if (response.error) {
                let errorMsg = 'Failed to create redial campaign';
                if (typeof response.error === 'string') {
                    errorMsg = response.error;
                } else if (response.error && typeof response.error === 'object') {
                    errorMsg = (response.error as unknown as { detail?: string }).detail || JSON.stringify(response.error);
                }
                toast.error(errorMsg);
            }
        } catch (error) {
            console.error('Failed to redial campaign:', error);
            toast.error('Failed to create redial campaign');
        } finally {
            setIsRedialing(false);
        }
    };

    const handlePause = async () => {
        if (!user) return;
        setIsExecutingAction(true);
        try {
            const accessToken = await getAccessToken();
            const response = await pauseCampaignApiV1CampaignCampaignIdPausePost({
                path: { campaign_id: campaignId },
                headers: { 'Authorization': `Bearer ${accessToken}` }
            });

            if (response.data) {
                setCampaign(response.data);
                toast.success('Campaign paused');
            }
        } catch (error) {
            console.error('Failed to pause campaign:', error);
            toast.error('Failed to pause campaign');
        } finally {
            setIsExecutingAction(false);
        }
    };

    const formatDate = (dateString: string) => {
        return new Date(dateString).toLocaleDateString();
    };

    const formatDateTime = (dateString: string) => {
        return new Date(dateString).toLocaleString();
    };

    const canEdit = campaign && ['created', 'running', 'paused'].includes(campaign.state);
    const sortedLogs = (campaign?.logs ?? []).slice().reverse();

    const getLogIcon = (level: string) => {
        switch (level) {
            case 'error':
                return <AlertCircle className="h-4 w-4 text-rose-400" />;
            case 'warning':
                return <AlertTriangle className="h-4 w-4 text-amber-400" />;
            default:
                return <Info className="h-4 w-4 text-sky-400" />;
        }
    };

    const formatLogTimestamp = (ts: string) => {
        const d = new Date(ts);
        if (isNaN(d.getTime())) return ts;
        return d.toLocaleString();
    };

    const renderActionButton = () => {
        if (!campaign || isExecutingAction) return null;

        const editButton = canEdit ? (
            <button
                onClick={() => router.push(`/campaigns/${campaignId}/edit`)}
                className="px-4 py-2 bg-[#1a1c18] hover:bg-[#232621] border border-[#2e312b] text-[#f2f4f0] font-semibold text-xs rounded-full transition-all flex items-center gap-2 cursor-pointer"
            >
                <Pencil className="h-3.5 w-3.5" />
                <span>Edit Campaign</span>
            </button>
        ) : null;

        switch (campaign.state) {
            case 'created':
                return (
                    <div className="flex items-center gap-2">
                        {editButton}
                        <button
                            onClick={handleStart}
                            disabled={isExecutingAction}
                            className="px-5 py-2 bg-black dark:bg-[#bcf0da] hover:bg-gray-800 dark:hover:bg-[#a5e9cc] text-white dark:text-[#082117] font-bold text-xs rounded-full transition-all shadow-xs flex items-center gap-2 cursor-pointer disabled:opacity-50"
                        >
                            <Play className="h-3.5 w-3.5" />
                            <span>Start Campaign</span>
                        </button>
                    </div>
                );
            case 'running':
                return (
                    <div className="flex items-center gap-2">
                        {editButton}
                        <button
                            onClick={handlePause}
                            disabled={isExecutingAction}
                            className="px-5 py-2 bg-amber-600 hover:bg-amber-500 text-white font-bold text-xs rounded-full transition-all shadow-xs flex items-center gap-2 cursor-pointer disabled:opacity-50"
                        >
                            <Pause className="h-3.5 w-3.5" />
                            <span>Pause Campaign</span>
                        </button>
                    </div>
                );
            case 'paused':
                return (
                    <div className="flex items-center gap-2">
                        {editButton}
                        <button
                            onClick={handleResume}
                            disabled={isExecutingAction}
                            className="px-5 py-2 bg-black dark:bg-[#bcf0da] hover:bg-gray-800 dark:hover:bg-[#a5e9cc] text-white dark:text-[#082117] font-bold text-xs rounded-full transition-all shadow-xs flex items-center gap-2 cursor-pointer disabled:opacity-50"
                        >
                            <RefreshCw className="h-3.5 w-3.5" />
                            <span>Resume Campaign</span>
                        </button>
                    </div>
                );
            case 'completed':
                if (campaign.redialed_campaign_id) return null;
                return (
                    <button
                        onClick={openRedialDialog}
                        className="px-5 py-2 bg-black dark:bg-[#bcf0da] hover:bg-gray-800 dark:hover:bg-[#a5e9cc] text-white dark:text-[#082117] font-bold text-xs rounded-full transition-all shadow-xs flex items-center gap-2 cursor-pointer"
                    >
                        <Phone className="h-3.5 w-3.5" />
                        <span>Redial Campaign</span>
                    </button>
                );
            default:
                return null;
        }
    };

    if (isLoadingCampaign) {
        return (
            <div className="w-full py-16 flex items-center justify-center min-h-screen bg-[#161715]">
                <div className="space-y-4">
                    <div className="h-8 bg-[#1c1e1a] rounded-xl w-64 animate-pulse"></div>
                    <div className="h-64 bg-[#1c1e1a] rounded-xl w-96 animate-pulse"></div>
                </div>
            </div>
        );
    }

    if (!campaign) {
        return (
            <div className="w-full py-16 flex items-center justify-center min-h-screen bg-[#161715]">
                <p className="text-center text-[#9ca39a] text-xs font-semibold">Campaign not found</p>
            </div>
        );
    }

    return (
        <div className="w-full min-h-screen p-6 max-w-5xl mx-auto space-y-6 text-[#f2f4f0]" style={{ backgroundColor: '#161715' }}>
            <div>
                <button
                    onClick={handleBack}
                    className="mb-6 px-4 py-2 bg-[#1a1c18] hover:bg-[#232621] border border-[#2e312b] text-[#9ca39a] hover:text-white text-xs font-semibold rounded-full transition-all inline-flex items-center gap-2 cursor-pointer"
                >
                    <ArrowLeft className="h-4 w-4" />
                    <span>Back to Campaigns</span>
                </button>
                
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
                    <div>
                        <h1 className="text-2xl font-bold tracking-tight text-white mb-2">{campaign.name}</h1>
                        <div className="flex items-center gap-3">
                            <StateBadge state={campaign.state} />
                            <span className="text-xs text-[#9ca39a]">
                                Created {formatDate(campaign.created_at)}
                            </span>
                        </div>
                    </div>

                    <div className="flex items-center gap-2">
                        <Popover open={isReportPopoverOpen} onOpenChange={setIsReportPopoverOpen}>
                            <PopoverTrigger asChild>
                                <button className="px-4 py-2 bg-[#1a1c18] hover:bg-[#232621] border border-[#2e312b] text-[#f2f4f0] font-semibold text-xs rounded-full transition-all flex items-center gap-2 cursor-pointer disabled:opacity-50">
                                    <Download className="h-3.5 w-3.5" />
                                    <span>Download Report</span>
                                </button>
                            </PopoverTrigger>
                            <PopoverContent className="w-auto p-4 border border-[#282b26] text-white rounded-2xl shadow-2xl" align="end" style={{ backgroundColor: '#161715' }}>
                                <div className="space-y-4">
                                    <div className="text-xs font-bold">Filter by date range</div>
                                    <div className="grid gap-3">
                                        <div className="space-y-1.5">
                                            <Label className="text-[11px] text-[#9ca39a]">From</Label>
                                            <div className="flex gap-2">
                                                <Popover>
                                                    <PopoverTrigger asChild>
                                                        <Button variant="outline" size="sm" className="w-[140px] justify-start text-left font-normal bg-[#1a1c18] border-[#2e312b] text-xs h-8 text-white rounded-xl">
                                                            <CalendarIcon className="mr-2 h-3.5 w-3.5 text-[#9ca39a]" />
                                                            {reportStartDate ? format(reportStartDate, 'MMM dd, yyyy') : 'Start date'}
                                                        </Button>
                                                    </PopoverTrigger>
                                                    <PopoverContent className="w-auto p-0 bg-[#161715] border border-[#282b26]" align="start">
                                                        <Calendar
                                                            mode="single"
                                                            selected={reportStartDate}
                                                            onSelect={setReportStartDate}
                                                            disabled={(date) => reportEndDate ? date > reportEndDate : false}
                                                            className="bg-[#161715] text-white"
                                                        />
                                                    </PopoverContent>
                                                </Popover>
                                                <Input
                                                    type="time"
                                                    value={reportStartTime}
                                                    onChange={(e) => setReportStartTime(e.target.value)}
                                                    className="w-[100px] h-8 text-xs bg-[#1a1c18] border-[#2e312b] text-white rounded-xl"
                                                />
                                            </div>
                                        </div>
                                        <div className="space-y-1.5">
                                            <Label className="text-[11px] text-[#9ca39a]">To</Label>
                                            <div className="flex gap-2">
                                                <Popover>
                                                    <PopoverTrigger asChild>
                                                        <Button variant="outline" size="sm" className="w-[140px] justify-start text-left font-normal bg-[#1a1c18] border-[#2e312b] text-xs h-8 text-white rounded-xl">
                                                            <CalendarIcon className="mr-2 h-3.5 w-3.5 text-[#9ca39a]" />
                                                            {reportEndDate ? format(reportEndDate, 'MMM dd, yyyy') : 'End date'}
                                                        </Button>
                                                    </PopoverTrigger>
                                                    <PopoverContent className="w-auto p-0 bg-[#161715] border border-[#282b26]" align="start">
                                                        <Calendar
                                                            mode="single"
                                                            selected={reportEndDate}
                                                            onSelect={setReportEndDate}
                                                            disabled={(date) => reportStartDate ? date < reportStartDate : false}
                                                            className="bg-[#161715] text-white"
                                                        />
                                                    </PopoverContent>
                                                </Popover>
                                                <Input
                                                    type="time"
                                                    value={reportEndTime}
                                                    onChange={(e) => setReportEndTime(e.target.value)}
                                                    className="w-[100px] h-8 text-xs bg-[#1a1c18] border-[#2e312b] text-white rounded-xl"
                                                />
                                            </div>
                                        </div>
                                    </div>
                                    <Separator className="bg-[#282b26]" />
                                    <div className="flex justify-between gap-2">
                                        <button onClick={handleClearDateRange} className="text-xs text-[#9ca39a] hover:text-white px-2 py-1">
                                            Clear
                                        </button>
                                        <button onClick={handleDownloadReport} disabled={isDownloadingReport} className="bg-[#8b5cf6] hover:bg-[#7c3aed] text-white font-bold text-xs h-8 px-4 rounded-xl">
                                            {reportStartDate || reportEndDate ? 'Download Filtered' : 'Download All'}
                                        </button>
                                    </div>
                                </div>
                            </PopoverContent>
                        </Popover>
                        {renderActionButton()}
                    </div>
                </div>
            </div>

            {/* Campaign Details Card */}
            <div className="border border-[#282b26] rounded-2xl p-6 shadow-2xs space-y-5" style={{ backgroundColor: '#1C1E1A' }}>
                <div className="pb-3 border-b border-[#282b26]">
                    <h2 className="text-lg font-serif font-normal text-white">Campaign Details</h2>
                    <p className="text-xs text-[#9ca39a]">Configuration and source information</p>
                </div>
                <dl className="grid grid-cols-1 sm:grid-cols-2 gap-6">
                    <div>
                        <dt className="text-xs font-semibold text-[#9ca39a]">Workflow</dt>
                        <dd className="mt-1">
                            <button
                                onClick={handleWorkflowClick}
                                className="text-xs font-semibold text-[#8b5cf6] hover:underline text-left cursor-pointer"
                            >
                                {campaign.workflow_name}
                            </button>
                        </dd>
                    </div>
                    <div>
                        <dt className="text-xs font-semibold text-[#9ca39a]">Source Type</dt>
                        <dd className="mt-1 text-sm font-semibold text-white capitalize">{campaign.source_type.replace('-', ' ')}</dd>
                    </div>
                    <div>
                        <dt className="text-xs font-semibold text-[#9ca39a]">
                            {campaign.source_type === 'csv' ? 'Source File' : 'Source Sheet'}
                        </dt>
                        <dd className="mt-1">
                            {campaign.source_type === 'csv' ? (
                                <button
                                    onClick={handleDownloadCsv}
                                    className="text-xs font-semibold text-[#8b5cf6] hover:underline text-left break-all cursor-pointer"
                                >
                                    {campaign.source_id.split('/').pop()}
                                </button>
                            ) : (
                                <a
                                    href={campaign.source_id}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="text-xs font-semibold text-[#8b5cf6] hover:underline break-all"
                                >
                                    {campaign.source_id}
                                </a>
                            )}
                        </dd>
                    </div>
                    <div>
                        <dt className="text-xs font-semibold text-[#9ca39a]">Telephony Configuration</dt>
                        <dd className="mt-1">
                            {campaign.telephony_configuration_id ? (
                                <button
                                    onClick={() => router.push(`/telephony-configurations/${campaign.telephony_configuration_id}`)}
                                    className="text-xs font-semibold text-[#8b5cf6] hover:underline text-left cursor-pointer"
                                >
                                    {campaign.telephony_configuration_name || `Configuration #${campaign.telephony_configuration_id}`}
                                </button>
                            ) : (
                                <span className="text-xs text-[#9ca39a]">Not assigned</span>
                            )}
                        </dd>
                    </div>
                    <div>
                        <dt className="text-xs font-semibold text-[#9ca39a]">State</dt>
                        <dd className="mt-1 text-sm font-semibold text-white capitalize">{campaign.state}</dd>
                    </div>
                    <div>
                        <dt className="text-xs font-semibold text-[#9ca39a]">Progress</dt>
                        <dd className="mt-1 text-sm font-semibold text-white font-mono">
                            {campaign.executed_count} / {campaign.total_queued_count}
                        </dd>
                    </div>
                    {campaign.parent_campaign_id && (
                        <div>
                            <dt className="text-xs font-semibold text-[#9ca39a]">Redial Of</dt>
                            <dd className="mt-1">
                                <button
                                    onClick={() => router.push(`/campaigns/${campaign.parent_campaign_id}`)}
                                    className="text-xs font-semibold text-[#8b5cf6] hover:underline text-left cursor-pointer"
                                >
                                    Campaign #{campaign.parent_campaign_id}
                                </button>
                            </dd>
                        </div>
                    )}
                    {campaign.redialed_campaign_id && (
                        <div>
                            <dt className="text-xs font-semibold text-[#9ca39a]">Redialed As</dt>
                            <dd className="mt-1">
                                <button
                                    onClick={() => router.push(`/campaigns/${campaign.redialed_campaign_id}`)}
                                    className="text-xs font-semibold text-[#8b5cf6] hover:underline text-left cursor-pointer"
                                >
                                    Campaign #{campaign.redialed_campaign_id}
                                </button>
                            </dd>
                        </div>
                    )}
                    {campaign.started_at && (
                        <div>
                            <dt className="text-xs font-semibold text-[#9ca39a]">Started At</dt>
                            <dd className="mt-1 text-sm font-semibold text-white">{formatDateTime(campaign.started_at)}</dd>
                        </div>
                    )}
                    {campaign.completed_at && (
                        <div>
                            <dt className="text-xs font-semibold text-[#9ca39a]">Completed At</dt>
                            <dd className="mt-1 text-sm font-semibold text-white">{formatDateTime(campaign.completed_at)}</dd>
                        </div>
                    )}
                </dl>
            </div>

            {/* Campaign Settings Card */}
            <div className="border border-[#282b26] rounded-2xl p-6 shadow-2xs space-y-5" style={{ backgroundColor: '#1C1E1A' }}>
                <div className="pb-3 border-b border-[#282b26]">
                    <h2 className="text-lg font-serif font-normal text-white">Campaign Settings</h2>
                    <p className="text-xs text-[#9ca39a]">Concurrency and retry configuration</p>
                </div>
                <div className="space-y-6">
                    <div>
                        <dt className="text-xs font-semibold text-[#9ca39a]">Max Concurrent Calls</dt>
                        <dd className="mt-1 text-sm font-semibold text-white">
                            {campaign.max_concurrency ? (
                                <span>{campaign.max_concurrency}</span>
                            ) : (
                                <span className="text-xs text-[#9ca39a]">Using organization default</span>
                            )}
                        </dd>
                    </div>

                    <Separator className="bg-[#282b26]" />

                    {/* Retry Configuration */}
                    <div className="space-y-4">
                        <div className="flex items-center justify-between">
                            <span className="text-xs font-semibold text-[#f2f4f0]">Retries Enabled</span>
                            {campaign.retry_config.enabled ? (
                                <span className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold border border-emerald-700/50 bg-emerald-900/30 text-emerald-400">
                                    <Check className="h-3.5 w-3.5" />
                                    Enabled
                                </span>
                            ) : (
                                <span className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold border border-zinc-700/50 bg-zinc-800/40 text-zinc-400">
                                    <X className="h-3.5 w-3.5" />
                                    Disabled
                                </span>
                            )}
                        </div>

                        {campaign.retry_config.enabled && (
                            <div className="grid grid-cols-2 md:grid-cols-3 gap-6 p-4 rounded-xl bg-[#1a1c18] border border-[#2e312b]">
                                <div>
                                    <dt className="text-xs font-semibold text-[#9ca39a]">Max Retries</dt>
                                    <dd className="mt-1 text-sm font-bold text-white">{campaign.retry_config.max_retries}</dd>
                                </div>
                                <div>
                                    <dt className="text-xs font-semibold text-[#9ca39a]">Retry Delay</dt>
                                    <dd className="mt-1 text-sm font-bold text-white">{campaign.retry_config.retry_delay_seconds}s</dd>
                                </div>
                                <div className="col-span-2 md:col-span-1">
                                    <dt className="text-xs font-semibold text-[#9ca39a]">Retry On</dt>
                                    <dd className="mt-1.5 flex flex-wrap gap-1.5">
                                        {campaign.retry_config.retry_on_busy && (
                                            <span className="px-2 py-0.5 text-[10px] font-bold rounded-md bg-[#252822] border border-[#2e312b] text-[#c8ccc5]">Busy</span>
                                        )}
                                        {campaign.retry_config.retry_on_no_answer && (
                                            <span className="px-2 py-0.5 text-[10px] font-bold rounded-md bg-[#252822] border border-[#2e312b] text-[#c8ccc5]">No Answer</span>
                                        )}
                                        {campaign.retry_config.retry_on_voicemail && (
                                            <span className="px-2 py-0.5 text-[10px] font-bold rounded-md bg-[#252822] border border-[#2e312b] text-[#c8ccc5]">Voicemail</span>
                                        )}
                                    </dd>
                                </div>
                            </div>
                        )}
                    </div>

                    <Separator className="bg-[#282b26]" />

                    {/* Call Schedule */}
                    <div className="space-y-4">
                        <div className="flex items-center justify-between">
                            <span className="text-xs font-semibold text-[#f2f4f0]">Call Schedule</span>
                            <div className="flex items-center gap-2">
                                {campaign.schedule_config?.enabled ? (
                                    <span className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold border border-purple-700/50 bg-purple-900/30 text-[#a78bfa]">
                                        <Clock className="h-3.5 w-3.5" />
                                        Enabled
                                    </span>
                                ) : (
                                    <span className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold border border-zinc-700/50 bg-zinc-800/40 text-zinc-400">
                                        <X className="h-3.5 w-3.5" />
                                        Not configured
                                    </span>
                                )}
                            </div>
                        </div>

                        {campaign.schedule_config?.enabled && (
                            <div className="space-y-4 p-4 rounded-xl bg-[#1a1c18] border border-[#2e312b]">
                                <div>
                                    <dt className="text-xs font-semibold text-[#9ca39a]">Timezone</dt>
                                    <dd className="mt-1 text-sm font-semibold text-white">{campaign.schedule_config.timezone.replace(/_/g, ' ')}</dd>
                                </div>
                                <div>
                                    <dt className="text-xs font-semibold text-[#9ca39a]">Time Slots</dt>
                                    <dd className="mt-1.5 flex flex-wrap gap-2">
                                        {campaign.schedule_config.slots.map((slot, index) => {
                                            const dayNames = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
                                            return (
                                                <div key={index} className="flex items-center gap-2 bg-[#252822] border border-[#2e312b] px-2.5 py-1 rounded-lg">
                                                    <span className="text-[10px] font-bold text-[#8b5cf6]">{dayNames[slot.day_of_week]}</span>
                                                    <span className="text-xs text-white font-semibold">{slot.start_time} - {slot.end_time}</span>
                                                </div>
                                            );
                                        })}
                                    </dd>
                                </div>
                            </div>
                        )}
                    </div>
                </div>
            </div>

            {/* Activity Log Card */}
            <div className="border border-[#282b26] rounded-2xl p-6 shadow-2xs space-y-5" style={{ backgroundColor: '#1C1E1A' }}>
                <div className="pb-3 border-b border-[#282b26]">
                    <h2 className="text-lg font-serif font-normal text-white">Activity Log</h2>
                    <p className="text-xs text-[#9ca39a]">Recent state transitions and failures. Newest first.</p>
                </div>
                {sortedLogs.length === 0 ? (
                    <p className="text-xs text-[#9ca39a] font-semibold py-2">No events recorded yet.</p>
                ) : (
                    <ul className="space-y-4">
                        {sortedLogs.map((entry, idx) => (
                            <li
                                key={`${entry.ts}-${idx}`}
                                className="flex gap-4 border-b border-[#282b26] last:border-b-0 pb-4 last:pb-0"
                            >
                                <div className="mt-0.5 shrink-0">{getLogIcon(entry.level)}</div>
                                <div className="flex-1 min-w-0">
                                    <div className="flex flex-wrap items-center gap-2">
                                        <span className={cn(
                                            "inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider border",
                                            entry.level === 'error' ? 'bg-rose-900/30 border-rose-700/50 text-rose-400' :
                                            entry.level === 'warning' ? 'bg-amber-900/30 border-amber-700/50 text-amber-400' :
                                            'bg-[#1a1c18] border-[#2e312b] text-[#9ca39a]'
                                        )}>
                                            {entry.level}
                                        </span>
                                        <code className="text-[11px] font-mono bg-[#1a1c18] px-1.5 py-0.5 rounded border border-[#2e312b] text-[#8b5cf6]">
                                            {entry.event}
                                        </code>
                                        <span className="text-[11px] text-[#9ca39a]">
                                            {formatLogTimestamp(entry.ts)}
                                        </span>
                                    </div>
                                    <p className="text-xs mt-2 text-[#c8ccc5] font-medium leading-relaxed break-words">{entry.message}</p>
                                    {entry.details && Object.keys(entry.details).length > 0 && (
                                        <details className="mt-2 bg-[#1a1c18] border border-[#2e312b] rounded-xl overflow-hidden">
                                            <summary className="text-[10px] font-semibold text-[#9ca39a] cursor-pointer hover:text-white p-2 select-none">
                                                Details
                                            </summary>
                                            <pre className="text-[10px] font-mono text-[#c8ccc5] p-3 overflow-x-auto whitespace-pre-wrap break-words border-t border-[#2e312b]">
                                                {JSON.stringify(entry.details, null, 2)}
                                            </pre>
                                        </details>
                                    )}
                                </div>
                            </li>
                        ))}
                    </ul>
                )}
            </div>

            {/* Workflow Runs List */}
            <CampaignRuns
                campaignId={campaignId}
                workflowId={campaign.workflow_id}
                searchParams={searchParams}
            />

            {/* Redial Dialog */}
            <Dialog open={isRedialDialogOpen} onOpenChange={setIsRedialDialogOpen}>
                <DialogContent className="border border-[#282b26] text-white rounded-2xl shadow-2xl p-6" style={{ backgroundColor: '#161715' }}>
                    <DialogHeader>
                        <DialogTitle className="text-base font-bold text-white">Redial Campaign</DialogTitle>
                        <DialogDescription className="text-xs text-[#9ca39a]">
                            Creates a new campaign that re-dials unique subscribers whose
                            last call ended with one of the selected outcomes.
                        </DialogDescription>
                    </DialogHeader>
                    <div className="space-y-4 py-2">
                        <div className="space-y-1.5">
                            <Label htmlFor="redial-name" className="text-xs font-semibold text-[#f2f4f0]">Name</Label>
                            <Input
                                id="redial-name"
                                value={redialName}
                                onChange={(e) => setRedialName(e.target.value)}
                                placeholder="Campaign name"
                                className="bg-[#1a1c18] border-[#2e312b] text-xs text-white rounded-xl h-10"
                            />
                        </div>
                        <div className="space-y-3 bg-[#1a1c18] border border-[#2e312b] rounded-xl p-4">
                            <Label className="text-xs font-semibold text-[#9ca39a] block mb-2">Redial when last call was</Label>
                            <div className="space-y-3">
                                <div className="flex items-center gap-3">
                                    <Checkbox
                                        id="redial-voicemail"
                                        checked={redialOnVoicemail}
                                        onCheckedChange={(v) => setRedialOnVoicemail(v === true)}
                                        className="border-[#2e312b] data-[state=checked]:bg-[#8b5cf6] data-[state=checked]:border-[#8b5cf6]"
                                    />
                                    <Label htmlFor="redial-voicemail" className="text-xs text-[#f2f4f0] font-semibold select-none cursor-pointer">
                                        Voicemail
                                    </Label>
                                </div>
                                <div className="flex items-center gap-3">
                                    <Checkbox
                                        id="redial-no-answer"
                                        checked={redialOnNoAnswer}
                                        onCheckedChange={(v) => setRedialOnNoAnswer(v === true)}
                                        className="border-[#2e312b] data-[state=checked]:bg-[#8b5cf6] data-[state=checked]:border-[#8b5cf6]"
                                    />
                                    <Label htmlFor="redial-no-answer" className="text-xs text-[#f2f4f0] font-semibold select-none cursor-pointer">
                                        No Answer
                                    </Label>
                                </div>
                                <div className="flex items-center gap-3">
                                    <Checkbox
                                        id="redial-busy"
                                        checked={redialOnBusy}
                                        onCheckedChange={(v) => setRedialOnBusy(v === true)}
                                        className="border-[#2e312b] data-[state=checked]:bg-[#8b5cf6] data-[state=checked]:border-[#8b5cf6]"
                                    />
                                    <Label htmlFor="redial-busy" className="text-xs text-[#f2f4f0] font-semibold select-none cursor-pointer">
                                        Busy
                                    </Label>
                                </div>
                            </div>
                        </div>
                    </div>
                    <DialogFooter className="gap-2">
                        <Button
                            variant="outline"
                            onClick={() => setIsRedialDialogOpen(false)}
                            disabled={isRedialing}
                            className="bg-[#1a1c18] border-[#2e312b] text-white hover:bg-[#232621] text-xs h-9 px-4 rounded-xl"
                        >
                            Cancel
                        </Button>
                        <Button onClick={handleRedial} disabled={isRedialing} className="bg-[#8b5cf6] hover:bg-[#7c3aed] text-white font-bold text-xs h-9 px-5 rounded-xl transition-all cursor-pointer">
                            {isRedialing ? 'Creating...' : 'Create Redial Campaign'}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </div>
    );
}
