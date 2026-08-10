"use client";

import { Loader2, Mic, Square, Upload, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

import {
    createRecordingsApiV1WorkflowRecordingsPost,
    getUploadUrlsApiV1WorkflowRecordingsUploadUrlPost,
    transcribeAudioApiV1WorkflowRecordingsTranscribePost,
} from "@/client";
import type { RecordingUploadResponseSchema } from "@/client/types.gen";
import { LANGUAGE_DISPLAY_NAMES } from "@/constants/languages";

interface RecordingsUploadDialogProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    onUploadComplete?: () => void;
}

const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5MB

interface PendingFile {
    id: string;
    file: File;
    transcript: string;
    isTranscribing: boolean;
    error?: string;
}

let pendingFileCounter = 0;

export const RecordingsUploadDialog = ({
    open,
    onOpenChange,
    onUploadComplete,
}: RecordingsUploadDialogProps) => {
    const [uploading, setUploading] = useState(false);
    const [pendingFiles, setPendingFiles] = useState<PendingFile[]>([]);
    const [error, setError] = useState<string | null>(null);
    const [language, setLanguage] = useState("multi");
    const [recordingStep, setRecordingStep] = useState<"idle" | "naming" | "recording">("idle");
    const [recordingFilename, setRecordingFilename] = useState("");
    const [recordingDuration, setRecordingDuration] = useState(0);
    const mediaRecorderRef = useRef<MediaRecorder | null>(null);
    const audioChunksRef = useRef<Blob[]>([]);
    const recordingTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
    const fileInputRef = useRef<HTMLInputElement>(null);
    const languageRef = useRef(language);
    languageRef.current = language;

    const stopRecordingTimer = useCallback(() => {
        if (recordingTimerRef.current) {
            clearInterval(recordingTimerRef.current);
            recordingTimerRef.current = null;
        }
    }, []);

    const stopRecording = useCallback(() => {
        if (mediaRecorderRef.current && mediaRecorderRef.current.state !== "inactive") {
            mediaRecorderRef.current.stop();
        }
    }, []);

    const resetRecordingState = useCallback(() => {
        setRecordingStep("idle");
        setRecordingFilename("");
        setRecordingDuration(0);
    }, []);

    useEffect(() => {
        if (open) {
            setError(null);
            setPendingFiles([]);
            setLanguage("multi");
            resetRecordingState();
        }
    }, [open, resetRecordingState]);

    useEffect(() => {
        if (!open) {
            stopRecording();
            stopRecordingTimer();
        }
    }, [open, stopRecording, stopRecordingTimer]);

    const transcribeFile = async (pendingId: string, file: File) => {
        setPendingFiles((prev) =>
            prev.map((p) => (p.id === pendingId ? { ...p, isTranscribing: true } : p))
        );
        try {
            const currentLang = languageRef.current;
            const result = await transcribeAudioApiV1WorkflowRecordingsTranscribePost({
                body: { file, language: currentLang },
            });
            const data = result.data as Record<string, unknown> | undefined;
            if (data?.transcript) {
                setPendingFiles((prev) =>
                    prev.map((p) =>
                        p.id === pendingId ? { ...p, transcript: data.transcript as string, isTranscribing: false } : p
                    )
                );
            } else {
                setPendingFiles((prev) =>
                    prev.map((p) => (p.id === pendingId ? { ...p, isTranscribing: false } : p))
                );
            }
        } catch {
            setPendingFiles((prev) =>
                prev.map((p) =>
                    p.id === pendingId
                        ? { ...p, isTranscribing: false, error: "Auto-transcription failed" }
                        : p
                )
            );
        }
    };

    const addPendingFiles = (files: File[]) => {
        const valid: PendingFile[] = [];
        for (const file of files) {
            if (file.size > MAX_FILE_SIZE) {
                setError(`${file.name} (${(file.size / (1024 * 1024)).toFixed(1)}MB) exceeds 5MB limit — skipped.`);
                continue;
            }
            const id = `pending-${++pendingFileCounter}`;
            valid.push({ id, file, transcript: "", isTranscribing: false });
        }
        if (valid.length === 0) return;
        setPendingFiles((prev) => [...prev, ...valid]);
        setError(null);
        for (const pf of valid) {
            transcribeFile(pf.id, pf.file);
        }
    };

    const removePendingFile = (pendingId: string) => {
        setPendingFiles((prev) => prev.filter((p) => p.id !== pendingId));
    };

    const updateTranscript = (pendingId: string, transcript: string) => {
        setPendingFiles((prev) =>
            prev.map((p) => (p.id === pendingId ? { ...p, transcript } : p))
        );
    };

    const startRecording = async () => {
        try {
            const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
            const mediaRecorder = new MediaRecorder(stream);
            mediaRecorderRef.current = mediaRecorder;
            audioChunksRef.current = [];

            mediaRecorder.ondataavailable = (e) => {
                if (e.data.size > 0) audioChunksRef.current.push(e.data);
            };

            const filename = recordingFilename.trim() || "recording";
            mediaRecorder.onstop = () => {
                stream.getTracks().forEach((t) => t.stop());
                stopRecordingTimer();

                const blob = new Blob(audioChunksRef.current, { type: mediaRecorder.mimeType });
                if (blob.size > MAX_FILE_SIZE) {
                    setError(`Recording (${(blob.size / (1024 * 1024)).toFixed(1)}MB) exceeds maximum limit of 5MB.`);
                    resetRecordingState();
                    return;
                }
                const ext = mediaRecorder.mimeType.includes("webm") ? "webm" : "mp4";
                const file = new File([blob], `${filename}.${ext}`, { type: mediaRecorder.mimeType });
                resetRecordingState();
                addPendingFiles([file]);
            };

            mediaRecorder.start();
            setRecordingStep("recording");
            setRecordingDuration(0);
            setError(null);
            recordingTimerRef.current = setInterval(() => {
                setRecordingDuration((d) => d + 1);
            }, 1000);
        } catch {
            setError("Microphone access denied. Please allow microphone permissions.");
            resetRecordingState();
        }
    };

    const handleFileSelect = (fileList: FileList | null) => {
        if (!fileList || fileList.length === 0) return;
        addPendingFiles(Array.from(fileList));
        if (fileInputRef.current) fileInputRef.current.value = "";
    };

    const handleUpload = async (e: React.FormEvent) => {
        e.preventDefault();
        const ready = pendingFiles.filter((p) => p.transcript.trim() && !p.isTranscribing);
        if (ready.length === 0) return;

        setUploading(true);
        setError(null);

        try {
            const uploadUrlResponse = await getUploadUrlsApiV1WorkflowRecordingsUploadUrlPost({
                body: {
                    files: ready.map((p) => ({
                        filename: p.file.name,
                        mime_type: p.file.type || "audio/wav",
                        file_size: p.file.size,
                    })),
                },
            });

            if (!uploadUrlResponse.data?.items) {
                throw new Error("Failed to get upload URLs");
            }

            const items = uploadUrlResponse.data.items;

            await Promise.all(
                items.map(async (item: RecordingUploadResponseSchema, idx: number) => {
                    const file = ready[idx].file;
                    const uploadResponse = await fetch(item.upload_url, {
                        method: "PUT",
                        body: file,
                        headers: { "Content-Type": file.type || "audio/wav" },
                    });
                    if (!uploadResponse.ok) {
                        throw new Error(`File upload failed for ${file.name}`);
                    }
                })
            );

            await createRecordingsApiV1WorkflowRecordingsPost({
                body: {
                    recordings: items.map((item: RecordingUploadResponseSchema, idx: number) => ({
                        recording_id: item.recording_id,
                        transcript: ready[idx].transcript.trim(),
                        storage_key: item.storage_key,
                        metadata: {
                            original_filename: ready[idx].file.name,
                            file_size_bytes: ready[idx].file.size,
                            mime_type: ready[idx].file.type,
                            language,
                        },
                    })),
                },
            });

            setPendingFiles([]);
            setLanguage("multi");
            resetRecordingState();
            if (fileInputRef.current) fileInputRef.current.value = "";
            onUploadComplete?.();
            onOpenChange(false);
        } catch (err) {
            setError(err instanceof Error ? err.message : "Failed to upload recordings");
        } finally {
            setUploading(false);
        }
    };

    const isRecording = recordingStep === "recording";
    const anyTranscribing = pendingFiles.some((p) => p.isTranscribing);
    const readyCount = pendingFiles.filter((p) => p.transcript.trim() && !p.isTranscribing).length;
    const isBusy = uploading || isRecording || anyTranscribing;

    if (!open) return null;

    return (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-xs z-50 flex items-center justify-center p-4">
            <div
                className="border border-gray-200 dark:border-[#282b26] rounded-2xl p-6 w-full max-w-lg shadow-2xl space-y-6 text-gray-900 dark:text-white max-h-[85vh] overflow-y-auto"
                style={{ backgroundColor: '#1C1E1A' }}
            >
                <div className="flex items-center justify-between pb-3 border-b border-gray-100 dark:border-[#282b26]">
                    <div className="space-y-0.5">
                        <h3 className="text-base font-bold text-gray-900 dark:text-white">
                            Upload Recordings
                        </h3>
                        <p className="text-xs text-gray-500 dark:text-gray-400 flex items-center gap-1">
                            <span>Upload or record audio files. Use</span>
                            <code className="px-1 py-0.5 bg-gray-100 dark:bg-[#282b26] font-mono text-gray-800 dark:text-gray-200 rounded text-[10px]">
                                @
                            </code>
                            <span>in prompt fields to insert them into your agents.</span>
                        </p>
                    </div>

                    <button
                        onClick={() => onOpenChange(false)}
                        className="p-1 text-gray-400 hover:text-gray-900 dark:hover:text-white rounded-lg transition-colors cursor-pointer"
                    >
                        <X className="w-5 h-5" />
                    </button>
                </div>

                {error && (
                    <div className="p-3 bg-red-500/10 border border-red-500/20 rounded-xl text-red-600 dark:text-red-400 text-xs font-semibold">
                        {error}
                    </div>
                )}

                <form onSubmit={handleUpload} className="space-y-5">
                    {/* Audio Files Section */}
                    <div className="space-y-2">
                        <label className="text-xs font-bold text-gray-900 dark:text-white block">
                            Audio Files
                        </label>

                        <div className="flex items-center gap-3">
                            <input
                                ref={fileInputRef}
                                type="file"
                                accept="audio/*"
                                multiple
                                onChange={(e) => handleFileSelect(e.target.files)}
                                className="hidden"
                            />

                            {/* Choose Audio Files Button */}
                            <label
                                onClick={() => fileInputRef.current?.click()}
                                className="flex-1 px-4 py-2.5 border border-gray-200 dark:border-[#282b26] rounded-xl text-xs font-medium text-gray-700 dark:text-gray-300 cursor-pointer flex items-center justify-center gap-2 transition-all hover:bg-gray-100 dark:hover:bg-[#232621]"
                                style={{ backgroundColor: '#161715' }}
                            >
                                <Upload className="w-4 h-4 text-gray-500 dark:text-gray-400 shrink-0" />
                                <span className="truncate">
                                    {pendingFiles.length > 0
                                        ? `${pendingFiles.length} file(s) selected`
                                        : "Choose audio files (max 5MB each)"}
                                </span>
                            </label>

                            {/* Record Button */}
                            {recordingStep === "idle" && (
                                <button
                                    type="button"
                                    onClick={() => setRecordingStep("naming")}
                                    disabled={uploading || anyTranscribing}
                                    className="px-4 py-2.5 rounded-xl text-xs font-bold flex items-center gap-2 transition-all bg-gray-100 dark:bg-[#161715] hover:bg-gray-200 dark:hover:bg-[#232621] text-gray-800 dark:text-gray-200 border border-gray-200 dark:border-[#282b26] cursor-pointer"
                                >
                                    <Mic className="w-4 h-4" />
                                    <span>Record</span>
                                </button>
                            )}
                        </div>
                    </div>

                    {/* Recording Name + Recording Control */}
                    {(recordingStep === "naming" || isRecording) && (
                        <div className="space-y-3 rounded-xl border border-dashed border-gray-300 dark:border-[#282b26] p-4 bg-gray-50/50 dark:bg-[#161715]">
                            {recordingStep === "naming" && (
                                <>
                                    <div className="space-y-1">
                                        <label className="text-xs font-bold text-gray-900 dark:text-white block">
                                            Recording Name
                                        </label>
                                        <input
                                            type="text"
                                            placeholder="e.g. greeting, hold-message"
                                            value={recordingFilename}
                                            onChange={(e) => setRecordingFilename(e.target.value)}
                                            className="w-full px-3.5 py-2.5 border border-gray-200 dark:border-[#282b26] rounded-xl text-xs text-gray-900 dark:text-white focus:outline-hidden"
                                            style={{ backgroundColor: '#1C1E1A' }}
                                            autoFocus
                                        />
                                    </div>
                                    <div className="flex gap-2">
                                        <button
                                            type="button"
                                            onClick={startRecording}
                                            disabled={!recordingFilename.trim()}
                                            className="px-4 py-2 bg-black dark:bg-[#bcf0da] hover:bg-gray-800 dark:hover:bg-[#a5e9cd] text-white dark:text-[#082117] font-bold text-xs rounded-full shadow-xs cursor-pointer flex items-center gap-1.5"
                                        >
                                            <Mic className="w-3.5 h-3.5" />
                                            <span>Start Recording</span>
                                        </button>
                                        <button
                                            type="button"
                                            onClick={resetRecordingState}
                                            className="px-4 py-2 bg-gray-100 dark:bg-[#282b26] text-gray-700 dark:text-gray-300 text-xs font-semibold rounded-full cursor-pointer"
                                        >
                                            Cancel
                                        </button>
                                    </div>
                                </>
                            )}
                            {isRecording && (
                                <div className="flex items-center gap-3">
                                    <span className="relative flex h-3 w-3">
                                        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75" />
                                        <span className="relative inline-flex rounded-full h-3 w-3 bg-red-500" />
                                    </span>
                                    <span className="text-xs font-mono text-gray-900 dark:text-white">
                                        {Math.floor(recordingDuration / 60)}:{(recordingDuration % 60).toString().padStart(2, "0")}
                                    </span>
                                    <span className="text-xs text-gray-500 truncate">{recordingFilename}</span>
                                    <button
                                        type="button"
                                        onClick={() => stopRecording()}
                                        className="ml-auto px-4 py-2 bg-red-600 hover:bg-red-500 text-white font-bold text-xs rounded-full cursor-pointer flex items-center gap-1.5"
                                    >
                                        <Square className="w-3.5 h-3.5" />
                                        <span>Stop</span>
                                    </button>
                                </div>
                            )}
                        </div>
                    )}

                    {/* Pending files list */}
                    {pendingFiles.length > 0 && (
                        <div className="space-y-2">
                            <label className="text-xs font-bold text-gray-900 dark:text-white block">
                                Pending ({pendingFiles.length} file{pendingFiles.length !== 1 ? "s" : ""})
                            </label>
                            {pendingFiles.map((pf) => (
                                <div
                                    key={pf.id}
                                    className="rounded-xl border border-gray-200 dark:border-[#282b26] p-3 space-y-2.5"
                                    style={{ backgroundColor: '#161715' }}
                                >
                                    <div className="flex items-center justify-between gap-2">
                                        <code className="text-xs font-mono text-gray-800 dark:text-gray-200 truncate">
                                            {pf.file.name} ({(pf.file.size / (1024 * 1024)).toFixed(1)}MB)
                                        </code>
                                        <div className="flex items-center gap-2">
                                            {pf.isTranscribing && (
                                                <Loader2 className="w-3.5 h-3.5 animate-spin text-gray-400" />
                                            )}
                                            <button
                                                type="button"
                                                onClick={() => removePendingFile(pf.id)}
                                                className="p-1 text-gray-400 hover:text-red-500 cursor-pointer"
                                                disabled={uploading}
                                            >
                                                <X className="w-4 h-4" />
                                            </button>
                                        </div>
                                    </div>
                                    {pf.error && (
                                        <p className="text-[11px] text-rose-500">{pf.error}</p>
                                    )}
                                    <textarea
                                        placeholder={pf.isTranscribing ? "Transcribing audio..." : "What does this recording say?"}
                                        value={pf.transcript}
                                        onChange={(e) => updateTranscript(pf.id, e.target.value)}
                                        disabled={pf.isTranscribing}
                                        rows={2}
                                        className="w-full p-2.5 border border-gray-200 dark:border-[#282b26] rounded-xl text-xs text-gray-900 dark:text-white font-normal focus:outline-hidden resize-none"
                                        style={{ backgroundColor: '#1C1E1A' }}
                                    />
                                </div>
                            ))}
                        </div>
                    )}

                    {/* Language Selector */}
                    <div className="space-y-1.5">
                        <label className="text-xs font-bold text-gray-900 dark:text-white block">
                            Language
                        </label>
                        <select
                            value={language}
                            onChange={(e) => setLanguage(e.target.value)}
                            className="w-full px-3.5 py-2.5 border border-gray-200 dark:border-[#282b26] rounded-xl text-xs text-gray-900 dark:text-white font-medium focus:outline-hidden transition-all cursor-pointer"
                            style={{ backgroundColor: '#161715' }}
                        >
                            <option value="multi" className="bg-white dark:bg-[#1c1e1a] text-gray-900 dark:text-white">Multilingual (Auto-detect)</option>
                            {Object.entries(LANGUAGE_DISPLAY_NAMES).map(([code, name]) => (
                                <option key={code} value={code} className="bg-white dark:bg-[#1c1e1a] text-gray-900 dark:text-white">
                                    {name}
                                </option>
                            ))}
                        </select>
                    </div>

                    {/* Action Submit Button */}
                    <div className="pt-2 flex items-center justify-end gap-3">
                        <button
                            type="button"
                            onClick={() => onOpenChange(false)}
                            className="px-5 py-2.5 bg-gray-100 dark:bg-[#161715] hover:bg-gray-200 dark:hover:bg-[#232621] text-gray-800 dark:text-gray-200 text-xs font-semibold rounded-full transition-all cursor-pointer"
                        >
                            Cancel
                        </button>
                        <button
                            type="submit"
                            disabled={readyCount === 0 || isBusy}
                            className="flex-1 py-3 bg-black dark:bg-[#bcf0da] hover:bg-gray-800 dark:hover:bg-[#a5e9cd] disabled:opacity-50 text-white dark:text-[#082117] text-xs font-bold rounded-full shadow-xs transition-all active:scale-[0.99] flex items-center justify-center gap-2 cursor-pointer"
                        >
                            {uploading ? (
                                <Loader2 className="w-4 h-4 animate-spin stroke-[2.5]" />
                            ) : (
                                <Upload className="w-4 h-4 stroke-[2]" />
                            )}
                            <span>{uploading ? "Uploading..." : `Upload ${readyCount} Recording${readyCount !== 1 ? "s" : ""}`}</span>
                        </button>
                    </div>
                </form>
            </div>
        </div>
    );
};
