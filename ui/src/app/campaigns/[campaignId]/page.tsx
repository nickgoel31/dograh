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
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Calendar } from '@/components/ui/calendar';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
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
    created:   { label: 'Created',   dot: 'bg-zinc-500', bg: 'bg-zinc-500/10 border-zinc-500/20',          text: 'text-zinc-400' },
    running:   { label: 'Running',   dot: 'bg-[#7c3aed] animate-pulse',  bg: 'bg-[#7c3aed]/10 border-[#7c3aed]/20',         text: 'text-[#a78bfa]' },
    paused:    { label: 'Paused',    dot: 'bg-amber-500', bg: 'bg-amber-500/10 border-amber-500/20',       text: 'text-amber-400' },
    completed: { label: 'Completed', dot: 'bg-emerald-500',   bg: 'bg-emerald-500/10 border-emerald-500/20',     text: 'text-emerald-400' },
    failed:    { label: 'Failed',    dot: 'bg-red-500',    bg: 'bg-red-500/10 border-red-500/20',     text: 'text-red-400' },
};

function StateBadge({ state }: { state: string }) {
    const cfg = STATE_CONFIG[state] ?? STATE_CONFIG.created;
    return (
        <span className={cn("inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold border", cfg.bg, cfg.text)}>
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

    // Redirect if not authenticated
    useEffect(() => {
        if (!loading && !user) {
            redirectToLogin();
        }
    }, [loading, user, redirectToLogin]);


    // Campaign state
    const [campaign, setCampaign] = useState<CampaignResponse | null>(null);
    const [isLoadingCampaign, setIsLoadingCampaign] = useState(true);

    // Action state
    const [isExecutingAction, setIsExecutingAction] = useState(false);
    const [isDownloadingReport, setIsDownloadingReport] = useState(false);

    // Report date range state
    const [reportStartDate, setReportStartDate] = useState<Date | undefined>(undefined);
    const [reportStartTime, setReportStartTime] = useState('00:00');
    const [reportEndDate, setReportEndDate] = useState<Date | undefined>(undefined);
    const [reportEndTime, setReportEndTime] = useState('23:59');
    const [isReportPopoverOpen, setIsReportPopoverOpen] = useState(false);

    // Redial dialog state
    const [isRedialDialogOpen, setIsRedialDialogOpen] = useState(false);
    const [redialName, setRedialName] = useState('');
    const [redialOnVoicemail, setRedialOnVoicemail] = useState(true);
    const [redialOnNoAnswer, setRedialOnNoAnswer] = useState(true);
    const [redialOnBusy, setRedialOnBusy] = useState(true);
    const [isRedialing, setIsRedialing] = useState(false);

    // Fetch campaign details
    const fetchCampaign = useCallback(async () => {
        if (!user) return;
        setIsLoadingCampaign(true);
        try {
            const accessToken = await getAccessToken();
            const response = await getCampaignApiV1CampaignCampaignIdGet({
                path: {
                    campaign_id: campaignId,
                },
                headers: {
                    'Authorization': `Bearer ${accessToken}`,
                }
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

    // Initial load
    useEffect(() => {
        fetchCampaign();
    }, [fetchCampaign]);

    // Handle back navigation
    const handleBack = () => {
        router.push('/campaigns');
    };

    // Handle workflow link click
    const handleWorkflowClick = () => {
        if (campaign) {
            router.push(`/workflow/${campaign.workflow_id}`);
        }
    };

    // Handle CSV download
    const handleDownloadCsv = async () => {
        if (!user || !campaign || campaign.source_type !== 'csv') return;

        try {
            const accessToken = await getAccessToken();
            const response = await getCampaignSourceDownloadUrlApiV1CampaignCampaignIdSourceDownloadUrlGet({
                path: {
                    campaign_id: campaignId,
                },
                headers: {
                    'Authorization': `Bearer ${accessToken}`,
                }
            });

            if (response.data?.download_url) {
                // Open download URL in new tab
                window.open(response.data.download_url, '_blank');
            } else {
                toast.error('Failed to get download URL');
            }
        } catch (error) {
            console.error('Failed to download CSV:', error);
            toast.error('Failed to download CSV file');
        }
    };

    // Build ISO datetime string from date + time
    const buildDateTime = (date: Date | undefined, time: string): string | undefined => {
        if (!date) return undefined;
        const [hours, minutes] = time.split(':').map(Number);
        const combined = new Date(date);
        combined.setHours(hours, minutes, 0, 0);
        return combined.toISOString();
    };

    // Handle download report
    const handleDownloadReport = async () => {
        if (!user) return;
        setIsDownloadingReport(true);
        setIsReportPopoverOpen(false);
        try {
            const accessToken = await getAccessToken();
            const startDate = buildDateTime(reportStartDate, reportStartTime);
            const endDate = buildDateTime(reportEndDate, reportEndTime);

            const response = await downloadCampaignReportApiV1CampaignCampaignIdReportGet({
                path: {
                    campaign_id: campaignId,
                },
                query: {
                    start_date: startDate,
                    end_date: endDate,
                },
                headers: {
                    'Authorization': `Bearer ${accessToken}`,
                },
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

    // Handle start campaign
    const handleStart = async () => {
        if (!user) return;
        setIsExecutingAction(true);
        try {
            const accessToken = await getAccessToken();
            const response = await startCampaignApiV1CampaignCampaignIdStartPost({
                path: {
                    campaign_id: campaignId,
                },
                headers: {
                    'Authorization': `Bearer ${accessToken}`,
                }
            });

            if (response.data) {
                setCampaign(response.data);
                toast.success('Campaign started');
            } else if (response.error) {
                // Extract error message from response
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

    // Handle resume campaign
    const handleResume = async () => {
        if (!user) return;
        setIsExecutingAction(true);
        try {
            const accessToken = await getAccessToken();
            const response = await resumeCampaignApiV1CampaignCampaignIdResumePost({
                path: {
                    campaign_id: campaignId,
                },
                headers: {
                    'Authorization': `Bearer ${accessToken}`,
                }
            });

            if (response.data) {
                setCampaign(response.data);
                toast.success('Campaign resumed');
            } else if (response.error) {
                // Extract error message from response
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

    // Open redial dialog with default name
    const openRedialDialog = () => {
        if (!campaign) return;
        setRedialName(`${campaign.name} (Redial)`);
        setRedialOnVoicemail(true);
        setRedialOnNoAnswer(true);
        setRedialOnBusy(true);
        setIsRedialDialogOpen(true);
    };

    // Handle redial campaign
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
                path: {
                    campaign_id: campaignId,
                },
                body: {
                    name: redialName || null,
                    retry_on_voicemail: redialOnVoicemail,
                    retry_on_no_answer: redialOnNoAnswer,
                    retry_on_busy: redialOnBusy,
                },
                headers: {
                    'Authorization': `Bearer ${accessToken}`,
                }
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

    // Handle pause campaign
    const handlePause = async () => {
        if (!user) return;
        setIsExecutingAction(true);
        try {
            const accessToken = await getAccessToken();
            const response = await pauseCampaignApiV1CampaignCampaignIdPausePost({
                path: {
                    campaign_id: campaignId,
                },
                headers: {
                    'Authorization': `Bearer ${accessToken}`,
                }
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

    // Format date for display
    const formatDate = (dateString: string) => {
        return new Date(dateString).toLocaleDateString();
    };

    const formatDateTime = (dateString: string) => {
        return new Date(dateString).toLocaleString();
    };

    // Get badge variant for state
    const getStateBadgeVariant = (state: string) => {
        switch (state) {
            case 'created':
                return 'secondary';
            case 'running':
                return 'default';
            case 'paused':
                return 'outline';
            case 'completed':
                return 'secondary';
            case 'failed':
                return 'destructive';
            default:
                return 'secondary';
        }
    };

    const canEdit = campaign && ['created', 'running', 'paused'].includes(campaign.state);

    // Newest entries first. The backend appends chronologically; the UI is more
    // useful when the most recent failure / pause is at the top.
    const sortedLogs = (campaign?.logs ?? []).slice().reverse();

    const getLogIcon = (level: string) => {
        switch (level) {
            case 'error':
                return <AlertCircle className="h-4 w-4 text-destructive" />;
            case 'warning':
                return <AlertTriangle className="h-4 w-4 text-amber-500" />;
            default:
                return <Info className="h-4 w-4 text-blue-500" />;
        }
    };

    const getLogBadgeVariant = (level: string): 'destructive' | 'secondary' | 'outline' => {
        switch (level) {
            case 'error':
                return 'destructive';
            case 'warning':
                return 'outline';
            default:
                return 'secondary';
        }
    };

    const formatLogTimestamp = (ts: string) => {
        const d = new Date(ts);
        if (isNaN(d.getTime())) return ts;
        return d.toLocaleString();
    };

    // Render action button based on state
    const renderActionButton = () => {
        if (!campaign || isExecutingAction) return null;

        const editButton = canEdit ? (
            <Button onClick={() => router.push(`/campaigns/${campaignId}/edit`)} className="border border-[#1d1d22] hover:bg-[#1a1a1f] text-white font-semibold text-xs h-10 px-4 rounded-xl transition-all">
                <Pencil className="h-4 w-4 mr-2 inline" />
                Edit Campaign
            </Button>
        ) : null;

        switch (campaign.state) {
            case 'created':
                return (
                    <div className="flex items-center gap-2">
                        {editButton}
                        <Button onClick={handleStart} disabled={isExecutingAction} className="bg-[#7c3aed] hover:bg-[#8b5cf6] text-white font-bold text-xs h-10 px-5 rounded-xl transition-all shadow-lg cursor-pointer">
                            <Play className="h-4 w-4 mr-2 inline" />
                            Start Campaign
                        </Button>
                    </div>
                );
            case 'running':
                return (
                    <div className="flex items-center gap-2">
                        {editButton}
                        <Button onClick={handlePause} disabled={isExecutingAction} className="bg-amber-600 hover:bg-amber-500 text-white font-bold text-xs h-10 px-5 rounded-xl transition-all shadow-lg cursor-pointer">
                            <Pause className="h-4 w-4 mr-2 inline" />
                            Pause Campaign
                        </Button>
                    </div>
                );
            case 'paused':
                return (
                    <div className="flex items-center gap-2">
                        {editButton}
                        <Button onClick={handleResume} disabled={isExecutingAction} className="bg-[#7c3aed] hover:bg-[#8b5cf6] text-white font-bold text-xs h-10 px-5 rounded-xl transition-all shadow-lg cursor-pointer">
                            <RefreshCw className="h-4 w-4 mr-2 inline" />
                            Resume Campaign
                        </Button>
                    </div>
                );
            case 'completed':
                if (campaign.redialed_campaign_id) {
                    return null;
                }
                return (
                    <Button onClick={openRedialDialog} className="bg-[#7c3aed] hover:bg-[#8b5cf6] text-white font-bold text-xs h-10 px-5 rounded-xl transition-all shadow-lg cursor-pointer">
                        <Phone className="h-4 w-4 mr-2 inline" />
                        Redial Campaign
                    </Button>
                );
            default:
                return null;
        }
    };

    if (isLoadingCampaign) {
        return (
            <div className="w-full py-16 flex items-center justify-center">
                <div className="space-y-4">
                    <div className="h-8 bg-gray-100 dark:bg-[#1c1e1a] rounded-xl w-64 animate-pulse"></div>
                    <div className="h-64 bg-gray-100 dark:bg-[#1c1e1a] rounded-xl w-96 animate-pulse"></div>
                </div>
            </div>
        );
    }

    if (!campaign) {
        return (
            <div className="w-full py-16 flex items-center justify-center">
                <p className="text-center text-zinc-500 text-xs font-semibold">Campaign not found</p>
            </div>
        );
    }

    return (
        <div className="w-full p-6 max-w-5xl mx-auto page-enter">
            <div>
                <Button
                    variant="ghost"
                    onClick={handleBack}
                    className="mb-6 border border-[#1d1d22] text-zinc-400 hover:text-white hover:bg-[#1a1a1f] text-xs font-semibold rounded-xl h-10 px-4"
                >
                    <ArrowLeft className="h-4 w-4 mr-2" />
                    Back to Campaigns
                </Button>
                <div className="flex justify-between items-start mb-6">
                    <div>
                        <h1 className="text-2xl font-bold tracking-tight text-white mb-2">{campaign.name}</h1>
                        <div className="flex items-center gap-4">
                            <StateBadge state={campaign.state} />
                            <span className="text-xs text-zinc-500">
                                Created {formatDate(campaign.created_at)}
                            </span>
                        </div>
                    </div>
                    <div className="flex items-center gap-2">
                        <Popover open={isReportPopoverOpen} onOpenChange={setIsReportPopoverOpen}>
                            <PopoverTrigger asChild>
                                <Button variant="outline" disabled={isDownloadingReport} className="border border-[#1d1d22] hover:bg-[#1a1a1f] text-white font-semibold text-xs h-10 px-4 rounded-xl transition-all">
                                    <Download className="h-4 w-4 mr-2 inline" />
                                    Download Report
                                </Button>
                            </PopoverTrigger>
                            <PopoverContent className="w-auto p-4 bg-[#111113] border border-[#1d1d22] text-white rounded-xl shadow-xl" align="end">
                                <div className="space-y-4">
                                    <div className="text-xs font-bold">Filter by date range</div>
                                    <div className="grid gap-3">
                                        <div className="space-y-1.5">
                                            <Label className="text-[11px] text-zinc-400">From</Label>
                                            <div className="flex gap-2">
                                                <Popover>
                                                    <PopoverTrigger asChild>
                                                        <Button variant="outline" size="sm" className="w-[140px] justify-start text-left font-normal border-[#1d1d22] hover:bg-[#1a1a1f] text-xs h-8 text-white rounded-lg">
                                                            <CalendarIcon className="mr-2 h-3.5 w-3.5" />
                                                            {reportStartDate ? format(reportStartDate, 'MMM dd, yyyy') : 'Start date'}
                                                        </Button>
                                                    </PopoverTrigger>
                                                    <PopoverContent className="w-auto p-0 bg-[#111113] border border-[#1d1d22]" align="start">
                                                        <Calendar
                                                            mode="single"
                                                            selected={reportStartDate}
                                                            onSelect={setReportStartDate}
                                                            disabled={(date) => reportEndDate ? date > reportEndDate : false}
                                                            className="bg-[#111113] text-white"
                                                        />
                                                    </PopoverContent>
                                                </Popover>
                                                <Input
                                                    type="time"
                                                    value={reportStartTime}
                                                    onChange={(e) => setReportStartTime(e.target.value)}
                                                    className="w-[100px] h-8 text-xs bg-[#08080a] border-[#1d1d22] text-white rounded-lg"
                                                />
                                            </div>
                                        </div>
                                        <div className="space-y-1.5">
                                            <Label className="text-[11px] text-zinc-400">To</Label>
                                            <div className="flex gap-2">
                                                <Popover>
                                                    <PopoverTrigger asChild>
                                                        <Button variant="outline" size="sm" className="w-[140px] justify-start text-left font-normal border-[#1d1d22] hover:bg-[#1a1a1f] text-xs h-8 text-white rounded-lg">
                                                            <CalendarIcon className="mr-2 h-3.5 w-3.5" />
                                                            {reportEndDate ? format(reportEndDate, 'MMM dd, yyyy') : 'End date'}
                                                        </Button>
                                                    </PopoverTrigger>
                                                    <PopoverContent className="w-auto p-0 bg-[#111113] border border-[#1d1d22]" align="start">
                                                        <Calendar
                                                            mode="single"
                                                            selected={reportEndDate}
                                                            onSelect={setReportEndDate}
                                                            disabled={(date) => reportStartDate ? date < reportStartDate : false}
                                                            className="bg-[#111113] text-white"
                                                        />
                                                    </PopoverContent>
                                                </Popover>
                                                <Input
                                                    type="time"
                                                    value={reportEndTime}
                                                    onChange={(e) => setReportEndTime(e.target.value)}
                                                    className="w-[100px] h-8 text-xs bg-[#08080a] border-[#1d1d22] text-white rounded-lg"
                                                />
                                            </div>
                                        </div>
                                    </div>
                                    <Separator className="bg-[#1d1d22]/50" />
                                    <div className="flex justify-between gap-2">
                                        <Button variant="ghost" size="sm" onClick={handleClearDateRange} className="text-xs hover:bg-[#1a1a1f] rounded-lg">
                                            Clear
                                        </Button>
                                        <Button size="sm" onClick={handleDownloadReport} disabled={isDownloadingReport} className="bg-[#7c3aed] hover:bg-[#8b5cf6] text-white font-bold text-xs h-8 px-3 rounded-lg">
                                            <Download className="h-3.5 w-3.5 mr-1.5 inline" />
                                            {reportStartDate || reportEndDate ? 'Download Filtered' : 'Download All'}
                                        </Button>
                                    </div>
                                </div>
                            </PopoverContent>
                        </Popover>
                        {renderActionButton()}
                    </div>
                </div>
            </div>

            {/* Campaign Details */}
            <Card className="bg-[#111113] border border-[#1d1d22] rounded-2xl shadow-none p-6 mb-6">
                <CardHeader className="p-0 pb-4 mb-4 border-b border-[#1d1d22]/50">
                    <CardTitle className="text-base font-bold text-white">Campaign Details</CardTitle>
                    <CardDescription className="text-xs text-zinc-500">
                        Configuration and source information
                    </CardDescription>
                </CardHeader>
                <CardContent className="p-0">
                    <dl className="grid grid-cols-1 md:grid-cols-2 gap-6">
                        <div>
                            <dt className="text-xs font-semibold text-zinc-500">Workflow</dt>
                            <dd className="mt-1">
                                <button
                                    onClick={handleWorkflowClick}
                                    className="text-xs font-semibold text-[#a78bfa] hover:text-[#c084fc] hover:underline text-left"
                                >
                                    {campaign.workflow_name}
                                </button>
                            </dd>
                        </div>
                        <div>
                            <dt className="text-xs font-semibold text-zinc-500">Source Type</dt>
                            <dd className="mt-1 text-sm font-semibold text-white capitalize">{campaign.source_type.replace('-', ' ')}</dd>
                        </div>
                        <div>
                            <dt className="text-xs font-semibold text-zinc-500">
                                {campaign.source_type === 'csv' ? 'Source File' : 'Source Sheet'}
                            </dt>
                            <dd className="mt-1">
                                {campaign.source_type === 'csv' ? (
                                    <button
                                        onClick={handleDownloadCsv}
                                        className="text-xs font-semibold text-[#a78bfa] hover:text-[#c084fc] hover:underline text-left break-all"
                                    >
                                        {campaign.source_id.split('/').pop()}
                                    </button>
                                ) : (
                                    <a
                                        href={campaign.source_id}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        className="text-xs font-semibold text-[#a78bfa] hover:text-[#c084fc] hover:underline break-all"
                                    >
                                        {campaign.source_id}
                                    </a>
                                )}
                            </dd>
                        </div>
                        <div>
                            <dt className="text-xs font-semibold text-zinc-500">Telephony Configuration</dt>
                            <dd className="mt-1">
                                {campaign.telephony_configuration_id ? (
                                    <button
                                        onClick={() => router.push(`/telephony-configurations/${campaign.telephony_configuration_id}`)}
                                        className="text-xs font-semibold text-[#a78bfa] hover:text-[#c084fc] hover:underline text-left"
                                    >
                                        {campaign.telephony_configuration_name || `Configuration #${campaign.telephony_configuration_id}`}
                                    </button>
                                ) : (
                                    <span className="text-xs text-zinc-500">Not assigned</span>
                                )}
                            </dd>
                        </div>
                        <div>
                            <dt className="text-xs font-semibold text-zinc-500">State</dt>
                            <dd className="mt-1 text-sm font-semibold text-white capitalize">{campaign.state}</dd>
                        </div>
                        <div>
                            <dt className="text-xs font-semibold text-zinc-500">Progress</dt>
                            <dd className="mt-1 text-sm font-semibold text-white">
                                {campaign.executed_count} / {campaign.total_queued_count}
                            </dd>
                        </div>
                        {campaign.parent_campaign_id && (
                            <div>
                                <dt className="text-xs font-semibold text-zinc-500">Redial Of</dt>
                                <dd className="mt-1">
                                    <button
                                        onClick={() => router.push(`/campaigns/${campaign.parent_campaign_id}`)}
                                        className="text-xs font-semibold text-[#a78bfa] hover:text-[#c084fc] hover:underline text-left"
                                    >
                                        Campaign #{campaign.parent_campaign_id}
                                    </button>
                                </dd>
                            </div>
                        )}
                        {campaign.redialed_campaign_id && (
                            <div>
                                <dt className="text-xs font-semibold text-zinc-500">Redialed As</dt>
                                <dd className="mt-1">
                                    <button
                                        onClick={() => router.push(`/campaigns/${campaign.redialed_campaign_id}`)}
                                        className="text-xs font-semibold text-[#a78bfa] hover:text-[#c084fc] hover:underline text-left"
                                    >
                                        Campaign #{campaign.redialed_campaign_id}
                                    </button>
                                </dd>
                            </div>
                        )}
                        {campaign.started_at && (
                            <div>
                                <dt className="text-xs font-semibold text-zinc-500">Started At</dt>
                                <dd className="mt-1 text-sm font-semibold text-white">{formatDateTime(campaign.started_at)}</dd>
                            </div>
                        )}
                        {campaign.completed_at && (
                            <div>
                                <dt className="text-xs font-semibold text-zinc-500">Completed At</dt>
                                <dd className="mt-1 text-sm font-semibold text-white">{formatDateTime(campaign.completed_at)}</dd>
                            </div>
                        )}
                    </dl>
                </CardContent>
            </Card>

            {/* Campaign Settings */}
            <Card className="bg-[#111113] border border-[#1d1d22] rounded-2xl shadow-none p-6 mb-6">
                <CardHeader className="p-0 pb-4 mb-4 border-b border-[#1d1d22]/50">
                    <CardTitle className="text-base font-bold text-white">Campaign Settings</CardTitle>
                    <CardDescription className="text-xs text-zinc-500">
                        Concurrency and retry configuration
                    </CardDescription>
                </CardHeader>
                <CardContent className="p-0 space-y-6">
                    {/* Concurrency Setting */}
                    <div>
                        <dt className="text-xs font-semibold text-zinc-500">Max Concurrent Calls</dt>
                        <dd className="mt-1 text-sm font-semibold text-white">
                            {campaign.max_concurrency ? (
                                <span>{campaign.max_concurrency}</span>
                            ) : (
                                <span className="text-xs text-zinc-500">Using organization default</span>
                            )}
                        </dd>
                    </div>

                    <Separator className="bg-[#1d1d22]/50" />

                    {/* Retry Configuration */}
                    <div className="space-y-4">
                        <div className="flex items-center justify-between">
                            <span className="text-xs font-semibold text-zinc-300">Retries Enabled</span>
                            {campaign.retry_config.enabled ? (
                                <span className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold border border-emerald-500/20 bg-emerald-500/10 text-emerald-400">
                                    <Check className="h-3.5 w-3.5" />
                                    Enabled
                                </span>
                            ) : (
                                <span className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold border border-zinc-500/20 bg-zinc-500/10 text-zinc-400">
                                    <X className="h-3.5 w-3.5" />
                                    Disabled
                                </span>
                            )}
                        </div>

                        {campaign.retry_config.enabled && (
                            <div className="grid grid-cols-2 md:grid-cols-3 gap-6 pl-4 border-l border-[#1d1d22] bg-[#08080a]/30 p-4 rounded-xl border border-[#1d1d22]">
                                <div>
                                    <dt className="text-xs font-semibold text-zinc-500">Max Retries</dt>
                                    <dd className="mt-1 text-sm font-bold text-white">{campaign.retry_config.max_retries}</dd>
                                </div>
                                <div>
                                    <dt className="text-xs font-semibold text-zinc-500">Retry Delay</dt>
                                    <dd className="mt-1 text-sm font-bold text-white">{campaign.retry_config.retry_delay_seconds}s</dd>
                                </div>
                                <div className="col-span-2 md:col-span-1">
                                    <dt className="text-xs font-semibold text-zinc-500">Retry On</dt>
                                    <dd className="mt-1.5 flex flex-wrap gap-1.5">
                                        {campaign.retry_config.retry_on_busy && (
                                            <span className="px-2 py-0.5 text-[10px] font-bold rounded-md bg-[#08080a] border border-[#1d1d22] text-zinc-300">Busy</span>
                                        )}
                                        {campaign.retry_config.retry_on_no_answer && (
                                            <span className="px-2 py-0.5 text-[10px] font-bold rounded-md bg-[#08080a] border border-[#1d1d22] text-zinc-300">No Answer</span>
                                        )}
                                        {campaign.retry_config.retry_on_voicemail && (
                                            <span className="px-2 py-0.5 text-[10px] font-bold rounded-md bg-[#08080a] border border-[#1d1d22] text-zinc-300">Voicemail</span>
                                        )}
                                    </dd>
                                </div>
                            </div>
                        )}
                    </div>

                    <Separator className="bg-[#1d1d22]/50" />

                    {/* Call Schedule (read-only) */}
                    <div className="space-y-4">
                        <div className="flex items-center justify-between">
                            <span className="text-xs font-semibold text-zinc-300">Call Schedule</span>
                            <div className="flex items-center gap-2">
                                {campaign.schedule_config?.enabled ? (
                                    <span className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold border border-[#7c3aed]/20 bg-[#7c3aed]/10 text-[#a78bfa]">
                                        <Clock className="h-3.5 w-3.5" />
                                        Enabled
                                    </span>
                                ) : (
                                    <span className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold border border-zinc-500/20 bg-zinc-500/10 text-zinc-400">
                                        <X className="h-3.5 w-3.5" />
                                        Not configured
                                    </span>
                                )}
                            </div>
                        </div>

                        {campaign.schedule_config?.enabled && (
                            <div className="pl-4 border-l border-[#1d1d22] space-y-4 bg-[#08080a]/30 p-4 rounded-xl border border-[#1d1d22]">
                                <div>
                                    <dt className="text-xs font-semibold text-zinc-500">Timezone</dt>
                                    <dd className="mt-1 text-sm font-semibold text-white">{campaign.schedule_config.timezone.replace(/_/g, ' ')}</dd>
                                </div>
                                <div>
                                    <dt className="text-xs font-semibold text-zinc-500">Time Slots</dt>
                                    <dd className="mt-1.5 flex flex-wrap gap-2">
                                        {campaign.schedule_config.slots.map((slot, index) => {
                                            const dayNames = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
                                            return (
                                                <div key={index} className="flex items-center gap-2 bg-[#111113] border border-[#1d1d22] px-2.5 py-1 rounded-lg">
                                                    <span className="text-[10px] font-bold text-[#a78bfa]">{dayNames[slot.day_of_week]}</span>
                                                    <span className="text-xs text-zinc-300 font-semibold">{slot.start_time} - {slot.end_time}</span>
                                                </div>
                                            );
                                        })}
                                    </dd>
                                </div>
                            </div>
                        )}
                    </div>
                </CardContent>
            </Card>

            {/* Activity Log */}
            <Card className="bg-[#111113] border border-[#1d1d22] rounded-2xl shadow-none p-6 mb-6">
                <CardHeader className="p-0 pb-4 mb-4 border-b border-[#1d1d22]/50">
                    <CardTitle className="text-base font-bold text-white">Activity Log</CardTitle>
                    <CardDescription className="text-xs text-zinc-500">
                        Recent state transitions and failures. Newest first.
                    </CardDescription>
                </CardHeader>
                <CardContent className="p-0">
                    {sortedLogs.length === 0 ? (
                        <p className="text-xs text-zinc-500 font-semibold py-4">No events recorded yet.</p>
                    ) : (
                        <ul className="space-y-4">
                            {sortedLogs.map((entry, idx) => (
                                <li
                                    key={`${entry.ts}-${idx}`}
                                    className="flex gap-4 border-b border-[#1d1d22]/50 last:border-b-0 pb-4 last:pb-0"
                                >
                                    <div className="mt-0.5 shrink-0">{getLogIcon(entry.level)}</div>
                                    <div className="flex-1 min-w-0">
                                        <div className="flex flex-wrap items-center gap-2">
                                            <span className={cn(
                                                "inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider border",
                                                entry.level === 'error' ? 'bg-red-500/10 border-red-500/20 text-red-400' :
                                                entry.level === 'warning' ? 'bg-amber-500/10 border-amber-500/20 text-amber-400' :
                                                'bg-[#08080a] border-[#1d1d22] text-zinc-400'
                                            )}>
                                                {entry.level}
                                            </span>
                                            <code className="text-[11px] font-mono bg-[#08080a] px-1.5 py-0.5 rounded border border-[#1d1d22] text-[#a78bfa]">
                                                {entry.event}
                                            </code>
                                            <span className="text-[11px] text-zinc-500">
                                                {formatLogTimestamp(entry.ts)}
                                            </span>
                                        </div>
                                        <p className="text-xs mt-2 text-zinc-300 font-medium leading-relaxed break-words">{entry.message}</p>
                                        {entry.details && Object.keys(entry.details).length > 0 && (
                                            <details className="mt-2 bg-[#08080a]/50 border border-[#1d1d22] rounded-xl overflow-hidden">
                                                <summary className="text-[10px] font-semibold text-zinc-500 cursor-pointer hover:text-white p-2 bg-[#08080a]/80 select-none">
                                                    Details
                                                </summary>
                                                <pre className="text-[10px] font-mono text-zinc-400 p-3 overflow-x-auto whitespace-pre-wrap break-words border-t border-[#1d1d22]/50">
                                                    {JSON.stringify(entry.details, null, 2)}
                                                </pre>
                                            </details>
                                        )}
                                    </div>
                                </li>
                            ))}
                        </ul>
                    )}
                </CardContent>
            </Card>

            {/* Workflow Runs */}
            <CampaignRuns
                campaignId={campaignId}
                workflowId={campaign.workflow_id}
                searchParams={searchParams}
            />

            <Dialog open={isRedialDialogOpen} onOpenChange={setIsRedialDialogOpen}>
                <DialogContent className="bg-[#111113] border border-[#1d1d22] text-white rounded-2xl shadow-xl">
                    <DialogHeader>
                        <DialogTitle className="text-base font-bold text-white">Redial Campaign</DialogTitle>
                        <DialogDescription className="text-xs text-zinc-500">
                            Creates a new campaign that re-dials unique subscribers whose
                            last call ended with one of the selected outcomes. Subscribers
                            who were successfully reached on a retry are skipped.
                        </DialogDescription>
                    </DialogHeader>
                    <div className="space-y-4 py-2">
                        <div className="space-y-1.5">
                            <Label htmlFor="redial-name" className="text-xs font-semibold text-zinc-300">Name</Label>
                            <Input
                                id="redial-name"
                                value={redialName}
                                onChange={(e) => setRedialName(e.target.value)}
                                placeholder="Campaign name"
                                className="bg-[#08080a] border-[#1d1d22] text-xs text-white rounded-xl h-10 focus-visible:ring-[#7c3aed]"
                            />
                        </div>
                        <div className="space-y-3 bg-[#08080a] border border-[#1d1d22] rounded-xl p-4">
                            <Label className="text-xs font-semibold text-zinc-400 block mb-2">Redial when last call was</Label>
                            <div className="space-y-3">
                                <div className="flex items-center gap-3">
                                    <Checkbox
                                        id="redial-voicemail"
                                        checked={redialOnVoicemail}
                                        onCheckedChange={(v) => setRedialOnVoicemail(v === true)}
                                        className="border-[#1d1d22] data-[state=checked]:bg-[#7c3aed] data-[state=checked]:border-[#7c3aed]"
                                    />
                                    <Label htmlFor="redial-voicemail" className="text-xs text-zinc-300 font-semibold select-none cursor-pointer">
                                        Voicemail
                                    </Label>
                                </div>
                                <div className="flex items-center gap-3">
                                    <Checkbox
                                        id="redial-no-answer"
                                        checked={redialOnNoAnswer}
                                        onCheckedChange={(v) => setRedialOnNoAnswer(v === true)}
                                        className="border-[#1d1d22] data-[state=checked]:bg-[#7c3aed] data-[state=checked]:border-[#7c3aed]"
                                    />
                                    <Label htmlFor="redial-no-answer" className="text-xs text-zinc-300 font-semibold select-none cursor-pointer">
                                        No Answer
                                    </Label>
                                </div>
                                <div className="flex items-center gap-3">
                                    <Checkbox
                                        id="redial-busy"
                                        checked={redialOnBusy}
                                        onCheckedChange={(v) => setRedialOnBusy(v === true)}
                                        className="border-[#1d1d22] data-[state=checked]:bg-[#7c3aed] data-[state=checked]:border-[#7c3aed]"
                                    />
                                    <Label htmlFor="redial-busy" className="text-xs text-zinc-300 font-semibold select-none cursor-pointer">
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
                            className="border border-[#1d1d22] hover:bg-[#1a1a1f] text-white font-semibold text-xs h-10 px-4 rounded-xl"
                        >
                            Cancel
                        </Button>
                        <Button onClick={handleRedial} disabled={isRedialing} className="bg-[#7c3aed] hover:bg-[#8b5cf6] text-white font-bold text-xs h-10 px-5 rounded-xl transition-all shadow-lg cursor-pointer">
                            {isRedialing ? 'Creating...' : 'Create Redial Campaign'}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </div>
    );
}
