"use client";

import { ReactFlowInstance } from "@xyflow/react";
import { AlertCircle, ArrowLeft, Bot, Clipboard, Copy, Download, Eye, History, LoaderCircle, Menu, MoreVertical, Pencil, Phone, Rocket } from "lucide-react";
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { toast } from "sonner";

import {
    duplicateWorkflowEndpointApiV1WorkflowWorkflowIdDuplicatePost,
    publishWorkflowApiV1WorkflowWorkflowIdPublishPost,
} from "@/client/sdk.gen";
import { WorkflowError } from "@/client/types.gen";
import { FlowEdge, FlowNode } from "@/components/flow/types";
import { GitHubStarBadge } from "@/components/layout/GitHubStarBadge";
import { Button } from "@/components/ui/button";
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import {
    Popover,
    PopoverContent,
    PopoverTrigger,
} from "@/components/ui/popover";
import { useSidebar } from "@/components/ui/sidebar";

interface WorkflowEditorHeaderProps {
    workflowName: string;
    isDirty: boolean;
    workflowValidationErrors: WorkflowError[];
    rfInstance: React.RefObject<ReactFlowInstance<FlowNode, FlowEdge> | null>;
    workflowId: number;
    workflowUuid?: string;
    saveWorkflow: (updateWorkflowDefinition?: boolean) => Promise<void>;
    user: { id: string; email?: string };
    onPhoneCallClick: () => void;
    onTestAgentClick: () => void;
    onHistoryClick: () => void;
    activeVersionLabel?: string;
    isViewingHistoricalVersion: boolean;
    onBackToDraft: () => void;
    hasDraft: boolean;
    onPublished: () => void;
    renameWorkflow: (newName: string) => Promise<void>;
}

export const WorkflowEditorHeader = ({
    workflowName,
    isDirty,
    workflowValidationErrors,
    rfInstance,
    saveWorkflow,
    onPhoneCallClick,
    onTestAgentClick,
    onHistoryClick,
    activeVersionLabel,
    isViewingHistoricalVersion,
    onBackToDraft,
    hasDraft,
    onPublished,
    workflowId,
    workflowUuid,
    renameWorkflow,
}: WorkflowEditorHeaderProps) => {
    const router = useRouter();
    const { toggleSidebar } = useSidebar();
    const [savingWorkflow, setSavingWorkflow] = useState(false);
    const [duplicating, setDuplicating] = useState(false);
    const [publishing, setPublishing] = useState(false);
    // One discriminated-union state instead of (isEditingName, nameDraft,
    // nameError, isRenaming): they're not independent — error and saving are
    // mutually exclusive, and both are meaningless in the display state. The
    // union makes the bad combinations unrepresentable and structurally
    // prevents the Enter→disable-input→blur→re-fire race.
    type RenameState =
        | { kind: "display" }
        | { kind: "editing"; draft: string; error: string | null }
        | { kind: "saving"; draft: string };
    const [rename, setRename] = useState<RenameState>({ kind: "display" });
    const nameInputRef = useRef<HTMLInputElement>(null);
    const renameButtonRef = useRef<HTMLButtonElement>(null);

    const hasValidationErrors = workflowValidationErrors.length > 0;
    const isCallDisabled = isDirty || hasValidationErrors;

    const handleSave = async () => {
        setSavingWorkflow(true);
        await saveWorkflow();
        setSavingWorkflow(false);
    };

    const handlePublish = async () => {
        if (publishing) return;
        setPublishing(true);
        const promise = publishWorkflowApiV1WorkflowWorkflowIdPublishPost({
            path: { workflow_id: workflowId },
        });
        toast.promise(promise, {
            loading: "Publishing...",
            success: "Workflow published successfully",
            error: "Failed to publish workflow",
        });
        try {
            await promise;
            onPublished();
        } finally {
            setPublishing(false);
        }
    };

    const handleBack = () => {
        router.push("/workflow");
    };

    const handleDuplicate = async () => {
        if (duplicating) return;
        setDuplicating(true);
        const promise = duplicateWorkflowEndpointApiV1WorkflowWorkflowIdDuplicatePost({
            path: { workflow_id: workflowId },
        });
        toast.promise(promise, {
            loading: "Duplicating workflow...",
            success: "Workflow duplicated successfully",
            error: "Failed to duplicate workflow",
        });
        try {
            const { data } = await promise;
            if (data?.id) {
                router.push(`/workflow/${data.id}`);
            }
        } finally {
            setDuplicating(false);
        }
    };

    const handleCopyAgentUuid = async () => {
        if (!workflowUuid) {
            toast.error("Agent UUID not available");
            return;
        }
        try {
            await navigator.clipboard.writeText(workflowUuid);
            toast.success("Agent UUID copied");
        } catch {
            toast.error("Failed to copy Agent UUID");
        }
    };

    const handleDownloadWorkflow = () => {
        if (!rfInstance.current) return;

        const workflowDefinition = rfInstance.current.toObject();
        const exportData = {
            name: workflowName,
            workflow_definition: workflowDefinition,
        };

        const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: "application/json" });
        const url = URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.href = url;
        link.download = `${workflowName}.json`;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(url);
    };

    const enterEditMode = () => {
        setRename({ kind: "editing", draft: workflowName, error: null });
    };

    const exitEditMode = () => {
        setRename({ kind: "display" });
        // Return focus to the pencil button so keyboard users aren't stranded.
        // Defer to next tick so React commits the input unmount first.
        setTimeout(() => renameButtonRef.current?.focus(), 0);
    };

    const attemptSave = async () => {
        // Only "editing" can initiate a save. This also guards against the
        // blur fired when disabling the input transitions us to "saving".
        if (rename.kind !== "editing") return;
        const trimmed = rename.draft.trim();
        if (trimmed.length === 0) {
            setRename({ ...rename, error: "Name cannot be empty" });
            return;
        }
        if (trimmed === workflowName) {
            // No-op: exit cleanly with no API call.
            exitEditMode();
            return;
        }
        setRename({ kind: "saving", draft: rename.draft });
        try {
            await renameWorkflow(trimmed);
            // Success: store update already propagated workflowName. Exit edit mode.
            exitEditMode();
        } catch {
            // Roll back: keep user's typed value, reopen the input, focus it,
            // surface a sonner toast (matches existing duplicate/publish failure pattern).
            toast.error("Failed to rename workflow");
            setRename({ kind: "editing", draft: trimmed, error: null });
            setTimeout(() => nameInputRef.current?.focus(), 0);
        }
    };

    const handleRenameKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
        if (event.key === "Enter") {
            event.preventDefault();
            void attemptSave();
        } else if (event.key === "Escape") {
            event.preventDefault();
            exitEditMode();
        }
    };

    const handleRenameBlur = () => {
        // Ignore the blur fired when the input is disabled during save.
        if (rename.kind !== "editing") return;
        // On blur with empty/whitespace, revert silently to display mode so the user is never trapped.
        if (rename.draft.trim().length === 0) {
            exitEditMode();
            return;
        }
        void attemptSave();
    };

    return (
        <div className="flex items-center justify-between w-full h-16 px-6 bg-[#0c0c0e] border-b border-[#1d1d22] backdrop-blur-md">
            {/* Left section: Mobile menu + Back button + Workflow name */}
            <div className="flex items-center gap-3 mr-4">
                <button
                    onClick={toggleSidebar}
                    className="flex items-center justify-center w-9 h-9 rounded-xl hover:bg-[#1c1c1f] hover:text-white text-zinc-400 border border-[#232328]/40 hover:border-[#1d1d22] transition-all md:hidden cursor-pointer"
                    aria-label="Open menu"
                >
                    <Menu className="w-4 h-4" />
                </button>
                <button
                    onClick={handleBack}
                    className="flex items-center justify-center w-9 h-9 rounded-xl hover:bg-[#1c1c1f] hover:text-white text-zinc-400 border border-[#232328]/40 hover:border-[#1d1d22] transition-all cursor-pointer"
                >
                    <ArrowLeft className="w-4 h-4" />
                </button>

                <div className="flex items-center gap-2">
                    {rename.kind !== "display" ? (
                        <div className="flex flex-col gap-1">
                            <Input
                                ref={nameInputRef}
                                value={rename.draft}
                                onChange={(e) => {
                                    if (rename.kind === "editing") {
                                        setRename({ ...rename, draft: e.target.value, error: null });
                                    }
                                }}
                                onKeyDown={handleRenameKeyDown}
                                onBlur={handleRenameBlur}
                                disabled={rename.kind === "saving"}
                                autoFocus
                                onFocus={(e) => e.currentTarget.select()}
                                aria-label="Workflow name"
                                aria-invalid={rename.kind === "editing" && rename.error !== null}
                                className="h-9 max-w-xs bg-[#08080a] border-[#1d1d22] focus:border-[#7c3aed] text-white text-sm font-semibold rounded-xl"
                            />
                            {rename.kind === "editing" && rename.error && (
                                <span className="text-[10px] text-rose-400 font-medium px-1" role="alert">{rename.error}</span>
                            )}
                        </div>
                    ) : (
                        <>
                            <h1 className="text-sm font-bold text-white whitespace-nowrap truncate max-w-[14rem] md:max-w-md">
                                <span className="md:hidden">
                                    {workflowName.length > 12 ? `${workflowName.slice(0, 12)}…` : workflowName}
                                </span>
                                <span className="hidden md:inline">{workflowName}</span>
                            </h1>
                            {!isViewingHistoricalVersion && (
                                <button
                                    ref={renameButtonRef}
                                    type="button"
                                    onClick={enterEditMode}
                                    aria-label="Rename workflow"
                                    className="flex items-center justify-center w-8 h-8 rounded-lg hover:bg-[#1c1c1f] hover:text-white text-zinc-400 transition-colors cursor-pointer"
                                >
                                    <Pencil className="w-3.5 h-3.5" />
                                </button>
                            )}
                        </>
                    )}
                </div>
            </div>

            {/* Right section: Version + status + tester/call actions + save */}
            <div className="flex items-center gap-3">
                {/* Read-only banner when viewing a historical version */}
                {isViewingHistoricalVersion && (
                    <div className="flex items-center gap-2 px-3 py-1.5 rounded-xl border border-blue-500/20 bg-blue-500/10 text-xs font-semibold text-blue-400">
                        <Eye className="w-3.5 h-3.5" />
                        <span>
                            Viewing {activeVersionLabel}
                        </span>
                    </div>
                )}

                {/* Back to Draft button when viewing history */}
                {isViewingHistoricalVersion && (
                    <Button
                        onClick={onBackToDraft}
                        className="bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl text-xs font-bold px-4 h-9 shadow-lg shadow-emerald-950/20 cursor-pointer transition-all"
                    >
                        Back to Draft
                    </Button>
                )}

                {/* Version history button */}
                <button
                    onClick={onHistoryClick}
                    className="flex items-center gap-2 px-3.5 py-1.5 rounded-xl border border-[#232328] hover:border-zinc-700/60 bg-[#1c1c1f] hover:bg-[#27272a] text-xs font-bold text-zinc-300 hover:text-white transition-all cursor-pointer h-9"
                >
                    <History className="w-3.5 h-3.5 text-zinc-400" />
                    {activeVersionLabel && !isViewingHistoricalVersion && (
                        <span>{activeVersionLabel}</span>
                    )}
                </button>

                {/* Unsaved changes indicator (hidden when viewing history) */}
                {isDirty && !isViewingHistoricalVersion && (
                    <div className="flex items-center gap-2 px-3 py-1.5 rounded-xl border border-amber-500/20 bg-amber-500/10 text-xs font-semibold text-amber-400 animate-pulse">
                        <div className="w-1.5 h-1.5 rounded-full bg-amber-500" />
                        <span>Unsaved changes</span>
                    </div>
                )}

                {/* Validation errors indicator */}
                {hasValidationErrors && (
                    <Popover>
                        <PopoverTrigger asChild>
                            <button className="flex items-center gap-2 px-3 py-1.5 rounded-xl border border-rose-500/20 bg-rose-500/10 hover:bg-rose-500/20 text-xs font-bold text-rose-400 transition-all cursor-pointer h-9">
                                <div className="w-1.5 h-1.5 rounded-full bg-rose-500 animate-pulse" />
                                <AlertCircle className="w-3.5 h-3.5 text-rose-500" />
                                <span>
                                    {workflowValidationErrors.length} {workflowValidationErrors.length === 1 ? "error" : "errors"}
                                </span>
                            </button>
                        </PopoverTrigger>
                        <PopoverContent
                            align="end"
                            className="w-80 bg-[#111113] border border-[#232328] p-0 rounded-2xl overflow-hidden shadow-2xl text-zinc-300"
                        >
                            <div className="px-4 py-3 bg-[#18181b]/50 border-b border-[#1d1d22]">
                                <h3 className="text-xs font-bold text-white uppercase tracking-wider">Validation Errors</h3>
                            </div>
                            <div className="max-h-64 overflow-y-auto divide-y divide-[#1d1d22]/50">
                                {workflowValidationErrors.map((error, index) => (
                                    <div
                                        key={index}
                                        className="px-4 py-3 hover:bg-[#1a1a1f]/30 transition-colors"
                                    >
                                        <div className="flex items-start gap-2">
                                            <AlertCircle className="w-4 h-4 text-rose-400 mt-0.5 flex-shrink-0" />
                                            <div className="flex-1 min-w-0">
                                                {(error.kind === "node" || error.kind === "edge") && error.id && (
                                                    <p className="text-[10px] text-zinc-500 mb-1 font-mono">
                                                        {error.kind === "node" ? "Node" : "Edge"}: {error.id}
                                                        {error.field && <span className="text-zinc-600"> • {error.field}</span>}
                                                    </p>
                                                )}
                                                <p className="text-xs text-zinc-300 leading-relaxed break-words">
                                                    {error.message}
                                                </p>
                                            </div>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </PopoverContent>
                    </Popover>
                )}

                {/* Publish button (only when on draft with no unsaved changes) */}
                {!isViewingHistoricalVersion && hasDraft && (
                    <Button
                        onClick={handlePublish}
                        disabled={isDirty || publishing || hasValidationErrors}
                        variant="outline"
                        className="bg-[#7c3aed] hover:bg-[#8b5cf6] border-none text-white text-xs font-bold px-4 h-9 rounded-xl transition-all shadow-lg cursor-pointer"
                    >
                        {publishing ? (
                            <>
                                <LoaderCircle className="w-3.5 h-3.5 mr-1.5 animate-spin" />
                                Publishing...
                            </>
                        ) : (
                            <>
                                <Rocket className="w-3.5 h-3.5 mr-1.5" />
                                Publish
                            </>
                        )}
                    </Button>
                )}

                {!isViewingHistoricalVersion && (
                    <Button
                        variant="outline"
                        className="flex items-center gap-1.5 bg-[#1c1c1f] hover:bg-[#27272a] border border-[#232328] hover:border-zinc-700/60 text-zinc-300 hover:text-white rounded-xl text-xs font-bold px-4 h-9 transition-all cursor-pointer"
                        disabled={isCallDisabled}
                        onClick={onPhoneCallClick}
                    >
                        <Phone className="w-3.5 h-3.5 text-zinc-400" />
                        Phone Call
                    </Button>
                )}

                <Button
                    variant="outline"
                    className="flex items-center gap-1.5 bg-[#1c1c1f] hover:bg-[#27272a] border border-[#232328] hover:border-zinc-700/60 text-zinc-300 hover:text-white rounded-xl text-xs font-bold px-4 h-9 transition-all cursor-pointer"
                    onClick={onTestAgentClick}
                >
                    <Bot className="w-3.5 h-3.5 text-zinc-400" />
                    Test Agent
                </Button>

                {/* Save button (only shown when editing the draft) */}
                {!isViewingHistoricalVersion && (
                    <Button
                        onClick={handleSave}
                        disabled={!isDirty || savingWorkflow}
                        className="bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl text-xs font-bold px-4 h-9 shadow-lg shadow-emerald-950/20 cursor-pointer transition-all"
                    >
                        {savingWorkflow ? (
                            <>
                                <LoaderCircle className="w-3.5 h-3.5 mr-1.5 animate-spin" />
                                Saving...
                            </>
                        ) : (
                            "Save"
                        )}
                    </Button>
                )}

                {/* More options dropdown */}
                <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                        <Button
                            variant="ghost"
                            size="icon"
                            className="text-zinc-400 hover:text-white hover:bg-[#1c1c1f] border border-[#232328]/60 h-9 w-9 rounded-xl cursor-pointer"
                        >
                            <MoreVertical className="w-4 h-4" />
                        </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="bg-[#111113] border border-[#232328] text-zinc-300 rounded-xl p-1.5 shadow-2xl">
                        <DropdownMenuItem
                            onClick={() => router.push(`/workflow/${workflowId}/runs`)}
                            className="rounded-lg text-xs px-3 py-2 focus:bg-[#1c1c1f] focus:text-white cursor-pointer"
                        >
                            <History className="w-3.5 h-3.5 mr-2 text-zinc-400" />
                            View Runs
                        </DropdownMenuItem>
                        <DropdownMenuItem
                            onClick={handleDuplicate}
                            disabled={duplicating}
                            className="rounded-lg text-xs px-3 py-2 focus:bg-[#1c1c1f] focus:text-white cursor-pointer"
                        >
                            {duplicating ? (
                                <LoaderCircle className="w-3.5 h-3.5 mr-2 animate-spin text-zinc-400" />
                            ) : (
                                <Copy className="w-3.5 h-3.5 mr-2 text-zinc-400" />
                            )}
                            {duplicating ? "Duplicating..." : "Duplicate Workflow"}
                        </DropdownMenuItem>
                        <DropdownMenuItem
                            onClick={handleDownloadWorkflow}
                            className="rounded-lg text-xs px-3 py-2 focus:bg-[#1c1c1f] focus:text-white cursor-pointer"
                        >
                            <Download className="w-3.5 h-3.5 mr-2 text-zinc-400" />
                            Download Workflow
                        </DropdownMenuItem>
                        <DropdownMenuItem
                            onClick={handleCopyAgentUuid}
                            disabled={!workflowUuid}
                            className="rounded-lg text-xs px-3 py-2 focus:bg-[#1c1c1f] focus:text-white cursor-pointer"
                        >
                            <Clipboard className="w-3.5 h-3.5 mr-2 text-zinc-400" />
                            Copy Agent UUID
                        </DropdownMenuItem>
                    </DropdownMenuContent>
                </DropdownMenu>

                {/* GitHub star badge - desktop only */}
                <div className="hidden md:block">
                    <GitHubStarBadge className="border-[#232328] bg-[#1c1c1f] text-zinc-300 [&_span]:bg-transparent" source="workflow_editor_header" />
                </div>
            </div>
        </div>
    );
};
