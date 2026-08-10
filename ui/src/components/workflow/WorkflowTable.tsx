'use client';

import {
    Archive,
    Check,
    Folder as FolderIcon,
    FolderInput,
    Inbox,
    Pencil,
    RotateCcw,
    Search
} from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { toast } from 'sonner';

import {
    moveWorkflowToFolderApiV1WorkflowWorkflowIdFolderPut,
    updateWorkflowStatusApiV1WorkflowWorkflowIdStatusPut,
} from '@/client/sdk.gen';
import type { FolderResponse } from '@/client/types.gen';
import { Button } from '@/components/ui/button';
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuLabel,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

interface Workflow {
    id: number;
    name: string;
    status: string;
    created_at: string;
    updated_at?: string;
    total_runs?: number | null;
    folder_id?: number | null;
}

interface WorkflowTableProps {
    workflows: Workflow[];
    showArchived: boolean;
    folders?: FolderResponse[];
    currentFolderId?: number | null;
}

export function WorkflowTable({
    workflows,
    showArchived,
    folders,
    currentFolderId = null,
}: WorkflowTableProps) {
    const router = useRouter();
    const [isPending, startTransition] = useTransition();
    const [loadingWorkflowId, setLoadingWorkflowId] = useState<number | null>(null);
    const [movingWorkflowId, setMovingWorkflowId] = useState<number | null>(null);
    const [searchQuery, setSearchQuery] = useState('');

    const handleEdit = (id: number) => {
        router.push(`/workflow/${id}`);
    };

    const handleArchiveToggle = async (id: number, currentStatus: string) => {
        const newStatus = currentStatus === 'active' ? 'archived' : 'active';
        const action = currentStatus === 'active' ? 'Archive' : 'Restore';

        setLoadingWorkflowId(id);

        try {
            const response = await updateWorkflowStatusApiV1WorkflowWorkflowIdStatusPut({
                path: {
                    workflow_id: id,
                },
                body: {
                    status: newStatus,
                },
            });

            if (response.data) {
                toast.success(`Workflow ${action.toLowerCase()}d successfully`);
                startTransition(() => {
                    router.refresh();
                });
            }
        } catch (error) {
            console.error(`Error ${action.toLowerCase()}ing workflow:`, error);
            toast.error(`Failed to ${action.toLowerCase()} workflow`);
        } finally {
            setLoadingWorkflowId(null);
        }
    };

    const handleMove = async (id: number, folderId: number | null) => {
        setMovingWorkflowId(id);
        try {
            const response = await moveWorkflowToFolderApiV1WorkflowWorkflowIdFolderPut({
                path: { workflow_id: id },
                body: { folder_id: folderId },
            });
            if (response.error) {
                throw new Error('Failed to move agent');
            }
            toast.success(
                folderId === null ? 'Moved to Uncategorized' : 'Agent moved',
            );
            startTransition(() => {
                router.refresh();
            });
        } catch (error) {
            console.error('Error moving workflow:', error);
            toast.error('Failed to move agent');
        } finally {
            setMovingWorkflowId(null);
        }
    };

    const filteredWorkflows = workflows.filter(w => 
        w.name.toLowerCase().includes(searchQuery.toLowerCase())
    );

    return (
        <div className="space-y-4">
            <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 dark:text-gray-500" />
                <input
                    type="text"
                    placeholder="Search agents..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="w-full bg-white dark:bg-[#161715] border border-gray-200 dark:border-[#282b26] rounded-xl pl-9 pr-4 py-2 text-sm text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-gray-500 focus:outline-hidden focus:border-gray-300 dark:focus:border-gray-500 transition-colors"
                />
            </div>
            
            <div className="bg-white dark:bg-[#161715] border border-gray-100 dark:border-[#282b26] rounded-2xl overflow-hidden">
                {/* Table Header */}
                <div className="grid grid-cols-[1fr_auto] items-center px-4 py-3 border-b border-gray-100 dark:border-[#282b26] bg-gray-50/50 dark:bg-[#1c1e1a]/60 text-xs font-semibold text-gray-500 dark:text-gray-400">
                    <div>Agent</div>
                    <div className="w-[120px] text-right">Last edited</div>
                </div>
                
                {/* Table Body */}
                <div className="divide-y divide-gray-100 dark:divide-[#282b26]">
                    {filteredWorkflows.length === 0 ? (
                        <div className="p-8 text-center text-sm text-gray-500 dark:text-gray-400">
                            No agents found.
                        </div>
                    ) : (
                        filteredWorkflows.map((workflow) => (
                            <div 
                                key={workflow.id} 
                                onClick={() => handleEdit(workflow.id)}
                                className={`group grid grid-cols-[1fr_auto] items-center px-4 py-3.5 hover:bg-gray-50/70 dark:hover:bg-[#1f2119] transition-colors cursor-pointer ${showArchived ? 'opacity-65' : ''}`}
                            >
                                <div className="flex items-center gap-3 overflow-hidden pr-4">
                                    <div className="w-8 h-8 rounded-lg bg-[#bcf0da] dark:bg-[#082117] border border-[#a2e8c9] dark:border-[#113a29] p-1 flex items-center justify-center overflow-hidden flex-shrink-0">
                                        <svg viewBox="0 0 16 16" className="w-full h-full text-[#082117] dark:text-[#bcf0da]">
                                            <rect x="2" y="2" width="4" height="4" fill="currentColor" />
                                            <rect x="10" y="2" width="4" height="4" fill="currentColor" />
                                            <rect x="6" y="6" width="4" height="4" fill="currentColor" opacity="0.8" />
                                            <rect x="4" y="10" width="8" height="3" fill="currentColor" opacity="0.9" />
                                        </svg>
                                    </div>
                                    <div className="flex flex-col truncate">
                                        <span className="font-semibold text-sm text-gray-900 dark:text-white truncate">
                                            {workflow.name}
                                        </span>
                                        <span className="text-xs text-gray-500 dark:text-gray-400 truncate">
                                            owner@example.com
                                        </span>
                                    </div>
                                </div>
                                
                                <div className="flex items-center justify-end w-[120px]">
                                    {/* Default view: Date */}
                                    <div className="text-xs font-medium text-gray-500 dark:text-gray-400 group-hover:hidden text-right w-full">
                                        {new Date(workflow.updated_at || workflow.created_at).toLocaleDateString('en-US', {
                                            month: 'short',
                                            day: 'numeric',
                                            year: 'numeric'
                                        })}
                                    </div>
                                    
                                    {/* Hover view: Actions */}
                                    <div className="hidden group-hover:flex items-center justify-end gap-1.5 w-full" onClick={(e) => e.stopPropagation()}>
                                        <Button
                                            variant="ghost"
                                            size="icon"
                                            onClick={(e) => {
                                                e.stopPropagation();
                                                handleEdit(workflow.id);
                                            }}
                                            className="h-7 w-7 text-gray-400 hover:text-gray-900 dark:hover:text-white hover:bg-gray-200 dark:hover:bg-[#282b26] rounded-md transition-colors"
                                        >
                                            <Pencil size={13} />
                                        </Button>
                                        
                                        {folders && (
                                            <DropdownMenu>
                                                <DropdownMenuTrigger asChild onClick={(e) => e.stopPropagation()}>
                                                    <Button
                                                        variant="ghost"
                                                        size="icon"
                                                        disabled={movingWorkflowId === workflow.id || isPending}
                                                        className="h-7 w-7 text-gray-400 hover:text-gray-900 dark:hover:text-white hover:bg-gray-200 dark:hover:bg-[#282b26] rounded-md transition-colors"
                                                    >
                                                        {movingWorkflowId === workflow.id ? (
                                                            <div className="h-3 w-3 animate-spin rounded-full border-2 border-current border-t-transparent" />
                                                        ) : (
                                                            <FolderInput size={13} />
                                                        )}
                                                    </Button>
                                                </DropdownMenuTrigger>
                                                <DropdownMenuContent align="end" className="w-52 bg-white dark:bg-[#111113] border border-gray-200 dark:border-[#232328] text-gray-900 dark:text-zinc-300 rounded-xl p-1.5 shadow-xl">
                                                    <DropdownMenuLabel className="text-xs font-bold text-gray-500 dark:text-zinc-400 px-2 py-1.5">Move to folder</DropdownMenuLabel>
                                                    <DropdownMenuSeparator className="bg-gray-100 dark:bg-[#1d1d22]" />
                                                    <DropdownMenuItem
                                                        disabled={currentFolderId === null}
                                                        onClick={() => handleMove(workflow.id, null)}
                                                        className="rounded-lg text-xs px-2 py-1.5 focus:bg-gray-100 dark:focus:bg-[#1c1c1f] focus:text-gray-900 dark:focus:text-white cursor-pointer"
                                                    >
                                                        <Inbox size={13} className="mr-2 text-gray-400 dark:text-zinc-400" />
                                                        Uncategorized
                                                        {currentFolderId === null && (
                                                            <Check size={13} className="ml-auto text-[#7c3aed]" />
                                                        )}
                                                    </DropdownMenuItem>
                                                    {folders.map((folder) => (
                                                        <DropdownMenuItem
                                                            key={folder.id}
                                                            disabled={folder.id === currentFolderId}
                                                            onClick={() => handleMove(workflow.id, folder.id)}
                                                            className="rounded-lg text-xs px-2 py-1.5 focus:bg-gray-100 dark:focus:bg-[#1c1c1f] focus:text-gray-900 dark:focus:text-white cursor-pointer"
                                                        >
                                                            <FolderIcon size={13} className="mr-2 text-gray-400 dark:text-zinc-400" />
                                                            <span className="truncate">{folder.name}</span>
                                                            {folder.id === currentFolderId && (
                                                                <Check size={13} className="ml-auto shrink-0 text-[#7c3aed]" />
                                                            )}
                                                        </DropdownMenuItem>
                                                    ))}
                                                </DropdownMenuContent>
                                            </DropdownMenu>
                                        )}
                                        
                                        <Button
                                            variant="ghost"
                                            size="icon"
                                            onClick={(e) => {
                                                e.stopPropagation();
                                                handleArchiveToggle(workflow.id, workflow.status);
                                            }}
                                            disabled={loadingWorkflowId === workflow.id || isPending}
                                            className="h-7 w-7 text-gray-400 hover:text-gray-900 dark:hover:text-white hover:bg-gray-200 dark:hover:bg-[#282b26] rounded-md transition-colors"
                                        >
                                            {loadingWorkflowId === workflow.id ? (
                                                <div className="h-3 w-3 animate-spin rounded-full border-2 border-current border-t-transparent" />
                                            ) : (
                                                showArchived ? (
                                                    <RotateCcw size={13} />
                                                ) : (
                                                    <Archive size={13} />
                                                )
                                            )}
                                        </Button>
                                    </div>
                                </div>
                            </div>
                        ))
                    )}
                </div>
            </div>
        </div>
    );
}
