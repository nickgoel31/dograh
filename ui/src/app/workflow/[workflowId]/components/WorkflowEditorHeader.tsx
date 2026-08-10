"use client";

import { ReactFlowInstance } from "@xyflow/react";
import { AlertCircle, ArrowLeft, ChevronDown, Clipboard, Copy, Download, Eye, History, LoaderCircle, Menu, MoreVertical, Pencil, PhoneCall, Rocket, Sparkles, Star } from "lucide-react";
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { toast } from "sonner";

import {
    duplicateWorkflowEndpointApiV1WorkflowWorkflowIdDuplicatePost,
    publishWorkflowApiV1WorkflowWorkflowIdPublishPost,
} from "@/client/sdk.gen";
import { WorkflowError } from "@/client/types.gen";
import { FlowEdge, FlowNode } from "@/components/flow/types";
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
    const [isStarred, setIsStarred] = useState(false);

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
        setTimeout(() => renameButtonRef.current?.focus(), 0);
    };

    const attemptSave = async () => {
        if (rename.kind !== "editing") return;
        const trimmed = rename.draft.trim();
        if (trimmed.length === 0) {
            setRename({ ...rename, error: "Name cannot be empty" });
            return;
        }
        if (trimmed === workflowName) {
            exitEditMode();
            return;
        }
        setRename({ kind: "saving", draft: rename.draft });
        try {
            await renameWorkflow(trimmed);
            exitEditMode();
        } catch {
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
        if (rename.kind !== "editing") return;
        if (rename.draft.trim().length === 0) {
            exitEditMode();
            return;
        }
        void attemptSave();
    };

    return (
        <header
            className="h-14 px-6 border-b border-[#242722] flex items-center justify-between z-30 flex-shrink-0"
            style={{ backgroundColor: '#161715' }}
        >
            {/* Left section: Mobile menu + Back button + Workflow title */}
            <div className="flex items-center gap-3 min-w-0">
                <button
                    onClick={toggleSidebar}
                    className="p-1.5 rounded-xl text-[#9ca39a] hover:bg-[#232621] hover:text-white transition-colors md:hidden cursor-pointer"
                    aria-label="Open menu"
                >
                    <Menu className="w-4 h-4" />
                </button>
                <button
                    onClick={handleBack}
                    className="p-1.5 rounded-xl text-[#9ca39a] hover:bg-[#232621] hover:text-white transition-colors cursor-pointer"
                    title="Back to Voice Agents"
                >
                    <ArrowLeft className="w-4 h-4" />
                </button>

                <div className="flex items-center gap-2 min-w-0">
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
                                className="px-2 py-1 bg-[#1a1c18] border border-[#2e312b] rounded-lg text-sm font-semibold text-white focus:outline-hidden"
                            />
                            {rename.kind === "editing" && rename.error && (
                                <span className="text-[10px] text-rose-400 font-medium px-1" role="alert">{rename.error}</span>
                            )}
                        </div>
                    ) : (
                        <div className="flex items-center gap-2 min-w-0 group cursor-pointer" onClick={enterEditMode}>
                            <h1 className="text-sm font-semibold text-white truncate max-w-md tracking-tight">
                                {workflowName}
                            </h1>
                            {!isViewingHistoricalVersion && (
                                <button
                                    ref={renameButtonRef}
                                    type="button"
                                    onClick={(e) => {
                                        e.stopPropagation();
                                        enterEditMode();
                                    }}
                                    aria-label="Rename workflow"
                                    className="p-1 text-[#9ca39a] opacity-0 group-hover:opacity-100 transition-opacity cursor-pointer"
                                >
                                    <Pencil className="w-3.5 h-3.5" />
                                </button>
                            )}
                        </div>
                    )}
                </div>
            </div>

            {/* Right section: Action bar with demo pills */}
            <div className="flex items-center gap-2.5 flex-shrink-0">
                {/* Read-only banner when viewing a historical version */}
                {isViewingHistoricalVersion && (
                    <div className="flex items-center gap-2 px-3 py-1 rounded-full border border-blue-500/30 bg-blue-500/10 text-xs font-semibold text-blue-400">
                        <Eye className="w-3.5 h-3.5" />
                        <span>Viewing {activeVersionLabel}</span>
                    </div>
                )}

                {/* Back to Draft button when viewing history */}
                {isViewingHistoricalVersion && (
                    <button
                        onClick={onBackToDraft}
                        className="px-3.5 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-white rounded-full text-xs font-bold transition-all cursor-pointer"
                    >
                        Back to Draft
                    </button>
                )}

                {/* Version Selector Pill */}
                <button
                    onClick={onHistoryClick}
                    className="flex items-center gap-1.5 px-3 py-1.5 bg-[#1a1c18] hover:bg-[#232621] border border-[#2e312b] rounded-full text-xs text-[#c8ccc5] font-medium transition-colors cursor-pointer"
                >
                    <History className="w-3.5 h-3.5 text-[#9ca39a]" />
                    <span>{activeVersionLabel || "v1 (Draft)"}</span>
                    <ChevronDown className="w-3 h-3 text-[#9ca39a]" />
                </button>

                {/* Unsaved changes indicator */}
                {isDirty && !isViewingHistoricalVersion && (
                    <div className="flex items-center gap-1.5 px-3 py-1 rounded-full border border-amber-500/30 bg-amber-500/10 text-xs font-semibold text-amber-400 animate-pulse">
                        <div className="w-1.5 h-1.5 rounded-full bg-amber-500" />
                        <span>Unsaved</span>
                    </div>
                )}

                {/* Validation errors indicator */}
                {hasValidationErrors && (
                    <Popover>
                        <PopoverTrigger asChild>
                            <button className="flex items-center gap-1.5 px-3 py-1.5 rounded-full border border-rose-500/30 bg-rose-500/10 hover:bg-rose-500/20 text-xs font-bold text-rose-400 transition-all cursor-pointer">
                                <AlertCircle className="w-3.5 h-3.5 text-rose-500" />
                                <span>{workflowValidationErrors.length} {workflowValidationErrors.length === 1 ? "error" : "errors"}</span>
                            </button>
                        </PopoverTrigger>
                        <PopoverContent
                            align="end"
                            className="w-80 border border-[#282b26] p-0 rounded-2xl overflow-hidden shadow-2xl text-zinc-300"
                            style={{ backgroundColor: '#161715' }}
                        >
                            <div className="px-4 py-3 border-b border-[#282b26]" style={{ backgroundColor: '#1a1c18' }}>
                                <h3 className="text-xs font-bold text-white uppercase tracking-wider">Validation Errors</h3>
                            </div>
                            <div className="max-h-64 overflow-y-auto divide-y divide-[#282b26]">
                                {workflowValidationErrors.map((error, index) => (
                                    <div key={index} className="px-4 py-3 hover:bg-[#1a1c18] transition-colors">
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

                {/* Publish button */}
                {!isViewingHistoricalVersion && hasDraft && (
                    <button
                        onClick={handlePublish}
                        disabled={isDirty || publishing || hasValidationErrors}
                        className="flex items-center gap-1.5 px-3.5 py-1.5 bg-[#8b5cf6] hover:bg-[#7c3aed] text-white text-xs font-semibold rounded-full transition-colors disabled:opacity-50 cursor-pointer"
                    >
                        {publishing ? (
                            <LoaderCircle className="w-3.5 h-3.5 animate-spin" />
                        ) : (
                            <Rocket className="w-3.5 h-3.5" />
                        )}
                        <span>{publishing ? "Publishing..." : "Publish"}</span>
                    </button>
                )}

                {/* Phone Call Pill */}
                {!isViewingHistoricalVersion && (
                    <button
                        onClick={onPhoneCallClick}
                        disabled={isCallDisabled}
                        className="flex items-center gap-1.5 px-3.5 py-1.5 bg-[#1a1c18] hover:bg-[#232621] border border-[#2e312b] rounded-full text-xs text-[#c8ccc5] font-semibold transition-colors disabled:opacity-50 cursor-pointer"
                    >
                        <PhoneCall className="w-3.5 h-3.5 text-[#9ca39a]" />
                        <span>Phone Call</span>
                    </button>
                )}

                {/* Test Agent Pill */}
                <button
                    onClick={onTestAgentClick}
                    className="flex items-center gap-1.5 px-3.5 py-1.5 bg-[#1a1c18] hover:bg-[#232621] border border-[#2e312b] rounded-full text-xs text-[#c8ccc5] font-semibold transition-colors cursor-pointer"
                >
                    <Sparkles className="w-3.5 h-3.5 text-amber-400" />
                    <span>Test Agent</span>
                </button>

                {/* Save CTA Button */}
                {!isViewingHistoricalVersion && (
                    <button
                        onClick={handleSave}
                        disabled={!isDirty || savingWorkflow}
                        className="px-4 py-1.5 bg-[#bcf0da] hover:bg-[#a5e9cc] text-[#082117] text-xs font-bold rounded-full shadow-xs transition-all active:scale-[0.98] disabled:opacity-50 cursor-pointer"
                    >
                        {savingWorkflow ? "Saving..." : "Save"}
                    </button>
                )}

                {/* More Options Dropdown */}
                <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                        <button className="p-1.5 text-[#9ca39a] hover:text-white transition-colors cursor-pointer">
                            <MoreVertical className="w-4 h-4" />
                        </button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="border border-[#282b26] text-zinc-300 rounded-xl p-1.5 shadow-2xl" style={{ backgroundColor: '#161715' }}>
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

                {/* Star Button */}
                <button
                    onClick={() => setIsStarred(!isStarred)}
                    className={`flex items-center gap-1 px-3 py-1.5 rounded-full border border-[#2e312b] text-xs font-semibold transition-colors cursor-pointer ${
                        isStarred
                            ? "bg-amber-400/10 text-amber-300 border-amber-400/30"
                            : "bg-[#1a1c18] text-[#c8ccc5] hover:bg-[#232621]"
                    }`}
                >
                    <Star className={`w-3.5 h-3.5 ${isStarred ? "fill-amber-400 text-amber-400" : "text-[#9ca39a]"}`} />
                    <span>Star</span>
                </button>
            </div>
        </header>
    );
};
