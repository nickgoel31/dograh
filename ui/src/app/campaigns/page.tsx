"use client";

import { ArrowRight, Megaphone, Plus, Trash2 } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';

import { getCampaignsApiV1CampaignGet } from '@/client/sdk.gen';
import type { CampaignsResponse } from '@/client/types.gen';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
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

function ProgressBar({ done, total }: { done: number; total: number }) {
    const pct = total > 0 ? Math.round((done / total) * 100) : 0;
    return (
        <div className="flex items-center gap-3 min-w-0">
            <div className="flex-1 h-2 rounded-full bg-[#08080a] border border-[#1d1d22] overflow-hidden">
                <div
                    className="h-full rounded-full bg-[#7c3aed] transition-all duration-500"
                    style={{ width: `${pct}%` }}
                />
            </div>
            <span className="text-xs text-zinc-400 tabular-nums shrink-0 font-medium">{done}/{total}</span>
        </div>
    );
}

export default function CampaignsPage() {
    const { user, getAccessToken, redirectToLogin, loading } = useAuth();
    const router = useRouter();

    const [campaignsData, setCampaignsData] = useState<CampaignsResponse | null>(null);
    const [isLoading, setIsLoading] = useState(true);
    const hasFetched = useRef(false);

    useEffect(() => {
        if (!loading && !user) redirectToLogin();
    }, [loading, user, redirectToLogin]);

    useEffect(() => {
        if (loading || !user || hasFetched.current) return;
        hasFetched.current = true;

        const fetchCampaigns = async () => {
            setIsLoading(true);
            try {
                const accessToken = await getAccessToken();
                const response = await getCampaignsApiV1CampaignGet({
                    headers: { 'Authorization': `Bearer ${accessToken}` }
                });
                if (response.data) setCampaignsData(response.data);
            } catch (error) {
                console.error('Failed to fetch campaigns:', error);
            } finally {
                setIsLoading(false);
            }
        };

        fetchCampaigns();
    }, [loading, user, getAccessToken]);

    const formatDate = (dateString: string) =>
        new Date(dateString).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });

    return (
        <div className="min-h-screen bg-[#08080a] p-6 max-w-[1600px] mx-auto w-full page-enter">
            {/* Page header */}
            <div className="border-b border-[#1d1d22]/50 pb-6 mb-6">
                <div className="flex items-end justify-between">
                    <div>
                        <h1 className="text-2xl font-bold tracking-tight text-white">Campaigns</h1>
                        <p className="text-xs text-zinc-500 mt-1">Manage bulk outbound voice campaigns</p>
                    </div>
                    <Button onClick={() => router.push('/campaigns/new')} className="bg-[#7c3aed] hover:bg-[#8b5cf6] text-white font-bold text-xs px-5 py-2.5 rounded-xl transition-all shadow-lg cursor-pointer">
                        <Plus className="h-4 w-4 mr-2 inline" />
                        New Campaign
                    </Button>
                </div>
            </div>

            <div className="space-y-6">
                {isLoading ? (
                    <div className="space-y-3">
                        {[...Array(5)].map((_, i) => (
                            <div key={i} className="h-16 rounded-xl bg-[#111113] border border-[#1d1d22] shimmer" style={{ animationDelay: `${i * 0.06}s` }} />
                        ))}
                    </div>
                ) : campaignsData && campaignsData.campaigns.length > 0 ? (
                    <Card className="bg-[#111113] border border-[#1d1d22] rounded-2xl shadow-none">
                        <CardHeader className="p-6 pb-4 border-b border-[#1d1d22]/50">
                            <CardTitle className="text-base font-bold text-white">Active Campaigns</CardTitle>
                            <CardDescription className="text-xs text-zinc-500">
                                Monitor progress and actions for outbound calling runs
                            </CardDescription>
                        </CardHeader>
                        <CardContent className="p-0">
                            {/* Table header */}
                            <div className="grid grid-cols-[1.5fr_1fr_1.5fr_1fr] gap-4 px-6 py-3 border-b border-[#1d1d22]/50 bg-[#08080a]/50">
                                <span className="text-xs font-bold uppercase tracking-wider text-zinc-400">Name</span>
                                <span className="text-xs font-bold uppercase tracking-wider text-zinc-400 text-center">Status</span>
                                <span className="text-xs font-bold uppercase tracking-wider text-zinc-400">Progress</span>
                                <span className="text-xs font-bold uppercase tracking-wider text-zinc-400 text-right">Actions</span>
                            </div>

                            {/* Rows */}
                            <div className="divide-y divide-[#1d1d22]/50 bg-[#111113]">
                                {campaignsData.campaigns.map((campaign) => (
                                    <div
                                        key={campaign.id}
                                        className="grid grid-cols-[1.5fr_1fr_1.5fr_1fr] gap-4 items-center px-6 py-4 hover:bg-[#1a1a1f] transition-colors cursor-pointer"
                                        onClick={() => router.push(`/campaigns/${campaign.id}`)}
                                    >
                                        <div className="min-w-0">
                                            <p className="text-sm font-semibold text-white truncate">{campaign.name}</p>
                                            <p className="text-xs text-zinc-500 mt-1 truncate">
                                                {campaign.workflow_name} · {formatDate(campaign.created_at)}
                                            </p>
                                        </div>
                                        <div className="flex justify-center">
                                            <StateBadge state={campaign.state} />
                                        </div>
                                        <div className="pr-4">
                                            <ProgressBar done={campaign.executed_count ?? 0} total={campaign.total_queued_count ?? 0} />
                                        </div>
                                        <div className="flex items-center justify-end gap-2" onClick={(e) => e.stopPropagation()}>
                                            <Button
                                                variant="ghost"
                                                size="sm"
                                                className="h-8 px-3 text-xs font-semibold text-white bg-[#1c1c1f] hover:bg-[#27272a] rounded-lg border border-[#232328]"
                                                onClick={() => router.push(`/campaigns/${campaign.id}`)}
                                            >
                                                View
                                                <ArrowRight className="h-3 w-3 ml-1.5" />
                                            </Button>
                                            <Button
                                                variant="ghost"
                                                size="icon"
                                                className="h-8 w-8 text-zinc-400 hover:text-red-400 hover:bg-red-500/10 rounded-lg"
                                                onClick={async () => {
                                                    if (window.confirm('Delete this campaign? This cannot be undone.')) {
                                                        try {
                                                            const accessToken = await getAccessToken();
                                                            const res = await fetch(`/api/v1/campaign/${campaign.id}`, {
                                                                method: 'DELETE',
                                                                headers: { 'Authorization': `Bearer ${accessToken}` }
                                                            });
                                                            if (res.ok) {
                                                                setCampaignsData(prev => prev ? {
                                                                    ...prev,
                                                                    campaigns: prev.campaigns.filter(c => c.id !== campaign.id)
                                                                } : prev);
                                                            }
                                                        } catch (error) {
                                                            console.error(error);
                                                        }
                                                    }
                                                }}
                                            >
                                                <Trash2 className="h-3.5 w-3.5" />
                                            </Button>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </CardContent>
                    </Card>
                ) : (
                    // Empty state
                    <div className="bg-[#111113] border border-[#1d1d22] rounded-2xl p-12 text-center max-w-xl mx-auto mt-12">
                        <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-[#7c3aed]/10 border border-[#7c3aed]/20">
                            <Megaphone className="h-6 w-6 text-[#a78bfa]" />
                        </div>
                        <h3 className="text-base font-semibold text-white mb-2">No campaigns yet</h3>
                        <p className="text-xs text-zinc-500 mb-6 max-w-xs mx-auto">
                            Create a campaign to run bulk outbound calls using your voice agents.
                        </p>
                        <Button onClick={() => router.push('/campaigns/new')} className="bg-[#7c3aed] hover:bg-[#8b5cf6] text-white font-bold text-xs px-5 py-2.5 rounded-xl transition-all shadow-lg cursor-pointer">
                            <Plus className="h-3.5 w-3.5 mr-1.5" />
                            Create Campaign
                        </Button>
                    </div>
                )}
            </div>
        </div>
    );
}

