'use client';

import { Sparkles, Bot, ArrowLeft, CheckCircle2 } from 'lucide-react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useState, useRef } from 'react';

import { createWorkflowFromTemplateApiV1WorkflowCreateTemplatePost } from '@/client/sdk.gen';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { useAuth } from '@/lib/auth';
import logger from '@/lib/logger';

function inferWorkflowDetailsFromPrompt(rawPrompt: string): {
    callType: 'inbound' | 'outbound';
    useCase: string;
    activityDescription: string;
} {
    const text = rawPrompt.trim();
    const lower = text.toLowerCase();

    let callType: 'inbound' | 'outbound' = 'inbound';
    if (
        lower.includes('outbound') ||
        lower.includes('call user') ||
        lower.includes('call customer') ||
        lower.includes('make call') ||
        lower.includes('reach out') ||
        lower.includes('dial') ||
        lower.includes('reminder') ||
        lower.includes('collection') ||
        lower.includes('emi')
    ) {
        callType = 'outbound';
    } else if (
        lower.includes('inbound') ||
        lower.includes('answer') ||
        lower.includes('confirm appointment') ||
        lower.includes('receive call') ||
        lower.includes('incoming')
    ) {
        callType = 'inbound';
    }

    let useCase = 'Custom Voice Agent';
    if (lower.includes('appointment') || lower.includes('booking') || lower.includes('schedule') || lower.includes('confirm')) {
        useCase = 'Appointment Management & Confirmation';
    } else if (lower.includes('lead') || lower.includes('sales') || lower.includes('qualif') || lower.includes('discovery')) {
        useCase = 'Sales Discovery & Lead Qualification';
    } else if (lower.includes('emi') || lower.includes('collection') || lower.includes('payment') || lower.includes('debt')) {
        useCase = 'EMI & Debt Collection';
    } else if (lower.includes('support') || lower.includes('help') || lower.includes('customer care') || lower.includes('service')) {
        useCase = 'Customer Support & Helpdesk';
    } else if (lower.includes('hr') || lower.includes('screen') || lower.includes('interview') || lower.includes('candidate')) {
        useCase = 'HR & Candidate Screening';
    } else if (text.length > 0) {
        const words = text.split(/\s+/).slice(0, 5).join(' ');
        useCase = words.charAt(0).toUpperCase() + words.slice(1);
    }

    return {
        callType,
        useCase,
        activityDescription: text,
    };
}

function CreateWorkflowForm() {
    const router = useRouter();
    const searchParams = useSearchParams();
    const { user, getAccessToken } = useAuth();

    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [showSuccessModal, setShowSuccessModal] = useState(false);
    const [workflowId, setWorkflowId] = useState<string | null>(null);

    const [callType, setCallType] = useState<'inbound' | 'outbound'>('inbound');
    const [useCase, setUseCase] = useState('');
    const [activityDescription, setActivityDescription] = useState('');
    const [hasInferredPrompt, setHasInferredPrompt] = useState(false);

    const hasAutoTriggeredRef = useRef(false);

    useEffect(() => {
        const promptParam = searchParams.get('prompt');
        const templateParam = searchParams.get('template');
        const autoParam = searchParams.get('auto');

        if (promptParam) {
            const inferred = inferWorkflowDetailsFromPrompt(promptParam);
            setCallType(inferred.callType);
            setUseCase(inferred.useCase);
            setActivityDescription(inferred.activityDescription);
            setHasInferredPrompt(true);

            if (autoParam === 'true' && !hasAutoTriggeredRef.current && user) {
                hasAutoTriggeredRef.current = true;
                executeCreateWorkflow(inferred.callType, inferred.useCase, inferred.activityDescription);
            }
        } else if (templateParam) {
            let tCallType: 'inbound' | 'outbound' = 'inbound';
            let tUseCase = templateParam;
            let tDesc = `AI Voice Agent template for ${templateParam}`;

            if (templateParam.toLowerCase().includes('appointment')) {
                tCallType = 'inbound';
                tUseCase = 'Appointment management';
                tDesc = 'Turn customer calls into instant bookings, reschedules, and confirmations with an AI voice agent.';
            } else if (templateParam.toLowerCase().includes('sales')) {
                tCallType = 'outbound';
                tUseCase = 'Sales discovery';
                tDesc = 'Meet Ananya: the AI voice agent that turns warm leads into booked meetings.';
            } else if (templateParam.toLowerCase().includes('emi') || templateParam.toLowerCase().includes('collection')) {
                tCallType = 'outbound';
                tUseCase = 'EMI Collection';
                tDesc = 'An AI collections agent that manages EMI reminders and simplifies customer payments.';
            }

            setCallType(tCallType);
            setUseCase(tUseCase);
            setActivityDescription(tDesc);
            setHasInferredPrompt(true);

            if (autoParam === 'true' && !hasAutoTriggeredRef.current && user) {
                hasAutoTriggeredRef.current = true;
                executeCreateWorkflow(tCallType, tUseCase, tDesc);
            }
        }
    }, [searchParams, user]);

    const executeCreateWorkflow = async (
        overrideCallType?: 'inbound' | 'outbound',
        overrideUseCase?: string,
        overrideDescription?: string
    ) => {
        const targetCallType = overrideCallType || callType;
        const targetUseCase = overrideUseCase || useCase;
        const targetDescription = overrideDescription || activityDescription;

        if (!targetUseCase || !targetDescription) {
            setError('Please fill in all fields');
            return;
        }

        if (!user) {
            setError('You must be logged in to create a workflow');
            return;
        }

        setIsLoading(true);
        setError(null);

        try {
            const accessToken = await getAccessToken();

            const response = await createWorkflowFromTemplateApiV1WorkflowCreateTemplatePost({
                body: {
                    call_type: targetCallType,
                    use_case: targetUseCase,
                    activity_description: targetDescription,
                },
                headers: {
                    'Authorization': `Bearer ${accessToken}`,
                },
            });

            if (response.data?.id) {
                setWorkflowId(String(response.data.id));
                setShowSuccessModal(true);
            }
        } catch (err) {
            setError('Failed to create workflow. Please try again.');
            logger.error(`Error creating workflow: ${err}`);
        } finally {
            setIsLoading(false);
        }
    };

    const handleCreateWorkflow = () => {
        executeCreateWorkflow();
    };

    const handleModalContinue = () => {
        if (!workflowId) return;
        router.push(`/workflow/${workflowId}?onboarding=web_call`);
    };

    return (
        <div className="min-h-screen bg-[#161715] text-white">
            <div className="container mx-auto px-4 py-8 max-w-2xl">
                <div className="mb-6 flex items-center justify-between">
                    <Link
                        href="/workflow"
                        className="flex items-center gap-1.5 text-xs text-amber-500 hover:underline font-semibold cursor-pointer"
                    >
                        <ArrowLeft className="w-4 h-4" />
                        <span>Back to Agents</span>
                    </Link>
                </div>

                <div className="mb-6 space-y-1">
                    <div className="flex items-center gap-2">
                        <div className="w-8 h-8 rounded-lg bg-[#282b26] flex items-center justify-center">
                            <Bot className="w-5 h-5 text-amber-400" />
                        </div>
                        <h1 className="text-2xl font-bold tracking-tight">Create Voice Agent</h1>
                    </div>
                    <p className="text-sm text-neutral-400 pl-10">
                        Describe what your voice agent should do and AI will automatically build the nodes, prompt, and call flow.
                    </p>
                </div>

                {hasInferredPrompt && (
                    <div className="mb-6 bg-[#1f221c] border border-amber-500/30 rounded-2xl p-4 space-y-2 text-xs">
                        <div className="flex items-center gap-2 text-amber-400 font-semibold">
                            <Sparkles className="w-4 h-4" />
                            <span>AI Prompt Inferred Configurations</span>
                        </div>
                        <p className="text-neutral-300">
                            We analyzed your prompt and pre-configured the call type, use case, and LLM activity description below. You can customize them anytime before building.
                        </p>
                    </div>
                )}

                <Card className="bg-[#1c1e1a] border-[#282b26] text-white shadow-xl rounded-2xl">
                    <CardHeader className="border-b border-[#282b26] pb-4">
                        <CardTitle className="text-base font-semibold text-white flex items-center gap-2">
                            <span>Agent Configurations</span>
                        </CardTitle>
                        <CardDescription className="text-xs text-neutral-400">
                            Configure how your voice agent interacts with callers
                        </CardDescription>
                    </CardHeader>

                    <CardContent className="space-y-6 pt-6">
                        <div className="space-y-2">
                            <Label htmlFor="call-type" className="text-xs font-semibold text-neutral-300">Call Type</Label>
                            <Select value={callType} onValueChange={(value) => setCallType(value as 'inbound' | 'outbound')}>
                                <SelectTrigger id="call-type" className="bg-[#141513] border-[#282b26] text-white text-xs h-10">
                                    <SelectValue placeholder="Select type" />
                                </SelectTrigger>
                                <SelectContent className="bg-[#1c1e1a] border-[#282b26] text-white">
                                    <SelectItem value="inbound" className="text-xs focus:bg-[#282b26] focus:text-white cursor-pointer">
                                        Inbound (Users call AI)
                                    </SelectItem>
                                    <SelectItem value="outbound" className="text-xs focus:bg-[#282b26] focus:text-white cursor-pointer">
                                        Outbound (AI calls users)
                                    </SelectItem>
                                </SelectContent>
                            </Select>
                            <p className="text-[11px] text-neutral-500">
                                Choose whether users will call your AI or your AI will make outgoing calls
                            </p>
                        </div>

                        <div className="space-y-2">
                            <Label htmlFor="use-case" className="text-xs font-semibold text-neutral-300">Use Case Name</Label>
                            <Input
                                id="use-case"
                                placeholder="e.g., Appointment Management & Confirmation, Customer Support"
                                value={useCase}
                                onChange={(e) => setUseCase(e.target.value)}
                                className="bg-[#141513] border-[#282b26] text-white text-xs placeholder:text-neutral-600 h-10"
                            />
                            <p className="text-[11px] text-neutral-500">
                                Primary label for this voice agent workflow
                            </p>
                        </div>

                        <div className="space-y-2">
                            <Label htmlFor="activity-description" className="text-xs font-semibold text-neutral-300">Activity Description / Prompt</Label>
                            <Textarea
                                id="activity-description"
                                placeholder="Describe what your voice agent will do (e.g., Answer incoming calls, verify appointment details, confirm times, handle customer reschedules)."
                                value={activityDescription}
                                onChange={(e) => setActivityDescription(e.target.value)}
                                className="min-h-[110px] bg-[#141513] border-[#282b26] text-white text-xs placeholder:text-neutral-600 leading-relaxed"
                            />
                            <p className="text-[11px] text-neutral-500">
                                This description will be converted by AI into the initial system prompt and workflow logic
                            </p>
                        </div>

                        {error && (
                            <p className="text-xs font-medium text-red-400 bg-red-500/10 border border-red-500/20 p-3 rounded-xl">{error}</p>
                        )}

                        <div className="pt-2">
                            <Button
                                onClick={handleCreateWorkflow}
                                disabled={isLoading || !useCase || !activityDescription}
                                className="w-full bg-black dark:bg-[#bcf0da] text-white dark:text-[#082117] hover:bg-gray-800 dark:hover:bg-[#a5e9cd] font-bold text-xs py-2.5 rounded-full shadow-xs cursor-pointer transition-all flex items-center justify-center gap-2"
                            >
                                <Sparkles className="w-4 h-4" />
                                <span>{isLoading ? 'Generating Agent with AI...' : 'Build Voice Agent with AI'}</span>
                            </Button>
                        </div>
                    </CardContent>
                </Card>
            </div>

            {/* Loading Overlay */}
            {isLoading && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-md">
                    <Card className="w-full max-w-md p-8 bg-[#1c1e1a] border-[#282b26] text-white shadow-2xl rounded-2xl">
                        <div className="flex flex-col items-center space-y-6">
                            <div className="relative flex items-center justify-center">
                                <div className="w-16 h-16 border-4 border-emerald-500/20 border-t-emerald-400 rounded-full animate-spin"></div>
                                <Sparkles className="w-6 h-6 text-emerald-400 absolute animate-pulse" />
                            </div>

                            <div className="text-center space-y-2">
                                <h3 className="text-lg font-bold text-white">
                                    Creating AI Voice Agent
                                </h3>
                                <p className="text-xs text-neutral-400 max-w-xs leading-relaxed">
                                    Generative AI is crafting the system instructions, nodes, and call state handlers for <span className="text-white font-semibold">&quot;{useCase}&quot;</span>...
                                </p>
                            </div>
                        </div>
                    </Card>
                </div>
            )}

            {/* Success Modal */}
            <Dialog open={showSuccessModal} onOpenChange={setShowSuccessModal}>
                <DialogContent className="sm:max-w-lg bg-[#1c1e1a] border-[#282b26] text-white rounded-2xl">
                    <DialogHeader>
                        <DialogTitle className="flex items-center gap-2 text-white">
                            <CheckCircle2 className="w-5 h-5 text-emerald-400" />
                            <span>Voice Agent Created Successfully!</span>
                        </DialogTitle>
                        <DialogDescription asChild>
                            <div className="mt-4 space-y-3 text-xs text-neutral-300">
                                <p>
                                    Your AI voice agent workflow has been successfully generated for <strong className="text-white">&quot;{useCase}&quot;</strong>.
                                </p>
                                <p>
                                    The agent comes with pre-configured node flows, initial prompt instructions, and WebRTC test compatibility.
                                </p>
                            </div>
                        </DialogDescription>
                    </DialogHeader>
                    <DialogFooter className="mt-6">
                        <Button
                            onClick={handleModalContinue}
                            className="w-full bg-emerald-500 hover:bg-emerald-400 text-black font-bold text-xs py-2.5 rounded-full cursor-pointer"
                        >
                            Open and Test Agent
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </div>
    );
}

export default function CreateWorkflowPage() {
    return (
        <Suspense fallback={
            <div className="min-h-screen bg-[#161715] flex items-center justify-center text-neutral-400 text-xs">
                Loading workflow generator...
            </div>
        }>
            <CreateWorkflowForm />
        </Suspense>
    );
}
