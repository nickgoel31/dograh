import { Bot } from 'lucide-react';
import { Suspense } from 'react';

import { getWorkflowsApiV1WorkflowFetchGet, listFoldersApiV1FolderGet } from '@/client/sdk.gen';
import type { FolderResponse, WorkflowListResponse } from '@/client/types.gen';
import { CreateWorkflowButton } from "@/components/workflow/CreateWorkflowButton";
import { AgentFolderView } from '@/components/workflow/folders/AgentFolderView';
import { CreateFolderButton } from '@/components/workflow/folders/CreateFolderButton';
import { FolderSection } from '@/components/workflow/folders/FolderSection';
import { UploadWorkflowButton } from '@/components/workflow/UploadWorkflowButton';
import { getServerAccessToken, getServerAuthProvider } from '@/lib/auth/server';
import logger from '@/lib/logger';

import WorkflowLayout from "./WorkflowLayout";

export const dynamic = 'force-dynamic';

async function WorkflowList() {
    const authProvider = await getServerAuthProvider();
    const accessToken = await getServerAccessToken();

    if (!accessToken) {
        const { redirect } = await import('next/navigation');
        if (authProvider === 'stack') {
            redirect('/');
        } else {
            return (
                <div className="text-red-400 text-xs font-semibold p-4 bg-red-500/10 border border-red-500/20 rounded-xl">
                    Authentication required. Please refresh the page.
                </div>
            );
        }
    }

    try {
        const response = await getWorkflowsApiV1WorkflowFetchGet({
            headers: { 'Authorization': `Bearer ${accessToken}` },
            query: { status: 'active,archived' }
        });

        const allWorkflowData = response.data ? (Array.isArray(response.data) ? response.data : [response.data]) : [];

        const activeWorkflows = allWorkflowData
            .filter((w: WorkflowListResponse) => w.status === 'active')
            .sort((a: WorkflowListResponse, b: WorkflowListResponse) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());

        const archivedWorkflows = allWorkflowData
            .filter((w: WorkflowListResponse) => w.status === 'archived')
            .sort((a: WorkflowListResponse, b: WorkflowListResponse) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());

        let folders: FolderResponse[] = [];
        try {
            const foldersResponse = await listFoldersApiV1FolderGet({
                headers: { 'Authorization': `Bearer ${accessToken}` },
            });
            folders = foldersResponse.data ?? [];
        } catch (folderErr) {
            logger.error(`Error fetching folders: ${folderErr}`);
        }

        return (
            <>
                <div className="mb-6">
                    {activeWorkflows.length > 0 || folders.length > 0 ? (
                        <AgentFolderView workflows={activeWorkflows} folders={folders} />
                    ) : (
                        <div className="bg-[#111113] border border-[#1d1d22] rounded-2xl p-12 text-center max-w-xl mx-auto shadow-sm">
                            <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-[#7c3aed]/10 border border-[#7c3aed]/20">
                                <Bot className="h-6 w-6 text-[#7c3aed]" />
                            </div>
                            <h3 className="text-sm font-bold text-white mb-1.5">No voice agents yet</h3>
                            <p className="text-xs text-zinc-500 mb-6 max-w-xs mx-auto leading-relaxed">
                                Create your first voice agent to get started with conversational AI.
                            </p>
                            <CreateWorkflowButton />
                        </div>
                    )}
                </div>

                {archivedWorkflows.length > 0 && (
                    <div className="mt-8 border-t border-[#1d1d22]/50 pt-8">
                        <FolderSection kind="archived" workflows={archivedWorkflows} />
                    </div>
                )}
            </>
        );
    } catch (err) {
        logger.error(`Error fetching workflows: ${err}`);
        return (
            <div className="text-red-400 text-xs font-semibold p-4 bg-red-500/10 border border-red-500/20 rounded-xl">
                Failed to load agents. Please try again later.
            </div>
        );
    }
}

async function PageContent() {
    const workflowList = await WorkflowList();

    return (
        <div className="px-6 py-6 page-enter max-w-[1600px] mx-auto w-full">
            {/* Page header matching reference design */}
            <div className="mb-8 pb-6 border-b border-white/5 flex flex-col gap-1">
                <h1 className="font-serif-heading text-[48px] text-on-surface tracking-tight leading-tight m-0">Voice Agents</h1>
                <p className="text-on-surface-variant text-base max-w-2xl leading-relaxed">
                    Manage your fleet of autonomous voice entities, fine-tune their behavior, and monitor real-time conversational performance across all channels.
                </p>
            </div>

            {workflowList}
        </div>
    );
}

function WorkflowsLoading() {
    return (
        <div className="px-6 py-6 max-w-[1600px] mx-auto w-full">
            <div className="flex items-end justify-between mb-8 pb-6 border-b border-[#1d1d22]/50">
                <div className="space-y-2.5">
                    <div className="h-7 w-40 bg-[#111113] border border-[#1d1d22] rounded-lg shimmer" />
                    <div className="h-4 w-64 bg-[#111113] border border-[#1d1d22] rounded-lg shimmer" />
                </div>
                <div className="flex gap-3">
                    <div className="h-9 w-24 bg-[#111113] border border-[#1d1d22] rounded-lg shimmer" />
                    <div className="h-9 w-32 bg-[#111113] border border-[#1d1d22] rounded-lg shimmer" />
                </div>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                {Array.from({ length: 6 }, (_, i) => (
                    <div key={i} className="bg-[#111113] border border-[#1d1d22] rounded-2xl h-36 shimmer" style={{ animationDelay: `${i * 0.05}s` }} />
                ))}
            </div>
        </div>
    );
}

export default function WorkflowPage() {
    return (
        <WorkflowLayout showFeaturesNav={true}>
            <Suspense fallback={<WorkflowsLoading />}>
                <PageContent />
            </Suspense>
        </WorkflowLayout>
    );
}
