"use client";

import { Megaphone, Plus, ArrowRight } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';

import { getCampaignsApiV1CampaignGet } from '@/client/sdk.gen';
import type { CampaignsResponse } from '@/client/types.gen';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/lib/auth';
import { cn } from '@/lib/utils';

const STATE_CONFIG: Record<string, { label: string; dot: string; bg: string; text: string }> = {
    created:   { label: 'Created',   dot: 'inactive', bg: 'bg-muted/60',          text: 'text-muted-foreground' },
    running:   { label: 'Running',   dot: 'running',  bg: 'bg-primary/10',         text: 'text-primary' },
    paused:    { label: 'Paused',    dot: 'inactive', bg: 'bg-amber-500/10',       text: 'text-amber-600 dark:text-amber-400' },
    completed: { label: 'Completed', dot: 'active',   bg: 'bg-emerald-500/10',     text: 'text-emerald-600 dark:text-emerald-400' },
    failed:    { label: 'Failed',    dot: 'error',    bg: 'bg-destructive/10',     text: 'text-destructive' },
};

function StateBadge({ state }: { state: string }) {
    const cfg = STATE_CONFIG[state] ?? STATE_CONFIG.created;
    return (
        <span className={cn("inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium", cfg.bg, cfg.text)}>
            <span className={cn("status-dot", cfg.dot)} />
            {cfg.label}
        </span>
    );
}

function ProgressBar({ done, total }: { done: number; total: number }) {
    const pct = total > 0 ? Math.round((done / total) * 100) : 0;
    return (
        <div className="flex items-center gap-2 min-w-0">
            <div className="flex-1 h-1.5 rounded-full bg-border overflow-hidden">
                <div
                    className="h-full rounded-full bg-primary transition-all duration-500"
                    style={{ width: `${pct}%` }}
                />
            </div>
            <span className="text-xs text-muted-foreground tabular-nums shrink-0">{done}/{total}</span>
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
        <div className="min-h-screen page-enter">
            {/* Page header */}
            <div className="px-6 py-6 border-b border-border/50">
                <div className="flex items-end justify-between">
                    <div>
                        <h1 className="text-2xl font-bold tracking-tight">Campaigns</h1>
                        <p className="text-sm text-muted-foreground mt-0.5">Manage bulk outbound voice campaigns</p>
                    </div>
                    <Button size="sm" onClick={() => router.push('/campaigns/new')}>
                        <Plus className="h-3.5 w-3.5 mr-1.5" />
                        New Campaign
                    </Button>
                </div>
            </div>

            <div className="px-6 py-6">
                {isLoading ? (
                    <div className="space-y-2">
                        {[...Array(5)].map((_, i) => (
                            <div key={i} className="h-14 rounded-lg bg-muted shimmer" style={{ animationDelay: `${i * 0.06}s` }} />
                        ))}
                    </div>
                ) : campaignsData && campaignsData.campaigns.length > 0 ? (
                    <div className="neural-card rounded-xl overflow-hidden">
                        {/* Table header */}
                        <div className="grid grid-cols-[1fr_auto_1fr_auto] gap-4 px-4 py-2.5 border-b border-border/50 bg-muted/20">
                            <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Name</span>
                            <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Status</span>
                            <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Progress</span>
                            <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground text-right">Actions</span>
                        </div>

                        {/* Rows */}
                        <div className="divide-y divide-border/40">
                            {campaignsData.campaigns.map((campaign) => (
                                <div
                                    key={campaign.id}
                                    className="grid grid-cols-[1fr_auto_1fr_auto] gap-4 items-center px-4 py-3 data-table-row"
                                    onClick={() => router.push(`/campaigns/${campaign.id}`)}
                                >
                                    <div className="min-w-0">
                                        <p className="text-sm font-medium truncate">{campaign.name}</p>
                                        <p className="text-xs text-muted-foreground mt-0.5 truncate">
                                            {campaign.workflow_name} · {formatDate(campaign.created_at)}
                                        </p>
                                    </div>
                                    <div>
                                        <StateBadge state={campaign.state} />
                                    </div>
                                    <div className="pr-4">
                                        <ProgressBar done={campaign.executed_count ?? 0} total={campaign.total_queued_count ?? 0} />
                                    </div>
                                    <div className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
                                        <Button
                                            variant="ghost"
                                            size="sm"
                                            className="h-7 px-2.5 text-xs hover:bg-accent"
                                            onClick={() => router.push(`/campaigns/${campaign.id}`)}
                                        >
                                            View
                                            <ArrowRight className="h-3 w-3 ml-1" />
                                        </Button>
                                        <Button
                                            variant="ghost"
                                            size="sm"
                                            className="h-7 px-2.5 text-xs text-destructive hover:bg-destructive/10 hover:text-destructive"
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
                                            Delete
                                        </Button>
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>
                ) : (
                    // Empty state
                    <div className="neural-card rounded-xl p-12 text-center">
                        <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-primary/10 border border-primary/20">
                            <Megaphone className="h-6 w-6 text-primary" />
                        </div>
                        <h3 className="text-base font-semibold mb-1">No campaigns yet</h3>
                        <p className="text-sm text-muted-foreground mb-5 max-w-xs mx-auto">
                            Create a campaign to run bulk outbound calls using your voice agents.
                        </p>
                        <Button size="sm" onClick={() => router.push('/campaigns/new')}>
                            <Plus className="h-3.5 w-3.5 mr-1.5" />
                            Create Campaign
                        </Button>
                    </div>
                )}
            </div>
        </div>
    );
}
