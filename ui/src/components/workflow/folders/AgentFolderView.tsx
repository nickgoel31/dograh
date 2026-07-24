'use client';

import { Folder } from 'lucide-react';
import { useState } from 'react';

import type { FolderResponse, WorkflowListResponse } from '@/client/types.gen';
import { cn } from '@/lib/utils';

import { WorkflowTable } from '../WorkflowTable';

interface AgentFolderViewProps {
    /** Active (non-archived) agents only. */
    workflows: WorkflowListResponse[];
    folders: FolderResponse[];
}

export function AgentFolderView({ workflows, folders }: AgentFolderViewProps) {
    const [activeFolderId, setActiveFolderId] = useState<number | 'uncategorized'>('uncategorized');

    // Group agents by folder.
    const folderIds = new Set(folders.map((f) => f.id));
    const byFolder = new Map<number, WorkflowListResponse[]>();
    const uncategorized: WorkflowListResponse[] = [];

    for (const wf of workflows) {
        if (wf.folder_id != null && folderIds.has(wf.folder_id)) {
            const bucket = byFolder.get(wf.folder_id) ?? [];
            bucket.push(wf);
            byFolder.set(wf.folder_id, bucket);
        } else {
            uncategorized.push(wf);
        }
    }

    if (folders.length === 0) {
        return (
            <div className="glass-panel rounded-3xl overflow-hidden mt-8">
                <WorkflowTable workflows={workflows} showArchived={false} />
            </div>
        );
    }

    // Helper for icons
    const getFolderIcon = (index: number) => {
        const icons = ['folder', 'verified', 'campaign', 'query_stats'];
        const iconName = icons[index % icons.length];
        return <span className="material-symbols-outlined" style={{ fontVariationSettings: "'FILL' 1" }}>{iconName}</span>;
    };

    const activeWorkflows = activeFolderId === 'uncategorized' ? uncategorized : byFolder.get(activeFolderId) ?? [];
    const activeFolderName = activeFolderId === 'uncategorized' ? 'Uncategorized' : folders.find(f => f.id === activeFolderId)?.name ?? 'Folder';

    return (
        <div className="space-y-8">
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-6">
                {folders.map((folder, idx) => {
                    const count = (byFolder.get(folder.id) ?? []).length;
                    const isActive = activeFolderId === folder.id;
                    return (
                        <div 
                            key={folder.id} 
                            onClick={() => setActiveFolderId(folder.id)}
                            className={cn(
                                "glass-panel rounded-2xl p-6 flex flex-col gap-4 group cursor-pointer hover:border-primary/30 transition-all electric-glow relative overflow-hidden",
                                isActive && "border-primary/50 bg-white/5"
                            )}
                        >
                            <div className="absolute top-0 right-0 w-32 h-32 bg-primary/5 rounded-full -mr-16 -mt-16 blur-3xl group-hover:bg-primary/10 transition-colors"></div>
                            
                            <div className="flex justify-between items-start relative z-10">
                                <div className="p-2 bg-white/5 rounded-lg text-primary">
                                    {getFolderIcon(idx)}
                                </div>
                                <span className="text-xs font-bold text-on-surface-variant bg-white/5 px-2 py-1 rounded">
                                    {count} AGENT{count !== 1 ? 'S' : ''}
                                </span>
                            </div>
                            
                            <div className="relative z-10">
                                <h3 className="font-serif-heading text-[28px] text-on-surface group-hover:text-primary transition-colors leading-none m-0">
                                    {folder.name}
                                </h3>
                            </div>
                        </div>
                    );
                })}
                
                {/* Uncategorized Card */}
                <div 
                    onClick={() => setActiveFolderId('uncategorized')}
                    className={cn(
                        "glass-panel rounded-2xl p-6 flex flex-col gap-4 group cursor-pointer hover:border-primary/30 transition-all electric-glow relative overflow-hidden",
                        activeFolderId === 'uncategorized' && "border-primary/50 bg-white/5"
                    )}
                >
                    <div className="flex justify-between items-start relative z-10">
                        <div className="p-2 bg-white/5 rounded-lg text-primary">
                            <span className="material-symbols-outlined text-on-surface-variant group-hover:text-primary transition-colors" style={{ fontVariationSettings: "'FILL' 1" }}>folder</span>
                        </div>
                        <span className="text-xs font-bold text-on-surface-variant bg-white/5 px-2 py-1 rounded">
                            {uncategorized.length} AGENT{uncategorized.length !== 1 ? 'S' : ''}
                        </span>
                    </div>
                    
                    <div className="relative z-10">
                        <h3 className="font-serif-heading text-[28px] text-on-surface group-hover:text-primary transition-colors leading-none m-0">
                            Uncategorized
                        </h3>
                    </div>
                </div>
            </div>

            <div className="glass-panel rounded-3xl overflow-hidden mt-8">
                <div className="px-6 py-4 border-b border-white/5 flex justify-between items-center bg-white/5">
                    <div className="flex items-center gap-4">
                        <h3 className="font-serif-heading text-[24px] text-on-surface m-0">{activeFolderName}</h3>
                        <span className="text-xs bg-white/10 px-2 py-1 rounded-full text-on-surface-variant">
                            {activeWorkflows.length} TOTAL
                        </span>
                    </div>
                </div>
                <WorkflowTable 
                    workflows={activeWorkflows} 
                    showArchived={false} 
                    folders={folders}
                    currentFolderId={activeFolderId === 'uncategorized' ? null : activeFolderId}
                />
            </div>
        </div>
    );
}
