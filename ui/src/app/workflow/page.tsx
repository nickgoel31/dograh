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

import { Bot } from 'lucide-react';

import WorkflowLayout from "./WorkflowLayout";

export const dynamic = 'force-dynamic';

// Server component for workflow list
async function WorkflowList() {
    const authProvider = await getServerAuthProvider();
    const accessToken = await getServerAccessToken();

    if (!accessToken) {
        // If no token, user needs to sign in
        const { redirect } = await import('next/navigation');
        if (authProvider === 'stack') {
            redirect('/');
        } else {
            // For OSS mode, this shouldn't happen as token is auto-generated
            return (
                <div className="text-red-500">
                    Authentication required. Please refresh the page.
                </div>
            );
        }
    }

    try {
        // Fetch both active and archived workflows in a single request
        const response = await getWorkflowsApiV1WorkflowFetchGet({
            headers: {
                'Authorization': `Bearer ${accessToken}`,
            },
            query: {
                status: 'active,archived'
            }
        });

        const allWorkflowData = response.data ? (Array.isArray(response.data) ? response.data : [response.data]) : [];

        // Separate active and archived workflows
        const activeWorkflows = allWorkflowData
            .filter((w: WorkflowListResponse) => w.status === 'active')
            .sort((a: WorkflowListResponse, b: WorkflowListResponse) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());

        const archivedWorkflows = allWorkflowData
            .filter((w: WorkflowListResponse) => w.status === 'archived')
            .sort((a: WorkflowListResponse, b: WorkflowListResponse) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());

        // Fetch folders for grouping active agents. A failure here shouldn't
        // break the page — fall back to an empty list (flat, ungrouped view).
        let folders: FolderResponse[] = [];
        try {
            const foldersResponse = await listFoldersApiV1FolderGet({
                headers: {
                    'Authorization': `Bearer ${accessToken}`,
                },
            });
            folders = foldersResponse.data ?? [];
        } catch (folderErr) {
            logger.error(`Error fetching folders: ${folderErr}`);
        }

        return (
            <>
                {/* Active Workflows Section */}
                <div className="mb-8">
                    <h2 className="text-xl font-semibold mb-4">Active Agents</h2>
                    {activeWorkflows.length > 0 || folders.length > 0 ? (
                        <AgentFolderView workflows={activeWorkflows} folders={folders} />
                    ) : (
                        <div className="glass-card rounded-xl p-12 text-center fade-in-up mt-6">
                            <div className="icon-container mx-auto h-12 w-12 rounded-full mb-4">
                                <Bot className="h-6 w-6" />
                            </div>
                            <h3 className="text-lg font-semibold mb-2">No active agents found</h3>
                            <p className="text-muted-foreground mb-6">Create your first agent to get started.</p>
                            <div className="inline-block">
                                <CreateWorkflowButton />
                            </div>
                        </div>
                    )}
                </div>

                {/* Archived Section — collapsible, same design as the folder/Uncategorized sections */}
                {archivedWorkflows.length > 0 && (
                    <div className="mb-8">
                        <FolderSection kind="archived" workflows={archivedWorkflows} />
                    </div>
                )}
            </>
        );
    } catch (err) {
        logger.error(`Error fetching workflows: ${err}`);
        return (
            <div className="text-red-500">
                Failed to load Workflows. Please Try Again Later.
            </div>
        );
    }
}

async function PageContent() {

    const workflowList = await WorkflowList();

    return (
        <div className="container mx-auto px-4 py-8 fade-in-up">
            {/* Your Workflows Section */}
            <div className="mb-6">
                <div className="flex justify-between items-end page-header">
                    <div>
                        <h1 className="text-3xl font-extrabold tracking-tight">Your Agents</h1>
                        <p className="text-muted-foreground mt-1">Manage and organize your AI voice agents</p>
                    </div>
                    <div className="flex gap-2 mb-1">
                        <UploadWorkflowButton />
                        <CreateFolderButton />
                        <CreateWorkflowButton />
                    </div>
                </div>
                {workflowList}
            </div>
        </div>
    );
}

function WorkflowsLoading() {
    return (
        <div className="container mx-auto px-4 py-8">
            {/* Get Started Section Loading */}
            <div className="mb-12">
                <div className="h-8 w-48 bg-muted rounded mb-6"></div>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                    {Array.from({ length: 3 }, (_, i) => (
                        <div key={i} className="bg-muted rounded-lg h-40"></div>
                    ))}
                </div>
            </div>

            {/* Your Workflows Section Loading */}
            <div className="mb-6">
                <div className="flex justify-between items-center mb-6">
                    <div className="h-8 w-48 bg-muted rounded"></div>
                    <div className="h-10 w-32 bg-muted rounded"></div>
                </div>
                <div className="bg-muted rounded-lg h-96"></div>
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
