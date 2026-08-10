"use client";

import { Loader2, MessageSquareText, Mic, Phone, RefreshCw, X } from "lucide-react";
import posthog from "posthog-js";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import { createWorkflowRunApiV1WorkflowWorkflowIdRunsPost } from "@/client/sdk.gen";
import { OnboardingTooltip } from "@/components/onboarding/OnboardingTooltip";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { PostHogEvent } from "@/constants/posthog-events";
import { WORKFLOW_RUN_MODES } from "@/constants/workflowRunModes";
import { useOnboarding } from "@/context/OnboardingContext";
import { useAuth } from "@/lib/auth";
import { cn, getRandomId } from "@/lib/utils";

import { AiSimulatorPlaceholder } from "./workflow-tester/AiSimulatorPlaceholder";
import { EmbeddedVoiceTester } from "./workflow-tester/EmbeddedVoiceTester";
import { ManualTextChatPanel } from "./workflow-tester/ManualTextChatPanel";
import { ChatModeToggle, DisabledNotice, EmptyState } from "./workflow-tester/shared";
import type { WorkflowRuntimeNodeTransition } from "./workflow-tester/types";
import { extractSdkErrorMessage, getErrorMessage } from "./workflow-tester/utils";

interface WorkflowTesterPanelProps {
    workflowId: number;
    initialContextVariables?: Record<string, string>;
    disabled: boolean;
    disabledReason: string | null;
    showWebCallOnboarding?: boolean;
    isVisible?: boolean;
    className?: string;
    onClose?: () => void;
    onRuntimeNodeTransition?: (transition: WorkflowRuntimeNodeTransition) => void;
}

export function WorkflowTesterPanel({
    workflowId,
    initialContextVariables,
    disabled,
    disabledReason,
    showWebCallOnboarding = false,
    isVisible = true,
    className,
    onClose,
    onRuntimeNodeTransition,
}: WorkflowTesterPanelProps) {
    const auth = useAuth();
    const { hasSeenTooltip, markTooltipSeen, markActionCompleted } = useOnboarding();
    const { isAuthenticated, loading: authLoading, getAccessToken } = auth;
    const [accessToken, setAccessToken] = useState<string | null>(null);
    const [activeMode, setActiveMode] = useState<"audio" | "text">("audio");
    const [chatMode, setChatMode] = useState<"manual" | "simulated">("manual");
    const [chatSessionKey, setChatSessionKey] = useState(0);
    const [chatActive, setChatActive] = useState(false);
    const [voiceRunId, setVoiceRunId] = useState<number | null>(null);
    const [creatingVoiceRun, setCreatingVoiceRun] = useState(false);
    const [tokenReady, setTokenReady] = useState(false);
    const runTestButtonRef = useRef<HTMLButtonElement>(null);

    useEffect(() => {
        let ignore = false;

        const hydrateAccessToken = async () => {
            if (!isAuthenticated || authLoading) return;
            try {
                const token = await getAccessToken();
                if (!ignore) {
                    setAccessToken(token);
                }
            } catch (error) {
                if (!ignore) {
                    toast.error(getErrorMessage(error));
                }
            } finally {
                if (!ignore) {
                    setTokenReady(true);
                }
            }
        };

        if (authLoading) {
            return;
        }

        if (!isAuthenticated) {
            setTokenReady(true);
            return;
        }

        hydrateAccessToken();

        return () => {
            ignore = true;
        };
    }, [authLoading, getAccessToken, isAuthenticated]);

    const createVoiceRun = useCallback(async () => {
        if (!accessToken || disabled) return;
        setCreatingVoiceRun(true);
        try {
            const response = await createWorkflowRunApiV1WorkflowWorkflowIdRunsPost({
                path: { workflow_id: workflowId },
                body: {
                    mode: WORKFLOW_RUN_MODES.SMALL_WEBRTC,
                    name: `WR-${getRandomId()}`,
                },
            });

            if (response.error || !response.data?.id) {
                throw new Error(extractSdkErrorMessage(response.error, "Failed to create browser test run"));
            }

            markActionCompleted("web_call_started");
            markTooltipSeen("web_call");
            posthog.capture(PostHogEvent.WEB_CALL_INITIATED, {
                workflow_id: workflowId,
                workflow_run_id: response.data.id,
                source: "workflow_editor",
            });
            setVoiceRunId(response.data.id);
            setActiveMode("audio");
        } catch (error) {
            toast.error(getErrorMessage(error));
        } finally {
            setCreatingVoiceRun(false);
        }
    }, [accessToken, disabled, markActionCompleted, markTooltipSeen, workflowId]);

    const authUnavailableReason = tokenReady && !accessToken
        ? "Authentication is required before testing can start."
        : null;
    const effectiveDisabledReason = disabledReason ?? authUnavailableReason;
    const testerBlocked = disabled || authUnavailableReason !== null;
    const showRunTestTooltip =
        showWebCallOnboarding &&
        isVisible &&
        activeMode === "audio" &&
        !voiceRunId &&
        tokenReady &&
        !!accessToken &&
        !testerBlocked &&
        !hasSeenTooltip("web_call");

    return (
        <div className={cn("flex h-full min-h-0 flex-col text-[#f2f4f0]", className)} style={{ backgroundColor: '#161715' }}>
            <Tabs
                value={activeMode}
                onValueChange={(value) => setActiveMode(value as "audio" | "text")}
                className="min-h-0 flex-1 gap-0"
            >
                <div className="border-b border-[#242722] p-3 bg-[#141513]">
                    <div className="flex items-center justify-between">
                        <div className="flex items-center gap-1 bg-[#1c1e1a] p-1 rounded-xl border border-[#282b26] flex-1 mr-2">
                            <button
                                onClick={() => setActiveMode("audio")}
                                className={`flex-1 flex items-center justify-center gap-1.5 py-1.5 rounded-lg text-xs font-semibold transition-all cursor-pointer ${
                                    activeMode === "audio"
                                        ? "bg-[#252822] text-white shadow-xs"
                                        : "text-[#9ca39a] hover:text-white"
                                }`}
                            >
                                <Mic className="w-3.5 h-3.5" />
                                <span>Test Audio</span>
                            </button>
                            <button
                                onClick={() => setActiveMode("text")}
                                className={`flex-1 flex items-center justify-center gap-1.5 py-1.5 rounded-lg text-xs font-semibold transition-all cursor-pointer ${
                                    activeMode === "text"
                                        ? "bg-[#252822] text-white shadow-xs"
                                        : "text-[#9ca39a] hover:text-white"
                                }`}
                            >
                                <MessageSquareText className="w-3.5 h-3.5" />
                                <span>Test Chat</span>
                            </button>
                        </div>
                        {onClose ? (
                            <button
                                onClick={onClose}
                                className="p-1.5 text-[#9ca39a] hover:text-white rounded-lg transition-colors cursor-pointer"
                                aria-label="Close tester panel"
                            >
                                <X className="w-4 h-4" />
                            </button>
                        ) : null}
                    </div>
                </div>

                <TabsContent value="audio" className="min-h-0 flex-1 px-6 py-6">
                    <div className="flex h-full min-h-0 flex-col gap-4">
                        {!tokenReady ? (
                            <div className="space-y-4">
                                <Skeleton className="h-14 bg-zinc-800 rounded-xl" />
                                <Skeleton className="h-80 bg-zinc-800 rounded-xl" />
                            </div>
                        ) : !accessToken ? (
                            <DisabledNotice
                                reason={authUnavailableReason ?? "Authentication is required before browser tests can start."}
                            />
                        ) : voiceRunId ? (
                            <EmbeddedVoiceTester
                                workflowId={workflowId}
                                workflowRunId={voiceRunId}
                                initialContextVariables={initialContextVariables}
                                accessToken={accessToken}
                                onReset={() => setVoiceRunId(null)}
                                onNodeTransition={onRuntimeNodeTransition}
                            />
                        ) : (
                            <>
                                {effectiveDisabledReason ? <DisabledNotice reason={effectiveDisabledReason} /> : null}
                                <div className="flex-1 p-6 flex flex-col items-center justify-center text-center space-y-6 overflow-y-auto">
                                    <div className="w-14 h-14 rounded-2xl bg-[#1c1e1a] border border-[#282b26] flex items-center justify-center text-[#c8ccc5] shadow-inner">
                                        <Phone className="w-7 h-7 text-[#8b5cf6]" />
                                    </div>

                                    <div className="space-y-2 max-w-xs">
                                        <h3 className="text-sm font-bold text-white">
                                            Call this agent in the browser
                                        </h3>
                                        <p className="text-xs text-[#9ca39a] leading-relaxed">
                                            Test the agent over a voice call. Some telephony-only tools, like call transfer, are not yet supported here.
                                        </p>
                                    </div>

                                    <button
                                        ref={runTestButtonRef}
                                        onClick={createVoiceRun}
                                        disabled={creatingVoiceRun || testerBlocked}
                                        className="w-full py-3 bg-[#8b5cf6] hover:bg-[#7c3aed] text-white rounded-full text-xs font-bold shadow-md transition-all flex items-center justify-center gap-2 active:scale-[0.98] disabled:opacity-50 cursor-pointer"
                                    >
                                        {creatingVoiceRun ? (
                                            <>
                                                <Loader2 className="w-4 h-4 animate-spin" />
                                                Starting test...
                                            </>
                                        ) : (
                                            <>
                                                <Phone className="w-4 h-4" />
                                                Run Test
                                            </>
                                        )}
                                    </button>
                                </div>
                            </>
                        )}
                    </div>
                </TabsContent>

                <TabsContent value="text" className="min-h-0 flex-1 px-4 py-3">
                    <div className="flex h-full min-h-0 flex-col gap-3">
                        <div className="flex items-center justify-between gap-2">
                            <ChatModeToggle value={chatMode} onChange={setChatMode} />
                            {chatMode === "manual" && chatActive ? (
                                <Button
                                    variant="ghost"
                                    size="sm"
                                    onClick={() => setChatSessionKey((value) => value + 1)}
                                    disabled={testerBlocked}
                                    className="h-7 px-2 text-xs text-muted-foreground hover:text-foreground"
                                >
                                    <RefreshCw className="h-3.5 w-3.5" />
                                    Reset
                                </Button>
                            ) : null}
                        </div>

                        {chatMode === "manual" ? (
                            <ManualTextChatPanel
                                key={chatSessionKey}
                                workflowId={workflowId}
                                ready={tokenReady && !!accessToken}
                                initialContextVariables={initialContextVariables}
                                disabled={testerBlocked}
                                disabledReason={effectiveDisabledReason}
                                onActiveChange={setChatActive}
                                onNodeTransition={onRuntimeNodeTransition}
                            />
                        ) : (
                            <AiSimulatorPlaceholder disabledReason={effectiveDisabledReason} />
                        )}
                    </div>
                </TabsContent>
            </Tabs>

            <OnboardingTooltip
                targetRef={runTestButtonRef}
                title="Try Your First Web Call"
                message="Start a browser call here to hear the agent, inspect the transcript, and validate the workflow before you customize it further."
                onDismiss={() => markTooltipSeen("web_call")}
                showNext={false}
                isVisible={showRunTestTooltip}
            />
        </div>
    );
}
