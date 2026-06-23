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

import { Bot, FolderOpen, Plus, Upload } from 'lucide-react';

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
                <div className="text-destructive text-sm">
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
                        <div className="neural-card rounded-xl p-12 text-center">
                            <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-primary/10 border border-primary/20">
                                <Bot className="h-6 w-6 text-primary" />
                            </div>
                            <h3 className="text-base font-semibold mb-1">No agents yet</h3>
                            <p className="text-sm text-muted-foreground mb-5 max-w-xs mx-auto">
                                Create your first voice agent to get started with conversational AI.
                            </p>
                            <CreateWorkflowButton />
                        </div>
                    )}
                </div>

                {archivedWorkflows.length > 0 && (
                    <div className="mb-6">
                        <FolderSection kind="archived" workflows={archivedWorkflows} />
                    </div>
                )}
            </>
        );
    } catch (err) {
        logger.error(`Error fetching workflows: ${err}`);
        return (
            <div className="text-destructive text-sm">
                Failed to load agents. Please try again later.
            </div>
        );
    }
}

async function PageContent() {
    const workflowList = await WorkflowList();

    return (
        <div className="px-6 py-6 page-enter">
            {/* Page header */}
            <div className="flex items-end justify-between mb-6 pb-5 border-b border-border/50">
                <div>
                    <h1 className="text-2xl font-bold tracking-tight">Voice Agents</h1>
                    <p className="text-sm text-muted-foreground mt-0.5">Build and manage your AI conversational agents</p>
                </div>
                <div className="flex items-center gap-2">
                    <UploadWorkflowButton />
                    <CreateFolderButton />
                    <CreateWorkflowButton />
                </div>
            </div>

            {workflowList}
        </div>
    );
}

function WorkflowsLoading() {
    return (
        <div className="px-6 py-6">
            <div className="flex items-end justify-between mb-6 pb-5 border-b border-border/50">
                <div className="space-y-2">
                    <div className="h-7 w-40 bg-muted rounded-lg shimmer" />
                    <div className="h-4 w-64 bg-muted rounded shimmer" />
                </div>
                <div className="flex gap-2">
                    <div className="h-9 w-24 bg-muted rounded-lg shimmer" />
                    <div className="h-9 w-32 bg-muted rounded-lg shimmer" />
                </div>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {Array.from({ length: 6 }, (_, i) => (
                    <div key={i} className="neural-card rounded-xl h-32 shimmer" style={{ animationDelay: `${i * 0.05}s` }} />
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
