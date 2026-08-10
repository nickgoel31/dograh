"use client";

import { ExternalLink, Upload, X } from "lucide-react";
import { useEffect, useState } from "react";

import { Skeleton } from "@/components/ui/skeleton";
import { useAuth } from "@/lib/auth";

import RecordingsList from "./RecordingsList";
import { RecordingsUploadDialog } from "./RecordingsUploadDialog";

export default function RecordingsPage() {
    const { user, redirectToLogin, loading } = useAuth();
    const [isUploadOpen, setIsUploadOpen] = useState(false);
    const [refreshKey, setRefreshKey] = useState(0);

    useEffect(() => {
        if (!loading && !user) {
            redirectToLogin();
        }
    }, [loading, user, redirectToLogin]);

    if (loading || !user) {
        return (
            <div className="w-full py-16 flex items-center justify-center">
                <div className="space-y-4">
                    <Skeleton className="h-12 w-64" />
                    <Skeleton className="h-64 w-96" />
                </div>
            </div>
        );
    }

    return (
        <div className="flex flex-col h-full text-gray-900 dark:text-white font-sans select-none relative" style={{ backgroundColor: '#161715' }}>
            {/* Top Sub-Header matching demo styling */}
            <header className="px-8 pt-6 pb-3 flex items-center justify-between sticky top-0 z-20 border-b border-gray-100 dark:border-[#282b26]" style={{ backgroundColor: '#161715' }}>
                <div className="space-y-0.5">
                    <h1 className="text-base font-semibold text-gray-900 dark:text-white tracking-tight">
                        Recordings
                    </h1>
                    <p className="text-xs text-gray-500 dark:text-gray-400 flex items-center gap-1">
                        <span>
                            Manage audio recordings for your organization. Use{" "}
                            <code className="px-1 py-0.5 bg-gray-100 dark:bg-[#282b26] font-mono text-gray-800 dark:text-gray-200 rounded">
                                @
                            </code>{" "}
                            in prompt fields to insert them, or as transition messages in tool calls.
                        </span>
                        <a
                            href="https://docs.dograh.com/voice-agent/pre-recorded-audio"
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-amber-700 dark:text-amber-400 hover:underline flex items-center gap-0.5 font-medium"
                        >
                            <span>Learn more</span>
                            <ExternalLink className="w-3 h-3" />
                        </a>
                    </p>
                </div>

                <button
                    onClick={() => setIsUploadOpen(true)}
                    className="flex items-center gap-1.5 px-4 py-2 bg-black dark:bg-[#bcf0da] hover:bg-gray-800 dark:hover:bg-[#a5e9cd] text-white dark:text-[#082117] text-xs font-bold rounded-full shadow-xs transition-all active:scale-[0.98] cursor-pointer"
                >
                    <Upload className="w-3.5 h-3.5 stroke-[2]" />
                    <span>Upload Recording</span>
                </button>
            </header>

            {/* Main Content Workspace Container */}
            <div className="max-w-5xl w-full mx-auto px-8 pt-6 pb-16 flex flex-col gap-6">
                {/* All Recordings Card Container matching demo aesthetic */}
                <div
                    className="border border-gray-200/90 dark:border-[#282b26] rounded-2xl p-6 shadow-2xs space-y-6"
                    style={{ backgroundColor: '#1C1E1A' }}
                >
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                        <div className="space-y-0.5">
                            <h2 className="text-sm font-bold text-gray-900 dark:text-white">All Recordings</h2>
                            <p className="text-xs text-gray-400 dark:text-gray-500">
                                Audio recordings shared across all agents in your organization
                            </p>
                        </div>

                        <button
                            onClick={() => setIsUploadOpen(true)}
                            className="flex items-center gap-1.5 px-4 py-2 bg-black dark:bg-[#bcf0da] hover:bg-gray-800 dark:hover:bg-[#a5e9cd] text-white dark:text-[#082117] text-xs font-bold rounded-full shadow-xs transition-all active:scale-[0.98] w-fit cursor-pointer"
                        >
                            <Upload className="w-3.5 h-3.5 stroke-[2]" />
                            <span>Upload Recording</span>
                        </button>
                    </div>

                    <RecordingsList refreshKey={refreshKey} onOpenUpload={() => setIsUploadOpen(true)} />
                </div>
            </div>

            <RecordingsUploadDialog
                open={isUploadOpen}
                onOpenChange={setIsUploadOpen}
                onUploadComplete={() => setRefreshKey((k) => k + 1)}
            />
        </div>
    );
}
