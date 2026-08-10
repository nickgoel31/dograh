"use client";

import { ArrowRight, Plus, Search, Trash2 } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';

import { getCampaignsApiV1CampaignGet } from '@/client/sdk.gen';
import type { CampaignsResponse } from '@/client/types.gen';
import { useAuth } from '@/lib/auth';

export default function CampaignsPage() {
    const { user, getAccessToken, redirectToLogin, loading } = useAuth();
    const router = useRouter();

    const [campaignsData, setCampaignsData] = useState<CampaignsResponse | null>(null);
    const [isLoading, setIsLoading] = useState(true);
    const [searchQuery, setSearchQuery] = useState("");
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

    const handleDelete = async (e: React.MouseEvent, id: string | number) => {
        e.stopPropagation();
        if (window.confirm('Delete this campaign? This cannot be undone.')) {
            try {
                const accessToken = await getAccessToken();
                const res = await fetch(`/api/v1/campaign/${id}`, {
                    method: 'DELETE',
                    headers: { 'Authorization': `Bearer ${accessToken}` }
                });
                if (res.ok) {
                    setCampaignsData(prev => prev ? {
                        ...prev,
                        campaigns: prev.campaigns.filter(c => c.id !== id)
                    } : prev);
                }
            } catch (error) {
                console.error(error);
            }
        }
    };

    const campaignsList = campaignsData?.campaigns || [];
    const filteredCampaigns = campaignsList.filter(c =>
        c.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        (c.workflow_name && c.workflow_name.toLowerCase().includes(searchQuery.toLowerCase()))
    );

    return (
        <div className="w-full text-[#f2f4f0] font-sans select-none relative" style={{backgroundColor: '#161715'}}>
            {/* Top Sub-Header matching demo styling */}
            <header className="px-8 pt-6 pb-4 flex items-center justify-between sticky top-0 z-20 border-b border-[#282b26]" style={{backgroundColor: '#161715'}}>
                <h1 className="text-base font-semibold text-gray-900 dark:text-white tracking-tight">
                    Outbound campaigns
                </h1>

                <div className="flex items-center gap-3">
                    <button
                        onClick={() => router.push('/api-keys')}
                        className="px-4 py-2 bg-white dark:bg-[#1c1e1a] border border-gray-200 dark:border-[#282b26] hover:bg-gray-50 dark:hover:bg-[#232621] text-gray-900 dark:text-white text-xs font-semibold rounded-full shadow-2xs flex items-center gap-1.5 transition-all cursor-pointer"
                    >
                        <span>Build with API</span>
                        <ArrowRight className="w-3.5 h-3.5 text-gray-600 dark:text-gray-400" />
                    </button>

                    <button
                        onClick={() => router.push('/campaigns/new')}
                        className="px-4 py-2 bg-black dark:bg-[#bcf0da] hover:bg-gray-800 dark:hover:bg-[#a5e9cd] text-white dark:text-[#082117] text-xs font-semibold rounded-full shadow-xs flex items-center gap-1 transition-all active:scale-[0.98] cursor-pointer"
                    >
                        <Plus className="w-3.5 h-3.5 stroke-[2.5]" />
                        <span>Create campaign</span>
                    </button>
                </div>
            </header>

            {/* Main Content Body */}
            <div className="max-w-5xl w-full mx-auto px-8 pt-6 pb-12 flex flex-col gap-10">
                    {/* Hero Section matching demo */}
                    <div className="flex flex-col items-center text-center space-y-6 pt-2">
                        {/* Orange Pixelated Megaphone/Arrow Graphic */}
                        <div className="w-20 h-20 flex items-center justify-center">
                            <svg viewBox="0 0 60 60" fill="none" className="w-16 h-16">
                                <rect x="10" y="10" width="10" height="40" fill="#f97316" />
                                <rect x="20" y="15" width="10" height="30" fill="#fdba74" />
                                <rect x="30" y="20" width="10" height="20" fill="#fb923c" />
                                <rect x="40" y="25" width="10" height="10" fill="#ea580c" />
                                <rect x="20" y="20" width="5" height="5" fill="#ffffff" opacity="0.6" />
                                <rect x="30" y="25" width="5" height="5" fill="#ffffff" opacity="0.4" />
                            </svg>
                        </div>

                        <div className="space-y-2 max-w-lg">
                            <h2 className="text-3xl sm:text-4xl font-normal text-gray-900 dark:text-white tracking-tight font-serif">
                                Reach thousands of customers by phone
                            </h2>
                            <p className="text-xs text-gray-500 dark:text-gray-400 leading-relaxed">
                                Upload a contact list, pick an agent, and launch automated outbound calls.
                            </p>
                        </div>

                        {/* Center Action Buttons */}
                        <div className="flex items-center justify-center gap-3 pt-2">
                            <button
                                onClick={() => router.push('/api-keys')}
                                className="px-4 py-2 bg-white dark:bg-[#1c1e1a] border border-gray-200 dark:border-[#282b26] hover:bg-gray-50 dark:hover:bg-[#232621] text-gray-900 dark:text-white text-xs font-semibold rounded-full shadow-2xs flex items-center gap-1.5 transition-all cursor-pointer"
                            >
                                <span>Build with API</span>
                                <ArrowRight className="w-3.5 h-3.5 text-gray-600 dark:text-gray-400" />
                            </button>

                            <button
                                onClick={() => router.push('/campaigns/new')}
                                className="px-4 py-2 bg-black dark:bg-[#bcf0da] hover:bg-gray-800 dark:hover:bg-[#a5e9cd] text-white dark:text-[#082117] text-xs font-semibold rounded-full shadow-xs flex items-center gap-1 transition-all active:scale-[0.98] cursor-pointer"
                            >
                                <Plus className="w-3.5 h-3.5 stroke-[2.5]" />
                                <span>Create campaign</span>
                            </button>
                        </div>
                    </div>

                    {/* Campaigns Grid / List */}
                    <div className="space-y-4 pt-4 border-t border-gray-100 dark:border-[#282b26]">
                        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                            <div className="flex items-center gap-2">
                                <h3 className="text-sm font-semibold text-gray-900 dark:text-white">Active Campaigns</h3>
                                <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-gray-100 dark:bg-[#282b26] text-gray-700 dark:text-gray-300">
                                    {filteredCampaigns.length}
                                </span>
                            </div>

                            {/* Search Filter */}
                            <div className="relative w-64">
                                <Search className="w-3.5 h-3.5 text-gray-400 dark:text-gray-500 absolute left-3.5 top-1/2 -translate-y-1/2" />
                                <input
                                    type="text"
                                    value={searchQuery}
                                    onChange={(e) => setSearchQuery(e.target.value)}
                                    placeholder="Search campaigns..."
                                    className="w-full pl-9 pr-4 py-1.5 bg-gray-50/70 dark:bg-[#1c1e1a] border border-gray-200 dark:border-[#282b26] rounded-full text-xs text-gray-800 dark:text-gray-200 placeholder-gray-400 dark:placeholder-gray-500 focus:bg-white dark:focus:bg-[#1c1e1a] focus:outline-hidden transition-all"
                                />
                            </div>
                        </div>

                        {isLoading ? (
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                {[1, 2].map((i) => (
                                    <div key={i} className="h-48 rounded-2xl bg-gray-100 dark:bg-[#1c1e1a] shimmer" />
                                ))}
                            </div>
                        ) : filteredCampaigns.length === 0 ? (
                            <div className="bg-gray-50/50 dark:bg-[#161715] border border-gray-200/60 dark:border-[#282b26] rounded-2xl p-12 text-center">
                                <p className="text-xs text-gray-500 dark:text-gray-400">No active campaigns found.</p>
                            </div>
                        ) : (
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                {filteredCampaigns.map((camp) => {
                                    const executed = camp.executed_count ?? 0;
                                    const total = camp.total_queued_count ?? 0;
                                    const pct = total > 0 ? Math.round((executed / total) * 100) : 0;
                                    const statusLabel = (camp.state || 'created').charAt(0).toUpperCase() + (camp.state || 'created').slice(1);
                                    const isRunning = camp.state === 'running';

                                    return (
                                        <div
                                            key={camp.id}
                                            onClick={() => router.push(`/campaigns/${camp.id}`)}
                                            className="bg-gray-50/70 dark:bg-[#1c1e1a] hover:bg-gray-100/70 dark:hover:bg-[#232621] border border-gray-200/70 dark:border-[#282b26] rounded-2xl p-5 flex flex-col justify-between gap-5 transition-all cursor-pointer group relative"
                                        >
                                            <div className="flex items-start justify-between gap-3">
                                                <div className="space-y-1 min-w-0 flex-1">
                                                    <span className="text-[11px] font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wider block truncate">
                                                        Agent: {camp.workflow_name || 'Voice Agent'}
                                                    </span>
                                                    <h4 className="text-sm font-bold text-gray-900 dark:text-white group-hover:text-amber-600 dark:group-hover:text-amber-400 transition-colors truncate">
                                                        {camp.name}
                                                    </h4>
                                                </div>

                                                <div className="flex items-center gap-2 shrink-0">
                                                    <span
                                                        className={`px-2.5 py-0.5 text-[11px] font-semibold rounded-full flex items-center gap-1.5 ${
                                                            isRunning
                                                                ? "bg-emerald-100 dark:bg-emerald-950/40 text-emerald-800 dark:text-emerald-400 border border-emerald-200 dark:border-emerald-800/40"
                                                                : "bg-blue-100 dark:bg-blue-950/40 text-blue-800 dark:text-blue-400 border border-blue-200 dark:border-blue-800/40"
                                                        }`}
                                                    >
                                                        <span
                                                            className={`w-1.5 h-1.5 rounded-full ${
                                                                isRunning ? "bg-emerald-600 dark:bg-emerald-400 animate-pulse" : "bg-blue-600 dark:bg-blue-400"
                                                            }`}
                                                        />
                                                        {statusLabel}
                                                    </span>

                                                    <button
                                                        onClick={(e) => handleDelete(e, camp.id)}
                                                        className="p-1 text-gray-400 hover:text-red-500 dark:hover:text-red-400 rounded-md transition-colors"
                                                        title="Delete campaign"
                                                    >
                                                        <Trash2 className="w-3.5 h-3.5" />
                                                    </button>
                                                </div>
                                            </div>

                                            {/* Progress Bar */}
                                            <div className="space-y-1.5">
                                                <div className="flex justify-between text-xs font-medium text-gray-500 dark:text-gray-400">
                                                    <span>
                                                        Progress: {executed} / {total} calls
                                                    </span>
                                                    <span className="font-semibold text-gray-900 dark:text-white">
                                                        {pct}%
                                                    </span>
                                                </div>

                                                <div className="h-2 w-full bg-gray-200 dark:bg-[#282b26] rounded-full overflow-hidden">
                                                    <div
                                                        className="h-full bg-gradient-to-r from-amber-500 to-orange-500 rounded-full transition-all duration-500"
                                                        style={{ width: `${pct}%` }}
                                                    />
                                                </div>
                                            </div>

                                            {/* Footer Metrics */}
                                            <div className="pt-3 border-t border-gray-200/60 dark:border-[#282b26] flex items-center justify-between text-xs text-gray-500 dark:text-gray-400">
                                                <div className="flex items-center gap-4">
                                                    <span>
                                                        Total Queued: <strong className="text-gray-900 dark:text-white">{total}</strong>
                                                    </span>
                                                </div>

                                                <span className="text-[11px] text-gray-400 dark:text-gray-500">
                                                    {new Date(camp.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                                                </span>
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>
                        )}
                    </div>
                </div>
        </div>
    );
}
