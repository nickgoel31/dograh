"use client";

import { AudioLines, Check, Pause, Pencil, Play, RefreshCw, Search, Trash2, X } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";

import {
    deleteRecordingApiV1WorkflowRecordingsRecordingIdDelete,
    listRecordingsApiV1WorkflowRecordingsGet,
    updateRecordingApiV1WorkflowRecordingsIdPatch,
} from "@/client/sdk.gen";
import type { RecordingResponseSchema } from "@/client/types.gen";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { useAudioPlayback } from "@/hooks/useAudioPlayback";
import logger from "@/lib/logger";

export default function RecordingsList({ refreshKey }: { refreshKey?: number }) {
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
        return date.toLocaleDateString() + " " + date.toLocaleTimeString();
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
                {[1, 2, 3].map((i) => (
                    <div key={i} className="flex items-center justify-between p-4 border border-[#1d1d22] rounded-xl bg-[#111113] shimmer">
                        <div className="space-y-2 flex-1">
                            <Skeleton className="h-4 w-48 bg-zinc-800" />
                            <Skeleton className="h-3 w-64 bg-zinc-800" />
                        </div>
                        <Skeleton className="h-8 w-24 bg-zinc-800" />
                    </div>
                ))}
            </div>
        );
    }

    if (error) {
        return (
            <div className="p-4 bg-destructive/10 border border-destructive/20 rounded-xl text-red-400 text-xs font-semibold">
                {error}
            </div>
        );
    }

    return (
        <div className="space-y-4">
            {/* Search and Refresh */}
            <div className="flex items-center gap-4">
                <div className="relative flex-1">
                    <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-zinc-500" />
                    <Input
                        placeholder="Search by filename, transcript, or ID..."
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        className="bg-[#08080a] border border-[#1d1d22] rounded-xl py-2.5 pl-10 pr-4 text-xs text-white focus:outline-none focus:border-zinc-700 focus:ring-1 focus:ring-zinc-700 transition-all w-full"
                    />
                </div>
                <Button
                    onClick={() => { stopPlayback(); fetchRecordings(); }}
                    disabled={isLoading}
                    className="bg-[#121214] border border-[#232328] hover:bg-[#1a1a1f] p-2.5 rounded-xl text-xs text-zinc-300 transition-colors cursor-pointer"
                >
                    <RefreshCw className={`h-4 w-4 ${isLoading ? "animate-spin" : ""}`} />
                </Button>
            </div>

            {/* Results count */}
            <div className="text-xs text-zinc-500">
                {filteredRecordings.length} recording{filteredRecordings.length !== 1 ? "s" : ""}
                {searchQuery && ` matching "${searchQuery}"`}
            </div>

            {/* Recordings List */}
            {filteredRecordings.length === 0 ? (
                <div className="text-center py-12">
                    <AudioLines className="w-12 h-12 text-zinc-600 mx-auto mb-4" />
                    <p className="text-xs text-zinc-400">
                        {searchQuery
                            ? "No recordings match your search"
                            : "No recordings yet"}
                    </p>
                </div>
            ) : (
                <div className="space-y-3">
                    {filteredRecordings.map((rec) => {
                        const filename = (rec.metadata?.original_filename as string) || "";
                        const isEditing = editingId === rec.recording_id;

                        return (
                            <div
                                key={rec.recording_id}
                                className="flex items-center justify-between p-4 bg-[#08080a] border border-[#1d1d22] rounded-xl hover:border-zinc-700 transition-all"
                            >
                                <div className="flex items-center gap-4 flex-1 min-w-0">
                                    <div className="w-10 h-10 rounded-xl bg-purple-500/10 flex items-center justify-center border border-purple-500/20 shrink-0">
                                        <AudioLines className="w-5 h-5 text-purple-400" />
                                    </div>
                                    <div className="flex-1 min-w-0">
                                        {/* Recording ID (editable) */}
                                        <div className="flex items-center gap-2 mb-1">
                                            {isEditing ? (
                                                <div className="flex items-center gap-1 flex-wrap">
                                                    <Input
                                                        value={editValue}
                                                        onChange={(e) => { setEditValue(e.target.value); setEditError(null); }}
                                                        onKeyDown={(e) => {
                                                            if (e.key === "Enter") saveRecordingId(rec);
                                                            if (e.key === "Escape") cancelEditing();
                                                        }}
                                                        className={`bg-[#08080a] border border-[#1d1d22] rounded-xl py-1 px-3 text-xs text-white focus:outline-none focus:border-zinc-700 focus:ring-1 focus:ring-zinc-700 transition-all h-7 w-48 ${editError ? "border-red-500 focus:border-red-500" : ""}`}
                                                        maxLength={64}
                                                        autoFocus
                                                    />
                                                    <Button
                                                        size="sm"
                                                        className="h-7 w-7 p-0 bg-transparent border-none text-zinc-400 hover:text-white hover:bg-white/5 rounded-lg"
                                                        onClick={() => saveRecordingId(rec)}
                                                    >
                                                        <Check className="w-3.5 h-3.5" />
                                                    </Button>
                                                    <Button
                                                        size="sm"
                                                        className="h-7 w-7 p-0 bg-transparent border-none text-zinc-400 hover:text-white hover:bg-white/5 rounded-lg"
                                                        onClick={cancelEditing}
                                                    >
                                                        <X className="w-3.5 h-3.5" />
                                                    </Button>
                                                    {editError && (
                                                        <span className="text-xs text-rose-400">{editError}</span>
                                                    )}
                                                </div>
                                            ) : (
                                                <div className="flex items-center gap-1.5">
                                                    <code className="text-xs font-mono bg-[#1c1c1f] border border-[#232328] text-zinc-300 px-1.5 py-0.5 rounded truncate max-w-[250px]">
                                                        {rec.recording_id}
                                                    </code>
                                                    <Button
                                                        size="sm"
                                                        className="h-6 px-1.5 text-xs text-zinc-500 hover:text-zinc-300 gap-1 bg-transparent hover:bg-white/5 border-none rounded-lg"
                                                        onClick={() => startEditing(rec)}
                                                    >
                                                        <Pencil className="w-3 h-3" />
                                                        Edit ID
                                                    </Button>
                                                </div>
                                            )}
                                        </div>
                                        {/* Filename */}
                                        {filename && (
                                            <p className="text-xs text-zinc-400 mb-0.5 truncate max-w-[300px]">
                                                {filename}
                                            </p>
                                        )}
                                        {/* Transcript */}
                                        <p className="text-xs text-zinc-500 line-clamp-1 mb-1 leading-snug">
                                            {rec.transcript}
                                        </p>
                                        <div className="flex items-center gap-3 text-[10px] text-zinc-600 flex-wrap">
                                            <span>{formatDate(rec.created_at)}</span>
                                        </div>
                                    </div>
                                </div>
                                <div className="flex items-center gap-2 shrink-0 ml-2">
                                    <Button
                                        onClick={() => handlePlay(rec)}
                                        className="bg-[#121214] border border-[#232328] hover:bg-[#1a1a1f] p-2 rounded-xl text-zinc-300 transition-colors cursor-pointer"
                                    >
                                        {playingId === rec.recording_id ? (
                                            <Pause className="w-4 h-4" />
                                        ) : (
                                            <Play className="w-4 h-4" />
                                        )}
                                    </Button>
                                    <Button
                                        onClick={() => handleDelete(rec.recording_id)}
                                        className="p-2 rounded-xl border border-zinc-700/50 text-zinc-500 hover:text-rose-400 transition-colors bg-transparent cursor-pointer"
                                    >
                                        <Trash2 className="w-4 h-4" />
                                    </Button>
                                </div>
                            </div>
                        );
                    })}
                </div>
            )}
        </div>
    );
}
