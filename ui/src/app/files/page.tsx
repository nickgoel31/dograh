"use client";

import { ExternalLink, Upload, X } from "lucide-react";
import { useEffect, useState } from "react";

import { Skeleton } from "@/components/ui/skeleton";
import { useAuth } from "@/lib/auth";

import DocumentList from "./DocumentList";
import DocumentUpload from "./DocumentUpload";

export default function FilesPage() {
    const { user, redirectToLogin, loading } = useAuth();
    const [refreshKey, setRefreshKey] = useState(0);
    const [isUploadOpen, setIsUploadOpen] = useState(false);

    // Redirect if not authenticated
    useEffect(() => {
        if (!loading && !user) {
            redirectToLogin();
        }
    }, [loading, user, redirectToLogin]);

    const handleUploadSuccess = () => {
        setRefreshKey(prev => prev + 1);
        setIsUploadOpen(false);
    };

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
                        Knowledge Base Files
                    </h1>
                    <p className="text-xs text-gray-500 dark:text-gray-400 flex items-center gap-1">
                        <span>Upload and manage documents for your voice agents to reference.</span>
                        <a
                            href="https://docs.dograh.com/voice-agent/knowledge-base"
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
                    <span>Upload Document</span>
                </button>
            </header>

            {/* Main Content Workspace Container */}
            <div className="max-w-5xl w-full mx-auto px-8 pt-6 pb-16 flex flex-col gap-6">
                {/* Your Documents Container Card matching demo aesthetic */}
                <div
                    className="border border-gray-200/90 dark:border-[#282b26] rounded-2xl p-6 shadow-2xs space-y-6"
                    style={{ backgroundColor: '#1C1E1A' }}
                >
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                        <div className="space-y-0.5">
                            <h2 className="text-sm font-bold text-gray-900 dark:text-white">Your Documents</h2>
                            <p className="text-xs text-gray-400 dark:text-gray-500">
                                Documents shared across all agents in your organization
                            </p>
                        </div>

                        <button
                            onClick={() => setIsUploadOpen(true)}
                            className="flex items-center gap-1.5 px-4 py-2 bg-black dark:bg-[#bcf0da] hover:bg-gray-800 dark:hover:bg-[#a5e9cd] text-white dark:text-[#082117] text-xs font-bold rounded-full shadow-xs transition-all active:scale-[0.98] w-fit cursor-pointer"
                        >
                            <Upload className="w-3.5 h-3.5 stroke-[2]" />
                            <span>Upload Document</span>
                        </button>
                    </div>

                    <DocumentList refreshTrigger={refreshKey} onOpenUpload={() => setIsUploadOpen(true)} />
                </div>
            </div>

            {/* Upload Document Modal */}
            {isUploadOpen && (
                <div className="fixed inset-0 bg-black/50 backdrop-blur-xs z-50 flex items-center justify-center p-4">
                    <div
                        className="border border-gray-200 dark:border-[#282b26] rounded-2xl p-6 w-full max-w-lg shadow-2xl space-y-6 text-gray-900 dark:text-white"
                        style={{ backgroundColor: '#1C1E1A' }}
                    >
                        <div className="flex items-center justify-between pb-3 border-b border-gray-100 dark:border-[#282b26]">
                            <div className="space-y-0.5">
                                <h3 className="text-base font-bold text-gray-900 dark:text-white">
                                    Upload Document
                                </h3>
                                <p className="text-xs text-gray-500 dark:text-gray-400">
                                    Upload a PDF or document file to add to your knowledge base
                                </p>
                            </div>

                            <button
                                onClick={() => setIsUploadOpen(false)}
                                className="p-1 text-gray-400 hover:text-gray-900 dark:hover:text-white rounded-lg transition-colors cursor-pointer"
                            >
                                <X className="w-5 h-5" />
                            </button>
                        </div>

                        <DocumentUpload onUploadSuccess={handleUploadSuccess} onClose={() => setIsUploadOpen(false)} />
                    </div>
                </div>
            )}
        </div>
    );
}
