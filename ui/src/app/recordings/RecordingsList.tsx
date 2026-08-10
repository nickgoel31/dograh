"use client";

import { Check, Pause, Pencil, Play, Radio, RotateCw, Search, Trash2, X } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";

import {
    deleteRecordingApiV1WorkflowRecordingsRecordingIdDelete,
    listRecordingsApiV1WorkflowRecordingsGet,
    updateRecordingApiV1WorkflowRecordingsIdPatch,
} from "@/client/sdk.gen";
import type { RecordingResponseSchema } from "@/client/types.gen";
import { Skeleton } from "@/components/ui/skeleton";
import { useAudioPlayback } from "@/hooks/useAudioPlayback";
import logger from "@/lib/logger";

interface RecordingsListProps {
    refreshKey?: number;
    onOpenUpload?: () => void;
}

export default function RecordingsList({ refreshKey, onOpenUpload }: RecordingsListProps) {
    const [recordings, setRecordings] = useState<RecordingResponseSchema[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [searchQuery, setSearchQuery] = useState("");
    const [error, setError] = useState<string | null>(null);

    // Inline edit state
    const [editingId, setEditingId] = useState<string | null>(null);
    const [editValue, setEditValue] = useState("");
    const [editError, setEditError] = useState<string | null>(null);

    const { playingId, toggle: togglePlayback, stop: stopPlayback } = useAudioPlayback();

    const fetchRecordings = useCallback(async () => {
        try {
            setIsLoading(true);
            setError(null);

            const response = await listRecordingsApiV1WorkflowRecordingsGet({
                query: {},
            });

            if (response.error || !response.data) {
                throw new Error("Failed to fetch recordings");
            }

            setRecordings(response.data.recordings);
        } catch (err) {
            setError(err instanceof Error ? err.message : "Failed to fetch recordings");
            logger.error("Error fetching recordings:", err);
        } finally {
            setIsLoading(false);
        }
    }, []);

    useEffect(() => {
        fetchRecordings();
    }, [fetchRecordings, refreshKey]);

    const handleDelete = async (recordingId: string) => {
        if (!confirm("Are you sure you want to delete this recording?")) return;

        try {
            const response = await deleteRecordingApiV1WorkflowRecordingsRecordingIdDelete({
                path: { recording_id: recordingId },
            });

            if (response.error) {
                throw new Error("Failed to delete recording");
            }

            toast.success("Recording deleted");
            fetchRecordings();
        } catch (err) {
            toast.error(err instanceof Error ? err.message : "Failed to delete recording");
            logger.error("Error deleting recording:", err);
        }
    };

    const handlePlay = async (rec: RecordingResponseSchema) => {
        try {
            await togglePlayback(rec.recording_id, rec.storage_key, rec.storage_backend);
        } catch {
            toast.error("Failed to play recording");
        }
    };

    const startEditing = (rec: RecordingResponseSchema) => {
        setEditingId(rec.recording_id);
        setEditValue(rec.recording_id);
        setEditError(null);
    };

    const cancelEditing = () => {
        setEditingId(null);
        setEditValue("");
        setEditError(null);
    };

    const saveRecordingId = async (rec: RecordingResponseSchema) => {
        const newId = editValue.trim();
        if (!newId) {
            setEditError("ID cannot be empty");
            return;
        }
        if (!/^[a-zA-Z0-9_-]+$/.test(newId)) {
            setEditError("Only letters, numbers, hyphens, and underscores");
            return;
        }
        if (newId === rec.recording_id) {
            cancelEditing();
            return;
        }

        setEditError(null);
        try {
            const response = await updateRecordingApiV1WorkflowRecordingsIdPatch({
                path: { id: rec.id },
                body: { recording_id: newId },
            });

            if (response.error) {
                const errData = response.error as { detail?: string };
                throw new Error(errData?.detail || "Failed to update recording ID");
            }

            toast.success(`Recording ID updated to "${newId}". All workflow references have been updated.`);
            cancelEditing();
            fetchRecordings();
        } catch (err) {
            setEditError(err instanceof Error ? err.message : "Failed to update recording ID");
        }
    };

    const formatDate = (dateString: string): string => {
        const date = new Date(dateString);
        const now = new Date();
        const diffMs = now.getTime() - date.getTime();
        const diffMins = Math.floor(diffMs / 60000);
        const diffHours = Math.floor(diffMs / 3600000);
        const diffDays = Math.floor(diffMs / 86400000);

        if (diffMins < 1) return 'Just now';
        if (diffMins < 60) return `${diffMins}m ago`;
        if (diffHours < 24) return `${diffHours}h ago`;
        if (diffDays < 7) return `${diffDays}d ago`;
        return date.toLocaleDateString();
    };

    const filteredRecordings = recordings.filter((rec) => {
        if (!searchQuery) return true;
        const q = searchQuery.toLowerCase();
        const filename = (rec.metadata?.original_filename as string) || "";
        return (
            filename.toLowerCase().includes(q) ||
            rec.transcript.toLowerCase().includes(q) ||
            rec.recording_id.toLowerCase().includes(q)
        );
    });

    if (isLoading && recordings.length === 0) {
        return (
            <div className="space-y-4">
                {[1, 2].map((i) => (
                    <div
                        key={i}
                        className="p-4 border border-gray-200/80 dark:border-[#282b26] rounded-2xl space-y-3 shimmer"
                        style={{ backgroundColor: '#161715' }}
                    >
                        <div className="flex items-center gap-3">
                            <Skeleton className="h-9 w-9 rounded-full" />
                            <div className="space-y-2 flex-1">
                                <Skeleton className="h-4 w-48" />
                                <Skeleton className="h-3 w-32" />
                            </div>
                        </div>
                    </div>
                ))}
            </div>
        );
    }

    if (error) {
        return (
            <div className="p-4 bg-red-500/10 border border-red-500/20 rounded-xl text-red-600 dark:text-red-400 text-xs font-semibold">
                {error}
            </div>
        );
    }

    return (
        <div className="space-y-6">
            {/* Search and Refresh */}
            <div className="flex items-center gap-2">
                <div className="relative flex-1">
                    <Search className="w-4 h-4 text-gray-400 dark:text-gray-500 absolute left-3.5 top-1/2 -translate-y-1/2" />
                    <input
                        type="text"
                        placeholder="Search by filename, transcript, or ID..."
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        className="w-full pl-10 pr-4 py-2 border border-gray-200 dark:border-[#282b26] rounded-xl text-xs text-gray-800 dark:text-white placeholder-gray-400 dark:placeholder-gray-500 font-normal focus:outline-hidden transition-all"
                        style={{ backgroundColor: '#161715' }}
                    />
                </div>
                <button
                    onClick={() => { stopPlayback(); fetchRecordings(); }}
                    disabled={isLoading}
                    className="p-2.5 bg-gray-50 dark:bg-[#161715] hover:bg-gray-100 dark:hover:bg-[#232621] border border-gray-200 dark:border-[#282b26] text-gray-600 dark:text-gray-300 rounded-xl transition-colors cursor-pointer"
                    title="Refresh List"
                >
                    <RotateCw className={`w-4 h-4 ${isLoading ? "animate-spin" : ""}`} />
                </button>
            </div>

            {/* Count label */}
            <div className="text-xs text-gray-400 dark:text-gray-500 font-medium px-1">
                {filteredRecordings.length} recording{filteredRecordings.length !== 1 ? "s" : ""}
                {searchQuery && ` matching "${searchQuery}"`}
            </div>

            {/* Recordings List or Empty State */}
            {filteredRecordings.length === 0 ? (
                <div className="py-16 flex flex-col items-center justify-center text-center space-y-4">
                    <div className="w-16 h-16 rounded-full bg-gray-100 dark:bg-[#161715] flex items-center justify-center text-gray-400 dark:text-gray-500 border border-gray-200/50 dark:border-[#282b26]">
                        <Radio className="w-8 h-8 stroke-[1.5]" />
                    </div>

                    <div className="space-y-1">
                        <h4 className="text-sm font-semibold text-gray-700 dark:text-gray-300">
                            {searchQuery ? "No recordings match your search" : "No recordings yet"}
                        </h4>
                    </div>

                    {onOpenUpload && (
                        <button
                            onClick={onOpenUpload}
                            className="px-5 py-2.5 bg-black dark:bg-[#bcf0da] hover:bg-gray-800 dark:hover:bg-[#a5e9cd] text-white dark:text-[#082117] text-xs font-bold rounded-full shadow-xs transition-all active:scale-[0.98] cursor-pointer"
                        >
                            Upload First Recording
                        </button>
                    )}
                </div>
            ) : (
                <div className="space-y-3 pt-1">
                    {filteredRecordings.map((rec) => {
                        const filename = (rec.metadata?.original_filename as string) || "";
                        const language = (rec.metadata?.language as string) || "Multilingual";
                        const isPlaying = playingId === rec.recording_id;
                        const isEditing = editingId === rec.recording_id;

                        return (
                            <div
                                key={rec.recording_id}
                                className="p-4 border border-gray-200/80 dark:border-[#282b26] rounded-2xl flex flex-col gap-3 transition-all group hover:border-gray-300 dark:hover:border-[#383c35]"
                                style={{ backgroundColor: '#161715' }}
                            >
                                <div className="flex items-center justify-between gap-4">
                                    <div className="flex items-center gap-3 min-w-0">
                                        {/* Play/Pause Button */}
                                        <button
                                            onClick={() => handlePlay(rec)}
                                            className={`w-9 h-9 rounded-full flex items-center justify-center transition-all flex-shrink-0 cursor-pointer ${
                                                isPlaying
                                                    ? "bg-amber-500 text-white shadow-md"
                                                    : "bg-black dark:bg-[#bcf0da] text-white dark:text-[#082117] hover:bg-gray-800 dark:hover:bg-[#a5e9cd]"
                                            }`}
                                        >
                                            {isPlaying ? (
                                                <Pause className="w-4 h-4 fill-current" />
                                            ) : (
                                                <Play className="w-4 h-4 fill-current translate-x-[0.5px]" />
                                            )}
                                        </button>

                                        <div className="flex flex-col min-w-0">
                                            {/* Editable Recording ID or Filename */}
                                            {isEditing ? (
                                                <div className="flex items-center gap-1.5 flex-wrap">
                                                    <input
                                                        type="text"
                                                        value={editValue}
                                                        onChange={(e) => { setEditValue(e.target.value); setEditError(null); }}
                                                        onKeyDown={(e) => {
                                                            if (e.key === "Enter") saveRecordingId(rec);
                                                            if (e.key === "Escape") cancelEditing();
                                                        }}
                                                        className="border border-gray-300 dark:border-[#282b26] rounded-lg py-0.5 px-2 text-xs text-gray-900 dark:text-white focus:outline-hidden font-mono"
                                                        style={{ backgroundColor: '#1C1E1A' }}
                                                        maxLength={64}
                                                        autoFocus
                                                    />
                                                    <button
                                                        onClick={() => saveRecordingId(rec)}
                                                        className="p-1 text-emerald-600 hover:text-emerald-500 cursor-pointer"
                                                    >
                                                        <Check className="w-4 h-4" />
                                                    </button>
                                                    <button
                                                        onClick={cancelEditing}
                                                        className="p-1 text-gray-400 hover:text-gray-200 cursor-pointer"
                                                    >
                                                        <X className="w-4 h-4" />
                                                    </button>
                                                </div>
                                            ) : (
                                                <div className="flex items-center gap-2">
                                                    <span className="text-xs font-bold text-gray-900 dark:text-white truncate">
                                                        {filename || rec.recording_id}
                                                    </span>
                                                    <code className="text-[10px] font-mono bg-gray-200/60 dark:bg-[#282b26] text-gray-700 dark:text-gray-300 px-1.5 py-0.5 rounded truncate max-w-[150px]">
                                                        @{rec.recording_id}
                                                    </code>
                                                    <button
                                                        onClick={() => startEditing(rec)}
                                                        className="text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 cursor-pointer p-0.5"
                                                        title="Edit ID"
                                                    >
                                                        <Pencil className="w-3 h-3" />
                                                    </button>
                                                </div>
                                            )}
                                            {editError && (
                                                <span className="text-[10px] text-rose-500 leading-none mt-0.5">{editError}</span>
                                            )}
                                            <span className="text-[11px] text-gray-400 dark:text-gray-500">
                                                {language}
                                            </span>
                                        </div>
                                    </div>

                                    <div className="flex items-center gap-3">
                                        <span className="text-xs text-gray-400 dark:text-gray-500 font-medium">
                                            {formatDate(rec.created_at)}
                                        </span>
                                        <button
                                            onClick={() => handleDelete(rec.recording_id)}
                                            className="p-1 text-gray-400 hover:text-red-600 transition-colors cursor-pointer"
                                            title="Delete recording"
                                        >
                                            <Trash2 className="w-4 h-4" />
                                        </button>
                                    </div>
                                </div>

                                {/* Waveform & Transcript Box */}
                                <div
                                    className="rounded-xl border border-gray-200/60 dark:border-[#282b26] p-3 space-y-2"
                                    style={{ backgroundColor: '#1C1E1A' }}
                                >
                                    {/* Audio waveform visualization bars */}
                                    <div className="h-6 flex items-center gap-0.5 px-1 justify-center">
                                        {[30, 60, 90, 45, 80, 100, 35, 70, 95, 50, 85, 40, 65, 90, 55, 75, 30, 80, 60, 40, 90, 70, 50].map(
                                            (h, idx) => (
                                                <div
                                                    key={idx}
                                                    className={`w-1 rounded-full transition-all duration-200 ${
                                                        isPlaying
                                                            ? "bg-amber-500 animate-pulse"
                                                            : "bg-gray-300 dark:bg-[#282b26]"
                                                    }`}
                                                    style={{ height: `${isPlaying ? h : 40}%` }}
                                                />
                                            )
                                        )}
                                    </div>

                                    <p className="text-[11.5px] text-gray-600 dark:text-gray-300 italic">
                                        &quot;{rec.transcript || "No transcript available."}&quot;
                                    </p>
                                </div>
                            </div>
                        );
                    })}
                </div>
            )}
        </div>
    );
}
