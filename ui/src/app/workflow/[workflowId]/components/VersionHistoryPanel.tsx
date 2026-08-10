"use client";

import { formatDistanceToNow } from "date-fns";
import { FileText, LoaderCircle, X } from "lucide-react";
import { useEffect } from "react";

import { Button } from "@/components/ui/button";

export interface WorkflowVersion {
    id: number;
    version_number: number;
    status: string;
    created_at: string;
    published_at: string | null;
    workflow_json: { nodes?: unknown[]; edges?: unknown[]; viewport?: unknown };
    workflow_configurations: Record<string, unknown> | null;
    template_context_variables: Record<string, string> | null;
}

interface VersionHistoryPanelProps {
    isOpen: boolean;
    onClose: () => void;
    versions: WorkflowVersion[];
    loading: boolean;
    activeVersionId: number | null;
    onSelectVersion: (version: WorkflowVersion) => void;
    hasMore: boolean;
    loadingMore: boolean;
    onLoadMore: () => void;
}

export const VersionHistoryPanel = ({
    isOpen,
    onClose,
    versions,
    loading,
    activeVersionId,
    onSelectVersion,
    hasMore,
    loadingMore,
    onLoadMore,
}: VersionHistoryPanelProps) => {
    useEffect(() => {
        const handleKeyDown = (event: KeyboardEvent) => {
            if (event.key === "Escape" && isOpen) {
                onClose();
            }
        };
        document.addEventListener("keydown", handleKeyDown);
        return () => document.removeEventListener("keydown", handleKeyDown);
    }, [isOpen, onClose]);

    if (!isOpen) return null;

    return (
        <div
            className="absolute top-14 right-0 bottom-0 w-80 border-l border-[#242722] z-40 shadow-2xl flex flex-col p-6 space-y-4 animate-in slide-in-from-right duration-200"
            style={{ backgroundColor: '#161715' }}
        >
            <div className="flex items-center justify-between pb-2 border-b border-[#242722]">
                <h2 className="text-lg font-bold text-white">Version History</h2>
                <button
                    onClick={onClose}
                    className="text-[#9ca39a] hover:text-white p-1 cursor-pointer"
                >
                    <X className="w-5 h-5" />
                </button>
            </div>

            <div className="flex-1 overflow-y-auto space-y-2 pr-1">
                {loading ? (
                    <div className="flex items-center justify-center py-12">
                        <LoaderCircle className="w-6 h-6 text-[#9ca39a] animate-spin" />
                    </div>
                ) : versions.length === 0 ? (
                    <p className="text-xs text-[#9ca39a] text-center py-8">
                        No versions found.
                    </p>
                ) : (
                    versions.map((ver) => {
                        const isActive = ver.id === activeVersionId;
                        const date = ver.published_at || ver.created_at;
                        return (
                            <div
                                key={ver.id}
                                onClick={() => onSelectVersion(ver)}
                                className={`p-3.5 rounded-2xl border transition-all cursor-pointer flex items-center justify-between ${
                                    isActive
                                        ? "bg-[#102a20] border-emerald-600/60 text-white"
                                        : "bg-[#1c1e1a] border-[#282b26] hover:bg-[#232621] text-[#c8ccc5]"
                                }`}
                            >
                                <div className="space-y-0.5">
                                    <div className="flex items-center gap-2">
                                        <FileText className="w-4 h-4 text-[#9ca39a]" />
                                        <span className="text-xs font-bold">v{ver.version_number}</span>
                                    </div>
                                    <span className="text-[11px] text-[#9ca39a] block pl-6">
                                        {formatDistanceToNow(new Date(date), { addSuffix: true })}
                                    </span>
                                </div>

                                {ver.status === "published" && (
                                    <span className="px-2.5 py-0.5 bg-emerald-900/60 text-emerald-400 border border-emerald-700/50 text-[10.5px] font-bold rounded-full">
                                        Published
                                    </span>
                                )}
                                {ver.status === "draft" && (
                                    <span className="px-2.5 py-0.5 bg-amber-900/60 text-amber-400 border border-amber-700/50 text-[10.5px] font-bold rounded-full">
                                        Draft
                                    </span>
                                )}
                            </div>
                        );
                    })
                )}
            </div>

            {hasMore && (
                <Button
                    variant="ghost"
                    onClick={onLoadMore}
                    disabled={loadingMore}
                    className="py-2 text-center text-xs font-bold text-[#c8ccc5] hover:text-white transition-colors border-t border-[#242722] cursor-pointer"
                >
                    {loadingMore ? (
                        <LoaderCircle className="w-4 h-4 animate-spin" />
                    ) : (
                        "Load more"
                    )}
                </Button>
            )}
        </div>
    );
};
