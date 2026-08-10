'use client';

import { Bot, ChevronDown, LayoutTemplate, PlusIcon } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { toast } from 'sonner';

import { createWorkflowApiV1WorkflowCreateDefinitionPost } from '@/client/sdk.gen';
import { Button } from "@/components/ui/button";
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useAuth } from '@/lib/auth';
import logger from '@/lib/logger';
import { getRandomId } from '@/lib/utils';

const BLANK_WORKFLOW_DEFINITION = {
    nodes: [
        {
            id: "1",
            type: "startCall",
            position: { x: 175, y: 60 },
            data: {
                prompt: "# Goal\nYou are a helpful agent who is handing a conversation over voice with a human. This is a voice conversation, so transcripts can be error prone.\n\n## Rules\n- Language: UK English but does not have to be correct english\n- Keep responses short and 2-3 sentences max\n- If you have to repeat something that you said in your previous two turns, then rephrase a bit while keeping the same meaning. Never repeat the exact same words as in your previous 2 responses.\n\n## Speech Handling\n- There could be multiple transcription errors. \n- Accept variations: yes/yeah/yep/aye, no/nah/nope\n- If user says \"sorry?\" or \"pardon me\" or \"can you repeat\"  or \"what?\", they might not have heard you- so just repeat what you just said.\n\n### Flow\nStart by saying \"Hi\". Be polite and courteous. ",
                name: "start call",
                allow_interrupt: false,
                invalid: false,
                validationMessage: null,
                add_global_prompt: false,
                delayed_start: false,
                is_start: true,
                selected_through_edge: false,
                hovered_through_edge: false,
                extraction_enabled: false,
                selected: false,
                dragging: false,
            },
        },
    ],
    edges: [],
    viewport: { x: 808, y: 269, zoom: 0.75 },
};

export function CreateWorkflowButton() {
    const router = useRouter();
    const { user, getAccessToken } = useAuth();
    const [isCreating, setIsCreating] = useState(false);

    const handleAgentBuilder = () => {
        router.push('/workflow/create');
    };

    const handleBlankCanvas = async () => {
        if (isCreating || !user) return;
        setIsCreating(true);

        try {
            const accessToken = await getAccessToken();
            const name = `Workflow-${getRandomId()}`;
            const response = await createWorkflowApiV1WorkflowCreateDefinitionPost({
                body: {
                    name,
                    workflow_definition: BLANK_WORKFLOW_DEFINITION as unknown as { [key: string]: unknown },
                },
                headers: {
                    'Authorization': `Bearer ${accessToken}`,
                },
            });

            if (response.data?.id) {
                router.push(`/workflow/${response.data.id}`);
            }
        } catch (err) {
            logger.error(`Error creating blank workflow: ${err}`);
            toast.error('Failed to create workflow');
        } finally {
            setIsCreating(false);
        }
    };

    return (
        <DropdownMenu>
            <DropdownMenuTrigger asChild>
                <Button 
                    disabled={isCreating}
                    className="flex items-center gap-2 px-4 py-2 bg-gray-100 hover:bg-gray-200 text-gray-900 dark:bg-[#1f2119] dark:hover:bg-[#282b26] dark:text-white text-xs font-bold rounded-xl border border-gray-200 dark:border-[#2e312b] shadow-2xs transition-all active:scale-[0.98] h-9 cursor-pointer"
                >
                    <PlusIcon className="w-4 h-4 stroke-[2.5]" />
                    <span>{isCreating ? 'Creating...' : 'Create Agent'}</span>
                    <ChevronDown className="w-3.5 h-3.5 stroke-[2.5]" />
                </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-72 bg-neutral-900 border border-neutral-800 text-white rounded-2xl p-2 shadow-2xl z-50 flex flex-col gap-1">
                <DropdownMenuItem 
                    onClick={handleAgentBuilder} 
                    className="flex items-start gap-3 p-3 rounded-xl hover:bg-neutral-800 focus:bg-neutral-800 text-left transition-colors cursor-pointer group focus:text-white"
                >
                    <div className="p-2 rounded-lg bg-neutral-800 text-neutral-300 group-hover:text-white group-hover:bg-neutral-700 transition-colors">
                        <Bot className="w-4 h-4" />
                    </div>
                    <div className="flex flex-col">
                        <span className="text-xs font-bold text-white">Use Agent Builder</span>
                        <span className="text-[11px] text-neutral-400 leading-snug">AI generates a workflow from your description</span>
                    </div>
                </DropdownMenuItem>
                <DropdownMenuItem 
                    onClick={handleBlankCanvas} 
                    disabled={isCreating} 
                    className="flex items-start gap-3 p-3 rounded-xl hover:bg-neutral-800 focus:bg-neutral-800 text-left transition-colors cursor-pointer group focus:text-white"
                >
                    <div className="p-2 rounded-lg bg-neutral-800 text-neutral-300 group-hover:text-white group-hover:bg-neutral-700 transition-colors">
                        <LayoutTemplate className="w-4 h-4" />
                    </div>
                    <div className="flex flex-col">
                        <span className="text-xs font-bold text-white">Blank Canvas</span>
                        <span className="text-[11px] text-neutral-400 leading-snug">Start from scratch with an empty workflow</span>
                    </div>
                </DropdownMenuItem>
            </DropdownMenuContent>
        </DropdownMenu>
    );
}
