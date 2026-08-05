'use client';

import { Check, Copy, Cpu, ExternalLink, FileText, IndianRupee, Mic, Sparkles, Video, Volume2, X } from 'lucide-react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import posthog from 'posthog-js';
import { useEffect, useRef, useState } from 'react';

import WorkflowLayout from '@/app/workflow/WorkflowLayout';
import { getWorkflowRunApiV1WorkflowWorkflowIdRunsRunIdGet } from '@/client/sdk.gen';
import { MediaPreviewButton, MediaPreviewDialog } from '@/components/MediaPreviewDialog';
import { OnboardingTooltip } from '@/components/onboarding/OnboardingTooltip';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { ConversationRailFrame, RealtimeFeedback, WorkflowRunLogs } from '@/components/workflow/conversation';
import { PostHogEvent } from '@/constants/posthog-events';
import { WORKFLOW_RUN_MODES } from '@/constants/workflowRunModes';
import { useOnboarding } from '@/context/OnboardingContext';
import { useAuth } from '@/lib/auth';
import { downloadFile } from '@/lib/files';

// ---------------------------------------------------------------------------
// Gemini Live cost constants  (update if Google changes pricing)
// Prices: ai.google.dev/gemini-api/docs/pricing — paid tier, July 2025
// ---------------------------------------------------------------------------
// ---------------------------------------------------------------------------
// Gemini Live cost constants  (update if Google changes pricing)
// Prices: ai.google.dev/gemini-api/docs/pricing — paid tier, July 2025
// ---------------------------------------------------------------------------
const GEMINI_LIVE_PRICING = {
    TEXT_INPUT_PER_M: 0.75,    // $ per 1M text-input tokens
    AUDIO_INPUT_PER_M: 3.00,   // $ per 1M audio-input tokens
    TEXT_OUTPUT_PER_M: 4.50,   // $ per 1M text-output tokens
    AUDIO_OUTPUT_PER_M: 12.00, // $ per 1M audio-output tokens
};
const USD_TO_INR = 96; // 1 USD = ₹96
const GEMINI_LIVE_MODEL_KEYWORD = 'gemini';

/** Detect if a run used Gemini Live and return the first matching LLM key. */
function getGeminiLiveUsageKey(usageInfo: WorkflowRunResponse['usage_info']): string | null {
    if (!usageInfo?.llm) return null;
    const key = Object.keys(usageInfo.llm).find((k) =>
        k.toLowerCase().includes(GEMINI_LIVE_MODEL_KEYWORD) &&
        k.toLowerCase().includes('live')
    );
    return key ?? null;
}

/** Detect if a run used Inworld Realtime and return the first matching key. */
function getInworldUsageKey(usageInfo: WorkflowRunResponse['usage_info']): string | null {
    if (!usageInfo) return null;
    const allKeys = [
        ...Object.keys(usageInfo.llm || {}),
        ...Object.keys(usageInfo.tts || {}),
        ...Object.keys(usageInfo.stt || {}),
    ];
    const key = allKeys.find((k) => k.toLowerCase().includes('inworld'));
    return key ?? null;
}

interface WorkflowRunResponse {
    mode: string;
    is_completed: boolean;
    transcript_url: string | null;
    recording_url: string | null;
    cost_info: {
        dograh_token_usage?: number | null;
        call_duration_seconds?: number | null;
        total_cost_usd?: number | null;
        cost_breakdown?: {
            llm_cost?: number;
            tts_cost?: number;
            stt_cost?: number;
            total?: number;
        } | null;
    } | null;
    usage_info: {
        llm?: Record<string, {
            prompt_tokens: number;
            completion_tokens: number;
            total_tokens: number;
            text_input_tokens?: number;
            audio_input_tokens?: number;
            text_output_tokens?: number;
            audio_output_tokens?: number;
        }>;
        tts?: Record<string, number | { characters?: number; audio_seconds?: number }>;
        stt?: Record<string, number | { audio_seconds?: number }>;
        call_duration_seconds?: number;
    } | null;
    initial_context: Record<string, string | number | boolean | object> | null;
    gathered_context: Record<string, string | number | boolean | object> | null;
    logs: WorkflowRunLogs | null;
    annotations: Record<string, unknown> | null;
}

// ---------------------------------------------------------------------------
// GeminiCostDialog — shown only for Gemini Live runs
// ---------------------------------------------------------------------------
function GeminiCostDialog({ usageInfo, costInfo }: {
    usageInfo: WorkflowRunResponse['usage_info'];
    costInfo: WorkflowRunResponse['cost_info'];
}) {
    const [open, setOpen] = useState(false);

    const geminiKey = getGeminiLiveUsageKey(usageInfo);
    if (!geminiKey || !usageInfo?.llm) return null;

    const usage = usageInfo.llm[geminiKey];
    const promptTokens = usage?.prompt_tokens ?? 0;
    const completionTokens = usage?.completion_tokens ?? 0;
    const durationSeconds = usageInfo?.call_duration_seconds ?? 0;

    // Model name is the part after '|||'
    const modelName = geminiKey.includes('|||') ? geminiKey.split('|||')[1] : geminiKey;

    // Modality breakdown with fallback estimation for historical runs
    let textInputTokens = usage?.text_input_tokens ?? 0;
    let audioInputTokens = usage?.audio_input_tokens ?? 0;
    let textOutputTokens = usage?.text_output_tokens ?? 0;
    let audioOutputTokens = usage?.audio_output_tokens ?? 0;

    if (!textInputTokens && !audioInputTokens && promptTokens > 0) {
        // Fallback for runs before modality breakdown was explicit:
        // Audio input tokens = call_duration (sec) * 32 tokens/sec (~32 tokens/sec for audio stream)
        // Remainder is Text Input (system prompt + tools + history re-read across turns).
        const estimatedAudio = Math.min(promptTokens, Math.round(durationSeconds * 32));
        audioInputTokens = estimatedAudio;
        textInputTokens = Math.max(0, promptTokens - estimatedAudio);
    }

    if (!textOutputTokens && !audioOutputTokens && completionTokens > 0) {
        audioOutputTokens = completionTokens;
    }

    // Cost calculation per modality
    const textInputCostUsd   = (textInputTokens / 1_000_000) * GEMINI_LIVE_PRICING.TEXT_INPUT_PER_M;
    const audioInputCostUsd  = (audioInputTokens / 1_000_000) * GEMINI_LIVE_PRICING.AUDIO_INPUT_PER_M;
    const textOutputCostUsd  = (textOutputTokens / 1_000_000) * GEMINI_LIVE_PRICING.TEXT_OUTPUT_PER_M;
    const audioOutputCostUsd = (audioOutputTokens / 1_000_000) * GEMINI_LIVE_PRICING.AUDIO_OUTPUT_PER_M;

    const calculatedTotalUsd = textInputCostUsd + audioInputCostUsd + textOutputCostUsd + audioOutputCostUsd;
    const totalUsd = calculatedTotalUsd;
    const totalInr = totalUsd * USD_TO_INR;

    const textInputInr   = textInputCostUsd * USD_TO_INR;
    const audioInputInr  = audioInputCostUsd * USD_TO_INR;
    const textOutputInr  = textOutputCostUsd * USD_TO_INR;
    const audioOutputInr = audioOutputCostUsd * USD_TO_INR;

    const fmt = (n: number, decimals = 5) => n.toFixed(decimals);
    const fmtInr = (n: number) => `₹${n.toFixed(3)}`;
    const fmtTokens = (n: number) => n.toLocaleString();

    return (
        <>
            <Button
                id="gemini-cost-button"
                variant="outline"
                size="sm"
                className="gap-2 border-amber-500/40 bg-amber-500/5 text-amber-600 hover:bg-amber-500/10 hover:text-amber-700 dark:text-amber-400 dark:hover:text-amber-300"
                onClick={() => setOpen(true)}
            >
                <IndianRupee className="h-4 w-4" />
                Google API Cost
            </Button>

            {open && (
                <div
                    className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm"
                    onClick={() => setOpen(false)}
                >
                    <div
                        id="gemini-cost-dialog"
                        className="relative w-full max-w-md rounded-xl border border-border bg-background shadow-2xl"
                        onClick={(e) => e.stopPropagation()}
                    >
                        {/* Header */}
                        <div className="flex items-center justify-between border-b border-border px-5 py-4">
                            <div className="flex items-center gap-2">
                                <div className="flex h-7 w-7 items-center justify-center rounded-full bg-amber-500/15">
                                    <IndianRupee className="h-4 w-4 text-amber-500" />
                                </div>
                                <div>
                                    <p className="text-sm font-semibold">Google API Cost</p>
                                    <p className="text-xs text-muted-foreground">{modelName}</p>
                                </div>
                            </div>
                            <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setOpen(false)}>
                                <X className="h-4 w-4" />
                            </Button>
                        </div>

                        {/* Body */}
                        <div className="space-y-3 p-5">
                            {/* Token rows */}
                            <div className="overflow-hidden rounded-lg border border-border">
                                <table className="w-full text-sm">
                                    <thead>
                                        <tr className="border-b border-border bg-muted/60">
                                            <th className="px-3 py-2 text-left text-xs font-medium uppercase tracking-wide text-muted-foreground">Modality</th>
                                            <th className="px-3 py-2 text-right text-xs font-medium uppercase tracking-wide text-muted-foreground">Tokens</th>
                                            <th className="px-3 py-2 text-right text-xs font-medium uppercase tracking-wide text-muted-foreground">USD</th>
                                            <th className="px-3 py-2 text-right text-xs font-medium uppercase tracking-wide text-muted-foreground">INR</th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-border">
                                        {textInputTokens > 0 && (
                                            <tr>
                                                <td className="px-3 py-2 font-medium text-blue-600 dark:text-blue-400">Text Input</td>
                                                <td className="px-3 py-2 text-right tabular-nums">{fmtTokens(textInputTokens)}</td>
                                                <td className="px-3 py-2 text-right tabular-nums">${fmt(textInputCostUsd)}</td>
                                                <td className="px-3 py-2 text-right tabular-nums text-amber-600 dark:text-amber-400">{fmtInr(textInputInr)}</td>
                                            </tr>
                                        )}
                                        {audioInputTokens > 0 && (
                                            <tr>
                                                <td className="px-3 py-2 font-medium text-cyan-600 dark:text-cyan-400">Audio Input</td>
                                                <td className="px-3 py-2 text-right tabular-nums">{fmtTokens(audioInputTokens)}</td>
                                                <td className="px-3 py-2 text-right tabular-nums">${fmt(audioInputCostUsd)}</td>
                                                <td className="px-3 py-2 text-right tabular-nums text-amber-600 dark:text-amber-400">{fmtInr(audioInputInr)}</td>
                                            </tr>
                                        )}
                                        {audioOutputTokens > 0 && (
                                            <tr>
                                                <td className="px-3 py-2 font-medium text-purple-600 dark:text-purple-400">Audio Output</td>
                                                <td className="px-3 py-2 text-right tabular-nums">{fmtTokens(audioOutputTokens)}</td>
                                                <td className="px-3 py-2 text-right tabular-nums">${fmt(audioOutputCostUsd)}</td>
                                                <td className="px-3 py-2 text-right tabular-nums text-amber-600 dark:text-amber-400">{fmtInr(audioOutputInr)}</td>
                                            </tr>
                                        )}
                                        {textOutputTokens > 0 && (
                                            <tr>
                                                <td className="px-3 py-2 font-medium text-emerald-600 dark:text-emerald-400">Text Output</td>
                                                <td className="px-3 py-2 text-right tabular-nums">{fmtTokens(textOutputTokens)}</td>
                                                <td className="px-3 py-2 text-right tabular-nums">${fmt(textOutputCostUsd)}</td>
                                                <td className="px-3 py-2 text-right tabular-nums text-amber-600 dark:text-amber-400">{fmtInr(textOutputInr)}</td>
                                            </tr>
                                        )}
                                    </tbody>
                                </table>
                            </div>

                            {/* Total */}
                            <div className="flex items-center justify-between rounded-lg border border-amber-500/30 bg-amber-500/5 px-4 py-3">
                                <span className="text-sm font-semibold">Total Cost</span>
                                <div className="text-right">
                                    <p className="text-lg font-bold text-amber-600 dark:text-amber-400">{fmtInr(totalInr)}</p>
                                    <p className="text-xs text-muted-foreground">${fmt(totalUsd, 6)} USD</p>
                                </div>
                            </div>

                            {/* Rate info */}
                            <div className="rounded-md bg-muted/40 px-3 py-2">
                                <p className="text-xs text-muted-foreground">
                                    Rates: Text Input ${GEMINI_LIVE_PRICING.TEXT_INPUT_PER_M}/1M · Audio Input ${GEMINI_LIVE_PRICING.AUDIO_INPUT_PER_M}/1M · Audio Output ${GEMINI_LIVE_PRICING.AUDIO_OUTPUT_PER_M}/1M · 1 USD = ₹{USD_TO_INR}
                                </p>
                            </div>
                        </div>
                    </div>
                </div>
            )}
        </>
    );
}

// ---------------------------------------------------------------------------
// InworldUsageDialog — shown specifically for Inworld Realtime runs
// ---------------------------------------------------------------------------
function InworldUsageDialog({ usageInfo }: {
    usageInfo: WorkflowRunResponse['usage_info'];
}) {
    const [open, setOpen] = useState(false);

    const inworldKey = getInworldUsageKey(usageInfo);
    if (!inworldKey || !usageInfo) return null;

    // Find LLM entry for inworld
    const llmEntryKey = Object.keys(usageInfo.llm || {}).find(k => k.toLowerCase().includes('inworld'))
        || Object.keys(usageInfo.llm || {})[0];
    const llmUsage = llmEntryKey ? usageInfo.llm?.[llmEntryKey] : null;

    const llmModelName = llmEntryKey
        ? (llmEntryKey.includes('|||') ? llmEntryKey.split('|||')[1] : llmEntryKey)
        : 'Inworld Realtime LLM';

    // Find TTS entry for inworld
    const ttsEntryKey = Object.keys(usageInfo.tts || {}).find(k => k.toLowerCase().includes('inworld'))
        || Object.keys(usageInfo.tts || {})[0];
    const rawTtsVal = ttsEntryKey ? usageInfo.tts?.[ttsEntryKey] : null;
    const ttsModelName = ttsEntryKey
        ? (ttsEntryKey.includes('|||') ? ttsEntryKey.split('|||')[1] : ttsEntryKey)
        : 'inworld-tts-2';

    let ttsCharacters = 0;
    let ttsAudioSeconds = 0;
    if (typeof rawTtsVal === 'number') {
        ttsCharacters = rawTtsVal;
    } else if (typeof rawTtsVal === 'object' && rawTtsVal !== null) {
        ttsCharacters = rawTtsVal.characters ?? 0;
        ttsAudioSeconds = rawTtsVal.audio_seconds ?? 0;
    }

    // Find STT entry for inworld
    const sttEntryKey = Object.keys(usageInfo.stt || {}).find(k => k.toLowerCase().includes('inworld'))
        || Object.keys(usageInfo.stt || {})[0];
    const rawSttVal = sttEntryKey ? usageInfo.stt?.[sttEntryKey] : null;
    const sttModelName = sttEntryKey
        ? (sttEntryKey.includes('|||') ? sttEntryKey.split('|||')[1] : sttEntryKey)
        : 'inworld/inworld-stt-1';

    let sttAudioSeconds = 0;
    if (typeof rawSttVal === 'number') {
        sttAudioSeconds = rawSttVal;
    } else if (typeof rawSttVal === 'object' && rawSttVal !== null) {
        sttAudioSeconds = rawSttVal.audio_seconds ?? 0;
    }

    const durationSeconds = usageInfo.call_duration_seconds ?? 0;
    const fmtTokens = (n: number) => n.toLocaleString();

    return (
        <>
            <Button
                id="inworld-usage-button"
                variant="outline"
                size="sm"
                className="gap-2 border-indigo-500/40 bg-indigo-500/5 text-indigo-600 hover:bg-indigo-500/10 hover:text-indigo-700 dark:text-indigo-400 dark:hover:text-indigo-300"
                onClick={() => setOpen(true)}
            >
                <Sparkles className="h-4 w-4 text-indigo-500" />
                Inworld Usage
            </Button>

            {open && (
                <div
                    className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm"
                    onClick={() => setOpen(false)}
                >
                    <div
                        id="inworld-usage-dialog"
                        className="relative w-full max-w-lg rounded-xl border border-border bg-background shadow-2xl overflow-hidden"
                        onClick={(e) => e.stopPropagation()}
                    >
                        {/* Header */}
                        <div className="flex items-center justify-between border-b border-border px-5 py-4 bg-muted/30">
                            <div className="flex items-center gap-2.5">
                                <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-indigo-500/15 border border-indigo-500/30">
                                    <Sparkles className="h-4 w-4 text-indigo-500" />
                                </div>
                                <div>
                                    <p className="text-sm font-semibold">Inworld Realtime Session Usage</p>
                                    <p className="text-xs text-muted-foreground">Speech-to-Speech Modality Metrics</p>
                                </div>
                            </div>
                            <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setOpen(false)}>
                                <X className="h-4 w-4" />
                            </Button>
                        </div>

                        {/* Body */}
                        <div className="space-y-4 p-5">
                            {/* STT Section */}
                            <div className="rounded-lg border border-border bg-card p-3.5 space-y-2">
                                <div className="flex items-center justify-between">
                                    <div className="flex items-center gap-2">
                                        <Mic className="h-4 w-4 text-emerald-500" />
                                        <span className="text-xs font-semibold uppercase tracking-wider text-emerald-600 dark:text-emerald-400">Speech-to-Text (STT)</span>
                                    </div>
                                    <span className="text-xs font-mono text-muted-foreground">{sttModelName}</span>
                                </div>
                                <div className="flex items-center justify-between pt-1 border-t border-border/50 text-sm">
                                    <span className="text-muted-foreground text-xs">User Input Audio</span>
                                    <span className="font-semibold tabular-nums">{sttAudioSeconds > 0 ? `${sttAudioSeconds}s` : 'Captured via VAD'}</span>
                                </div>
                            </div>

                            {/* LLM Section */}
                            <div className="rounded-lg border border-border bg-card p-3.5 space-y-2">
                                <div className="flex items-center justify-between">
                                    <div className="flex items-center gap-2">
                                        <Cpu className="h-4 w-4 text-blue-500" />
                                        <span className="text-xs font-semibold uppercase tracking-wider text-blue-600 dark:text-blue-400">Language Model (LLM)</span>
                                    </div>
                                    <span className="text-xs font-mono text-muted-foreground">{llmModelName}</span>
                                </div>
                                <div className="grid grid-cols-3 gap-2 pt-1 border-t border-border/50 text-center">
                                    <div className="bg-muted/40 rounded p-2">
                                        <p className="text-[10px] text-muted-foreground uppercase font-medium">Prompt Tokens</p>
                                        <p className="text-sm font-semibold tabular-nums">{fmtTokens(llmUsage?.prompt_tokens ?? 0)}</p>
                                    </div>
                                    <div className="bg-muted/40 rounded p-2">
                                        <p className="text-[10px] text-muted-foreground uppercase font-medium">Completion Tokens</p>
                                        <p className="text-sm font-semibold tabular-nums">{fmtTokens(llmUsage?.completion_tokens ?? 0)}</p>
                                    </div>
                                    <div className="bg-blue-500/10 border border-blue-500/20 rounded p-2">
                                        <p className="text-[10px] text-blue-600 dark:text-blue-400 uppercase font-semibold">Total LLM Tokens</p>
                                        <p className="text-sm font-bold text-blue-600 dark:text-blue-400 tabular-nums">{fmtTokens(llmUsage?.total_tokens ?? 0)}</p>
                                    </div>
                                </div>
                            </div>

                            {/* TTS Section */}
                            <div className="rounded-lg border border-border bg-card p-3.5 space-y-2">
                                <div className="flex items-center justify-between">
                                    <div className="flex items-center gap-2">
                                        <Volume2 className="h-4 w-4 text-purple-500" />
                                        <span className="text-xs font-semibold uppercase tracking-wider text-purple-600 dark:text-purple-400">Text-to-Speech (TTS)</span>
                                    </div>
                                    <span className="text-xs font-mono text-muted-foreground">{ttsModelName}</span>
                                </div>
                                <div className="grid grid-cols-2 gap-2 pt-1 border-t border-border/50 text-center">
                                    <div className="bg-muted/40 rounded p-2">
                                        <p className="text-[10px] text-muted-foreground uppercase font-medium">Synthesized Characters</p>
                                        <p className="text-sm font-semibold tabular-nums">{fmtTokens(ttsCharacters)} chars</p>
                                    </div>
                                    <div className="bg-muted/40 rounded p-2">
                                        <p className="text-[10px] text-muted-foreground uppercase font-medium">TTS Audio Duration</p>
                                        <p className="text-sm font-semibold tabular-nums">{ttsAudioSeconds > 0 ? `${ttsAudioSeconds}s` : 'Streamed'}</p>
                                    </div>
                                </div>
                            </div>

                            {/* Session Summary Card */}
                            {durationSeconds > 0 && (
                                <div className="flex items-center justify-between text-xs px-3 py-2 bg-muted/30 rounded-lg border border-border text-muted-foreground">
                                    <span>Total Session Duration</span>
                                    <span className="font-semibold text-foreground">{durationSeconds} seconds</span>
                                </div>
                            )}
                        </div>
                    </div>
                </div>
            )}
        </>
    );
}

const RUN_SHELL_HEIGHT_CLASS = "h-[calc(100svh-49px)] min-h-[calc(100svh-49px)] max-h-[calc(100svh-49px)]";

function formatDuration(seconds?: number | null) {
    if (seconds == null || Number.isNaN(seconds)) return 'N/A';
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    if (mins === 0) return `${secs}s`;
    return `${mins}m ${secs}s`;
}

function getTranscriptMetrics(logs: WorkflowRunLogs | null, gatheredContext: Record<string, string | number | boolean | object> | null) {
    const events = logs?.realtime_feedback_events ?? [];
    const userTurns = events.filter((event) => event.type === 'rtf-user-transcription' && event.payload.final).length;
    const botTurns = events.filter((event) => event.type === 'rtf-bot-text').length;
    const toolCalls = events.filter((event) => event.type === 'rtf-function-call-end').length;
    const nodeNames = new Set(
        events
            .map((event) => event.payload.node_name)
            .filter((nodeName): nodeName is string => Boolean(nodeName))
    );
    const visitedNodes = Array.isArray(gatheredContext?.nodes_visited)
        ? gatheredContext.nodes_visited.length
        : nodeNames.size;

    return { userTurns, botTurns, toolCalls, visitedNodes };
}

function MetricCard({ label, value }: { label: string; value: string }) {
    return (
        <div className="rounded-xl border border-border bg-muted/40 px-4 py-3">
            <p className="text-xs font-medium uppercase tracking-[0.14em] text-muted-foreground">{label}</p>
            <p className="mt-2 text-lg font-semibold text-foreground">{value}</p>
        </div>
    );
}

function RunMetricsSection({
    costInfo,
    logs,
    gatheredContext,
}: {
    costInfo: WorkflowRunResponse['cost_info'];
    logs: WorkflowRunLogs | null;
    gatheredContext: Record<string, string | number | boolean | object> | null;
}) {
    const metrics = getTranscriptMetrics(logs, gatheredContext);

    return (
        <Card className="border-border">
            <CardHeader className="pb-3">
                <CardTitle className="text-lg">Run Metrics</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                <MetricCard label="Duration" value={formatDuration(costInfo?.call_duration_seconds)} />
                <MetricCard
                    label="Token Usage"
                    value={costInfo?.dograh_token_usage != null ? costInfo.dograh_token_usage.toLocaleString() : 'N/A'}
                />
                <MetricCard label="User Turns" value={String(metrics.userTurns)} />
                <MetricCard label="Bot Turns" value={String(metrics.botTurns)} />
                <MetricCard label="Tool Calls" value={String(metrics.toolCalls)} />
                <MetricCard label="Nodes Visited" value={String(metrics.visitedNodes)} />
            </CardContent>
        </Card>
    );
}

function ContextDisplay({ title, context }: { title: string; context: Record<string, string | number | boolean | object> | null }) {
    const [copied, setCopied] = useState(false);

    const handleCopy = () => {
        if (!context) return;
        navigator.clipboard.writeText(JSON.stringify(context, null, 2));
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
    };

    if (!context || Object.keys(context).length === 0) {
        return (
            <Card className="border-border">
                <CardHeader className="pb-2">
                    <CardTitle className="text-lg">{title}</CardTitle>
                </CardHeader>
                <CardContent>
                    <p className="text-sm text-muted-foreground">No data available</p>
                </CardContent>
            </Card>
        );
    }

    return (
        <Card className="border-border">
            <CardHeader className="flex flex-row items-center justify-between pb-2">
                <CardTitle className="text-lg">{title}</CardTitle>
                <Button variant="ghost" size="sm" onClick={handleCopy} className="gap-2">
                    {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                    {copied ? 'Copied' : 'Copy'}
                </Button>
            </CardHeader>
            <CardContent>
                <pre className="text-sm bg-muted p-3 rounded-md overflow-auto max-h-64">
                    {JSON.stringify(context, null, 2)}
                </pre>
            </CardContent>
        </Card>
    );
}


export default function WorkflowRunPage() {
    const params = useParams();
    const [isLoading, setIsLoading] = useState(true);
    const auth = useAuth();
    const [workflowRun, setWorkflowRun] = useState<WorkflowRunResponse | null>(null);
    // Regenerate key checks when workflowRun changes
    const geminiUsageKey = getGeminiLiveUsageKey(workflowRun?.usage_info ?? null);
    const inworldUsageKey = getInworldUsageKey(workflowRun?.usage_info ?? null);
    const { hasSeenTooltip, markTooltipSeen } = useOnboarding();
    const customizeButtonRef = useRef<HTMLButtonElement>(null);

    // Redirect if not authenticated
    useEffect(() => {
        if (!auth.loading && !auth.isAuthenticated) {
            auth.redirectToLogin();
        }
    }, [auth]);

    const { openPreview, dialog } = MediaPreviewDialog();

    useEffect(() => {
        const fetchWorkflowRun = async () => {
            if (!auth.isAuthenticated || auth.loading) return;

            setIsLoading(true);
            const workflowId = params.workflowId;
            const runId = params.runId;
            const response = await getWorkflowRunApiV1WorkflowWorkflowIdRunsRunIdGet({
                path: {
                    workflow_id: Number(workflowId),
                    run_id: Number(runId),
                },
            });
            setIsLoading(false);
            const runData = {
                mode: response.data?.mode ?? '',
                is_completed: response.data?.is_completed ?? false,
                transcript_url: response.data?.transcript_url ?? null,
                recording_url: response.data?.recording_url ?? null,
                cost_info: response.data?.cost_info ?? null,
                usage_info: (response.data as Record<string, unknown>)?.usage_info as WorkflowRunResponse['usage_info'] ?? null,
                initial_context: response.data?.initial_context as Record<string, string> | null ?? null,
                gathered_context: response.data?.gathered_context as Record<string, string> | null ?? null,
                logs: response.data?.logs as WorkflowRunLogs | null ?? null,
                annotations: response.data?.annotations as Record<string, unknown> | null ?? null,
            };
            setWorkflowRun(runData);
            posthog.capture(PostHogEvent.WORKFLOW_RUN_DETAILS_VIEWED, {
                workflow_id: Number(workflowId),
                run_id: Number(runId),
                is_completed: runData.is_completed,
                has_recording: !!runData.recording_url,
                has_transcript: !!runData.transcript_url,
            });
        };
        fetchWorkflowRun();
    }, [params.workflowId, params.runId, auth]);

    let returnValue = null;
    const isTextChatRun = workflowRun?.mode === WORKFLOW_RUN_MODES.TEXTCHAT;
    const showRunDetailsView = Boolean(workflowRun?.is_completed || isTextChatRun);

    if (isLoading) {
        returnValue = (
            <div className="h-full flex items-center justify-center">
                <div className="w-full max-w-4xl p-6">
                    <Card>
                        <CardHeader>
                            <Skeleton className="h-6 w-48" />
                        </CardHeader>
                        <CardContent className="space-y-4">
                            <Skeleton className="h-4 w-full" />
                            <Skeleton className="h-4 w-3/4" />
                            <Skeleton className="h-4 w-1/2" />
                        </CardContent>
                        <CardFooter className="flex gap-4">
                            <Skeleton className="h-10 w-32" />
                            <Skeleton className="h-10 w-32" />
                        </CardFooter>
                    </Card>
                </div>
            </div>
        );
    }
    else if (showRunDetailsView) {
        returnValue = (
            <div className={`flex ${RUN_SHELL_HEIGHT_CLASS} min-h-0 w-full overflow-hidden bg-background`}>
                <div className="min-w-0 flex-1 overflow-y-auto">
                    <div className="mx-auto w-full max-w-4xl space-y-6 p-6">
                    <Card className="border-border">
                        <CardHeader className="flex flex-row items-center justify-between">
                            <div className="flex items-center gap-4">
                                <CardTitle className="text-2xl">
                                    {isTextChatRun ? 'Text Chat Session' : 'Agent Run Completed'}
                                </CardTitle>
                                <div className={`h-8 w-8 rounded-full flex items-center justify-center ${isTextChatRun ? 'bg-sky-500/15' : 'bg-emerald-500/20'}`}>
                                    {isTextChatRun ? (
                                        <FileText className="h-5 w-5 text-sky-500" />
                                    ) : (
                                        <svg className="h-5 w-5 text-emerald-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M5 13l4 4L19 7" />
                                        </svg>
                                    )}
                                </div>
                            </div>
                            <div className="flex items-center gap-2">
                                 {/* Gemini Live cost button — only shown for Gemini Live runs */}
                                {geminiUsageKey && (
                                    <GeminiCostDialog
                                        usageInfo={workflowRun?.usage_info ?? null}
                                        costInfo={workflowRun?.cost_info ?? null}
                                    />
                                )}
                                {/* Inworld Realtime usage button — only shown for Inworld Realtime runs */}
                                {inworldUsageKey && (
                                    <InworldUsageDialog
                                        usageInfo={workflowRun?.usage_info ?? null}
                                    />
                                )}
                                <Link href={`/workflow/${params.workflowId}`}>
                                    <Button
                                        ref={customizeButtonRef}
                                        className="gap-2"
                                        onClick={() => {
                                            if (!hasSeenTooltip('customize_workflow')) {
                                                markTooltipSeen('customize_workflow');
                                            }
                                        }}
                                    >
                                        <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                                        </svg>
                                        Customize Agent
                                    </Button>
                                </Link>
                            </div>
                        </CardHeader>
                        <CardContent>
                            <p className="text-muted-foreground mb-8">
                                {isTextChatRun
                                    ? 'Review the conversation history, metrics, and context captured for this text session.'
                                    : 'Your voice agent run has been completed successfully. You can preview or download the transcript and recording.'}
                            </p>

                            <div className="flex flex-wrap gap-4">
                                {!isTextChatRun && (
                                    <>
                                        <div className="flex items-center gap-2">
                                            <span className="text-sm text-muted-foreground">Preview:</span>
                                            <MediaPreviewButton
                                                recordingUrl={workflowRun?.recording_url}
                                                transcriptUrl={workflowRun?.transcript_url}
                                                runId={Number(params.runId)}
                                                onOpenPreview={openPreview}
                                            />
                                        </div>
                                        <div className="flex items-center gap-2 border-l border-border pl-4">
                                            <span className="text-sm text-muted-foreground">Download:</span>
                                            <Button
                                                onClick={() => downloadFile(workflowRun?.transcript_url ?? null)}
                                                disabled={!workflowRun?.transcript_url || !auth.isAuthenticated}
                                                size="sm"
                                                className="gap-2"
                                            >
                                                <FileText className="h-4 w-4" />
                                                Transcript
                                            </Button>
                                            <Button
                                                onClick={() => downloadFile(workflowRun?.recording_url ?? null)}
                                                disabled={!workflowRun?.recording_url || !auth.isAuthenticated}
                                                size="sm"
                                                className="gap-2"
                                            >
                                                <Video className="h-4 w-4" />
                                                Recording
                                            </Button>
                                        </div>
                                    </>
                                )}
                                {workflowRun?.gathered_context?.trace_url && (
                                    <div className={`flex items-center gap-2 ${isTextChatRun ? '' : 'border-l border-border pl-4'}`}>
                                        <span className="text-sm text-muted-foreground">Trace:</span>
                                        <Button
                                            asChild
                                            size="sm"
                                            variant="outline"
                                            className="gap-2"
                                        >
                                            <a
                                                href={String(workflowRun.gathered_context.trace_url)}
                                                target="_blank"
                                                rel="noopener noreferrer"
                                            >
                                                <ExternalLink className="h-4 w-4" />
                                                View Trace
                                            </a>
                                        </Button>
                                    </div>
                                )}
                            </div>
                        </CardContent>
                    </Card>

                        <RunMetricsSection
                            costInfo={workflowRun?.cost_info ?? null}
                            logs={workflowRun?.logs ?? null}
                            gatheredContext={workflowRun?.gathered_context ?? null}
                        />

                        <div className="grid gap-6 md:grid-cols-2">
                            <ContextDisplay
                                title="Initial Context"
                                context={workflowRun?.initial_context ?? null}
                            />
                            <ContextDisplay
                                title="Gathered Context"
                                context={workflowRun?.gathered_context ?? null}
                            />
                        </div>

                        {workflowRun?.annotations && Object.keys(workflowRun.annotations).length > 0 && (
                            <ContextDisplay
                                title="QA Results"
                                context={workflowRun.annotations as Record<string, string | number | boolean | object>}
                            />
                        )}
                    </div>
                </div>

                <div className="h-full min-h-0 w-[420px] shrink-0 border-l border-border bg-background p-5">
                    <ConversationRailFrame className="h-full">
                        <RealtimeFeedback mode="historical" logs={workflowRun?.logs ?? null} />
                    </ConversationRailFrame>
                </div>
            </div>
        );
    }
    else {
        returnValue = (
            <div className="flex h-full items-center justify-center p-6">
                <Card className="w-full max-w-xl border-border">
                    <CardHeader className="space-y-2">
                        <CardTitle className="text-2xl">Run Details Unavailable</CardTitle>
                        <p className="text-sm text-muted-foreground">
                            This run does not have a details view yet. Go back to the workflow to continue testing or make changes.
                        </p>
                    </CardHeader>
                    <CardFooter>
                        <Button asChild className="gap-2">
                            <Link href={`/workflow/${params.workflowId}`}>
                                Customize Agent
                            </Link>
                        </Button>
                    </CardFooter>
                </Card>
            </div>
        );
    }

    return (
        <WorkflowLayout>
            {returnValue}
            {dialog}

            {/* Onboarding Tooltip for Customize Workflow */}
            {showRunDetailsView && (
                <OnboardingTooltip
                    title='Customize Your Workflow'
                    targetRef={customizeButtonRef}
                    message="Edit your workflow to adjust the voice agent's behavior, add new steps, or modify the conversation flow."
                    onDismiss={() => markTooltipSeen('customize_workflow')}
                    showNext={false}
                    isVisible={!hasSeenTooltip('customize_workflow')}
                />
            )}
        </WorkflowLayout>
    );
}
