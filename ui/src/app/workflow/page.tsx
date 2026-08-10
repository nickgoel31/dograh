import { Suspense } from 'react';

import { getWorkflowsApiV1WorkflowFetchGet, listFoldersApiV1FolderGet } from '@/client/sdk.gen';
import type { FolderResponse, WorkflowListResponse } from '@/client/types.gen';
import { AgentPromptHero } from '@/components/workflow/AgentPromptHero';
import { CreateWorkflowButton } from '@/components/workflow/CreateWorkflowButton';
import { UploadWorkflowButton } from '@/components/workflow/UploadWorkflowButton';
import { CreateFolderButton } from '@/components/workflow/folders/CreateFolderButton';
import { FolderCard } from '@/components/workflow/folders/FolderCard';
import { FolderSection } from '@/components/workflow/folders/FolderSection';
import { WorkflowTable } from '@/components/workflow/WorkflowTable';
import { getServerAccessToken, getServerAuthProvider } from '@/lib/auth/server';
import logger from '@/lib/logger';

import WorkflowLayout from './WorkflowLayout';

export const dynamic = 'force-dynamic';

async function WorkflowDataSection() {
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

        const allWorkflowData = response.data
            ? (Array.isArray(response.data) ? response.data : [response.data])
            : [];

        const activeWorkflows = allWorkflowData
            .filter((w: WorkflowListResponse) => w.status === 'active')
            .sort((a: WorkflowListResponse, b: WorkflowListResponse) =>
                new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
            );

        const archivedWorkflows = allWorkflowData
            .filter((w: WorkflowListResponse) => w.status === 'archived')
            .sort((a: WorkflowListResponse, b: WorkflowListResponse) =>
                new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
            );

        let folders: FolderResponse[] = [];
        try {
            const foldersResponse = await listFoldersApiV1FolderGet({
                headers: { 'Authorization': `Bearer ${accessToken}` },
            });
            folders = foldersResponse.data ?? [];
        } catch (folderErr) {
            logger.error(`Error fetching folders: ${folderErr}`);
        }

        const folderIds = new Set(folders.map(f => f.id));

        return (
            <>
                {/* Folders section — only shown when folders exist */}
                {folders.length > 0 && (
                    <div className="space-y-3">
                        <div className="flex items-center justify-between px-1">
                            <h3 className="text-sm font-semibold text-gray-900 dark:text-white">Folders</h3>
                            <span className="text-xs text-gray-400 dark:text-gray-500">
                                {folders.length} folder{folders.length !== 1 ? 's' : ''}
                            </span>
                        </div>
                        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3">
                            {folders.map((folder) => {
                                const folderWorkflows = activeWorkflows.filter(
                                    (w: WorkflowListResponse) => w.folder_id === folder.id
                                );
                                return (
                                    <FolderCard
                                        key={folder.id}
                                        folder={folder}
                                        workflows={folderWorkflows}
                                    />
                                );
                            })}
                        </div>
                    </div>
                )}

                {/* Recents section */}
                {activeWorkflows.length > 0 && (
                    <div className="space-y-4">
                        <h3 className="text-sm font-semibold text-gray-900 dark:text-white px-1">Recents</h3>
                        <WorkflowTable
                            workflows={activeWorkflows}
                            showArchived={false}
                            folders={folders}
                        />
                    </div>
                )}

                {/* Archived */}
                {archivedWorkflows.length > 0 && (
                    <div className="space-y-4 pt-2 border-t border-gray-100 dark:border-[#282b26]">
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

function WorkflowsLoading() {
    return (
        <div className="space-y-8">
            <div className="space-y-3">
                <div className="h-4 w-16 rounded-lg bg-[#1c1e1a] shimmer" />
                <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3">
                    {[0, 1, 2].map((i) => (
                        <div key={i} className="h-20 rounded-xl bg-[#1c1e1a] shimmer" style={{ animationDelay: `${i * 0.05}s` }} />
                    ))}
                </div>
            </div>
            <div className="space-y-3">
                <div className="h-4 w-20 rounded-lg bg-[#1c1e1a] shimmer" />
                <div className="h-10 rounded-xl bg-[#1c1e1a] shimmer" />
                {[0, 1, 2].map((i) => (
                    <div key={i} className="h-14 rounded-xl bg-[#1c1e1a] shimmer" style={{ animationDelay: `${i * 0.05}s` }} />
                ))}
            </div>
        </div>
    );
}

export default function WorkflowPage() {
    return (
        <WorkflowLayout showFeaturesNav={true}>
            {/* Sticky sub-header: 'Agents' title + action buttons */}
            <header className="px-8 pt-6 pb-3 flex items-center justify-between sticky top-0 z-20 border-b border-[#282b26]" style={{backgroundColor: '#161715'}}>
                <h1 className="text-base font-semibold text-gray-900 dark:text-white tracking-tight">
                    Agents
                </h1>
                <div className="flex items-center gap-3">
                    <UploadWorkflowButton />
                    <CreateFolderButton />
                    <CreateWorkflowButton />
                </div>
            </header>

            {/* Centered content — matches demo's max-w-5xl layout */}
            <div className="max-w-5xl w-full mx-auto px-8 pt-2 pb-12 flex flex-col gap-10">
                {/* Hero: robot icon + heading + prompt + templates */}
                <AgentPromptHero />

                {/* Real data: Folders + Recents + Archived */}
                <Suspense fallback={<WorkflowsLoading />}>
                    <WorkflowDataSection />
                </Suspense>
            </div>
        </WorkflowLayout>
    );
}
