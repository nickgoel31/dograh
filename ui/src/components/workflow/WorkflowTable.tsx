'use client';

import {
    Archive,
    Check,
    Folder as FolderIcon,
    FolderInput,
    Inbox,
    Pencil,
    RotateCcw,
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
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from "@/components/ui/table";
interface Workflow {
    id: number;
    name: string;
    status: string;
    created_at: string;
    total_runs?: number | null;
    folder_id?: number | null;
}

interface WorkflowTableProps {
    workflows: Workflow[];
    showArchived: boolean;
    /**
     * When provided, each row gets a "Move to folder" action listing these
     * folders. Omit it (e.g. for the archived list) to hide the control.
     */
    folders?: FolderResponse[];
    /** The folder this table is rendered under; null means "Uncategorized". */
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

    return (
        <div className="w-full text-left border-collapse">
            <Table className="w-full text-left border-collapse">
                <TableHeader>
                    <TableRow className="bg-surface-container-lowest text-on-surface-variant text-[14px] border-b border-white/5 uppercase tracking-widest hover:bg-transparent">
                        <TableHead className="px-6 py-4 font-bold text-on-surface-variant h-auto">Agent Name</TableHead>
                        <TableHead className="px-6 py-4 font-bold text-on-surface-variant h-auto">ID</TableHead>
                        <TableHead className="px-6 py-4 font-bold text-on-surface-variant h-auto">Created At</TableHead>
                        <TableHead className="px-6 py-4 font-bold text-on-surface-variant h-auto">Status</TableHead>
                        <TableHead className="px-6 py-4 font-bold text-on-surface-variant h-auto">Total Runs</TableHead>
                        <TableHead className="px-6 py-4 font-bold text-on-surface-variant h-auto text-right">Actions</TableHead>
                    </TableRow>
                </TableHeader>
                <TableBody className="divide-y divide-white/5">
                    {workflows.map((workflow) => {
                        const isActiveStatus = workflow.status === 'active';
                        return (
                            <TableRow
                                key={workflow.id}
                                className={`hover:bg-white/[0.02] transition-colors group cursor-pointer border-none ${showArchived ? 'opacity-65' : ''}`}
                                onClick={() => handleEdit(workflow.id)}
                            >
                                <TableCell className="px-6 py-4">
                                    <div className="flex items-center gap-3">
                                        <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-primary/20 to-primary/5 flex items-center justify-center border border-primary/20">
                                            <span className="material-symbols-outlined text-primary">smart_toy</span>
                                        </div>
                                        <div>
                                            <div className="font-serif-heading text-[18px] text-on-surface group-hover:text-primary transition-colors">{workflow.name}</div>
                                            <div className="text-[10px] text-on-surface-variant uppercase tracking-wider">Language: EN-US</div>
                                        </div>
                                    </div>
                                </TableCell>
                                <TableCell className="px-6 py-4 font-mono text-xs text-on-surface-variant">
                                    agt_0{workflow.id}x...
                                </TableCell>
                                <TableCell className="px-6 py-4 text-sm text-on-surface-variant">
                                    {new Date(workflow.created_at).toLocaleDateString('en-US', {
                                        year: 'numeric',
                                        month: 'short',
                                        day: 'numeric',
                                    })}
                                </TableCell>
                                <TableCell className="px-6 py-4">
                                    {isActiveStatus ? (
                                        <div className="flex items-center gap-2">
                                            <span className="w-2 h-2 rounded-full bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.5)]"></span>
                                            <span className="text-xs font-bold text-on-surface">Active</span>
                                        </div>
                                    ) : (
                                        <div className="flex items-center gap-2">
                                            <span className="w-2 h-2 rounded-full bg-on-surface-variant"></span>
                                            <span className="text-xs font-bold text-on-surface-variant">Idle</span>
                                        </div>
                                    )}
                                </TableCell>
                                <TableCell className="px-6 py-4">
                                    <div className="flex flex-col">
                                        <span className={cn("text-sm font-bold", isActiveStatus ? "text-on-surface" : "text-on-surface-variant")}>
                                            {(workflow.total_runs || 0).toLocaleString()}
                                        </span>
                                        <div className="w-24 h-1 bg-white/5 rounded-full mt-1 overflow-hidden">
                                            <div className={cn("h-full", isActiveStatus ? "bg-primary" : "bg-on-surface-variant")} style={{ width: `${Math.min(100, Math.max(10, (workflow.total_runs || 0) / 100))}%` }}></div>
                                        </div>
                                    </div>
                                </TableCell>
                                <TableCell className="px-6 py-4 text-right">
                                    <div className="flex justify-end gap-2" onClick={(e) => e.stopPropagation()}>
                                        <button 
                                            className="p-2 text-on-surface-variant hover:text-primary transition-colors cursor-pointer"
                                            onClick={(e) => {
                                                e.stopPropagation();
                                                handleEdit(workflow.id);
                                            }}
                                        >
                                            <span className="material-symbols-outlined text-[20px]">analytics</span>
                                        </button>

                                        <DropdownMenu>
                                            <DropdownMenuTrigger asChild>
                                                <button className="p-2 text-on-surface-variant hover:text-primary transition-colors cursor-pointer">
                                                    <span className="material-symbols-outlined text-[20px]">settings</span>
                                                </button>
                                            </DropdownMenuTrigger>
                                            <DropdownMenuContent align="end" className="w-52 bg-surface-container-lowest border border-white/10 text-on-surface rounded-xl p-1.5 shadow-2xl">
                                                <DropdownMenuLabel className="text-xs font-semibold text-on-surface-variant px-2 py-1.5">Agent Actions</DropdownMenuLabel>
                                                <DropdownMenuSeparator className="bg-white/5" />
                                                
                                                {/* Archive/Restore Action */}
                                                <DropdownMenuItem
                                                    onClick={() => handleArchiveToggle(workflow.id, workflow.status)}
                                                    disabled={loadingWorkflowId === workflow.id || isPending}
                                                    className="rounded-lg text-xs px-2 py-1.5 focus:bg-white/5 focus:text-white cursor-pointer"
                                                >
                                                    {loadingWorkflowId === workflow.id ? (
                                                        <div className="h-3 w-3 animate-spin rounded-full border-2 border-slate-400 border-t-transparent mr-2" />
                                                    ) : (
                                                        <span className="material-symbols-outlined text-[16px] mr-2 text-on-surface-variant">
                                                            {showArchived ? 'settings_backup_restore' : 'archive'}
                                                        </span>
                                                    )}
                                                    {showArchived ? 'Restore Agent' : 'Archive Agent'}
                                                </DropdownMenuItem>

                                                {/* Move Actions */}
                                                {folders && (
                                                    <>
                                                        <DropdownMenuSeparator className="bg-white/5" />
                                                        <DropdownMenuLabel className="text-xs font-semibold text-on-surface-variant px-2 py-1.5">Move to folder</DropdownMenuLabel>
                                                        <DropdownMenuItem
                                                            disabled={currentFolderId === null}
                                                            onClick={() => handleMove(workflow.id, null)}
                                                            className="rounded-lg text-xs px-2 py-1.5 focus:bg-white/5 focus:text-white cursor-pointer"
                                                        >
                                                            <span className="material-symbols-outlined text-[16px] mr-2 text-on-surface-variant">inbox</span>
                                                            Uncategorized
                                                            {currentFolderId === null && (
                                                                <span className="material-symbols-outlined text-[16px] ml-auto text-primary">check</span>
                                                            )}
                                                        </DropdownMenuItem>
                                                        {folders.map((folder) => (
                                                            <DropdownMenuItem
                                                                key={folder.id}
                                                                disabled={folder.id === currentFolderId}
                                                                onClick={() => handleMove(workflow.id, folder.id)}
                                                                className="rounded-lg text-xs px-2 py-1.5 focus:bg-white/5 focus:text-white cursor-pointer"
                                                            >
                                                                <span className="material-symbols-outlined text-[16px] mr-2 text-on-surface-variant">folder</span>
                                                                <span className="truncate">{folder.name}</span>
                                                                {folder.id === currentFolderId && (
                                                                    <span className="material-symbols-outlined text-[16px] ml-auto shrink-0 text-primary">check</span>
                                                                )}
                                                            </DropdownMenuItem>
                                                        ))}
                                                    </>
                                                )}
                                            </DropdownMenuContent>
                                        </DropdownMenu>
                                    </div>
                                </TableCell>
                            </TableRow>
                        );
                    })}
                </TableBody>
            </Table>
        </div>
    );
}
