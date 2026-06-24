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
        <div className="bg-[#111113] border border-[#1d1d22] rounded-2xl overflow-hidden shadow-none">
            <Table>
                <TableHeader className="bg-[#18181b]/20 border-b border-[#1d1d22]">
                    <TableRow className="border-none hover:bg-transparent">
                        <TableHead className="font-bold text-zinc-400 text-xs uppercase tracking-wider h-11">ID</TableHead>
                        <TableHead className="font-bold text-zinc-400 text-xs uppercase tracking-wider h-11">Agent Name</TableHead>
                        <TableHead className="font-bold text-zinc-400 text-xs uppercase tracking-wider h-11">Created At</TableHead>
                        <TableHead className="font-bold text-zinc-400 text-xs uppercase tracking-wider h-11 text-center">Total Runs</TableHead>
                        <TableHead className="font-bold text-zinc-400 text-xs uppercase tracking-wider h-11 text-right">Actions</TableHead>
                    </TableRow>
                </TableHeader>
                <TableBody>
                    {workflows.map((workflow) => (
                        <TableRow
                            key={workflow.id}
                            className={`hover:bg-[#1a1a1f]/60 transition-colors border-b border-[#1d1d22]/50 ${showArchived ? 'opacity-65' : ''}`}
                        >
                            <TableCell className="text-zinc-600 font-mono text-xs py-3.5">
                                #{workflow.id}
                            </TableCell>
                            <TableCell className="font-bold text-white text-sm py-3.5">
                                {workflow.name}
                            </TableCell>
                            <TableCell className="text-zinc-400 text-xs py-3.5">
                                {new Date(workflow.created_at).toLocaleDateString('en-US', {
                                    year: 'numeric',
                                    month: 'short',
                                    day: 'numeric',
                                })}
                            </TableCell>
                            <TableCell className="text-center py-3.5">
                                <span className="inline-flex items-center justify-center min-w-[2rem] px-2.5 py-0.5 text-xs font-bold bg-[#08080a] border border-[#1d1d22] text-[#a78bfa] rounded-full">
                                    {workflow.total_runs || 0}
                                </span>
                            </TableCell>
                            <TableCell className="text-right py-3.5">
                                <div className="flex justify-end gap-2">
                                    <Button
                                        variant="outline"
                                        size="sm"
                                        onClick={() => handleEdit(workflow.id)}
                                        className="bg-[#1c1c1f] hover:bg-[#27272a] border border-[#232328] hover:border-zinc-700/60 text-zinc-300 text-xs px-3.5 py-1.5 rounded-xl transition-all cursor-pointer inline-flex items-center gap-1.5 h-8"
                                    >
                                        <Pencil size={13} className="text-zinc-400" />
                                        Edit
                                    </Button>
                                    {folders && (
                                        <DropdownMenu>
                                            <DropdownMenuTrigger asChild>
                                                <Button
                                                    variant="outline"
                                                    size="sm"
                                                    disabled={movingWorkflowId === workflow.id || isPending}
                                                    className="bg-[#1c1c1f] hover:bg-[#27272a] border border-[#232328] hover:border-zinc-700/60 text-zinc-300 text-xs px-3.5 py-1.5 rounded-xl transition-all cursor-pointer inline-flex items-center gap-1.5 h-8"
                                                >
                                                    {movingWorkflowId === workflow.id ? (
                                                        <div className="h-3 w-3 animate-spin rounded-full border-2 border-zinc-400 border-t-transparent" />
                                                    ) : (
                                                        <FolderInput size={13} className="text-zinc-400" />
                                                    )}
                                                    Move
                                                </Button>
                                            </DropdownMenuTrigger>
                                            <DropdownMenuContent align="end" className="w-52 bg-[#111113] border border-[#232328] text-zinc-300 rounded-xl p-1.5 shadow-2xl">
                                                <DropdownMenuLabel className="text-xs font-bold text-zinc-400 px-2 py-1.5">Move to folder</DropdownMenuLabel>
                                                <DropdownMenuSeparator className="bg-[#1d1d22]" />
                                                <DropdownMenuItem
                                                    disabled={currentFolderId === null}
                                                    onClick={() => handleMove(workflow.id, null)}
                                                    className="rounded-lg text-xs px-2 py-1.5 focus:bg-[#1c1c1f] focus:text-white cursor-pointer"
                                                >
                                                    <Inbox size={13} className="mr-2 text-zinc-400" />
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
                                                        className="rounded-lg text-xs px-2 py-1.5 focus:bg-[#1c1c1f] focus:text-white cursor-pointer"
                                                    >
                                                        <FolderIcon size={13} className="mr-2 text-zinc-400" />
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
                                        variant="outline"
                                        size="sm"
                                        onClick={() => handleArchiveToggle(workflow.id, workflow.status)}
                                        disabled={loadingWorkflowId === workflow.id || isPending}
                                        className="bg-[#1c1c1f] hover:bg-[#27272a] border border-[#232328] hover:border-zinc-700/60 text-zinc-300 text-xs px-3.5 py-1.5 rounded-xl transition-all cursor-pointer inline-flex items-center gap-1.5 h-8"
                                    >
                                        {loadingWorkflowId === workflow.id ? (
                                            <>
                                                <div className="h-3 w-3 animate-spin rounded-full border-2 border-zinc-400 border-t-transparent" />
                                                {showArchived ? 'Restoring...' : 'Archiving...'}
                                            </>
                                        ) : (
                                            <>
                                                {showArchived ? (
                                                    <>
                                                        <RotateCcw size={13} className="text-zinc-400" />
                                                        Restore
                                                    </>
                                                ) : (
                                                    <>
                                                        <Archive size={13} className="text-zinc-400" />
                                                        Archive
                                                    </>
                                                )}
                                            </>
                                        )}
                                    </Button>
                                </div>
                            </TableCell>
                        </TableRow>
                    ))}
                </TableBody>
            </Table>
        </div>
    );
}
