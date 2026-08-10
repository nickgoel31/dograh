'use client';

import {
    Archive,
    ChevronRight,
    Folder as FolderIcon,
    FolderOpen,
    Inbox,
    MoreVertical,
    Pencil,
    Trash2,
} from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { toast } from 'sonner';

import {
    deleteFolderApiV1FolderFolderIdDelete,
    renameFolderApiV1FolderFolderIdPut,
} from '@/client/sdk.gen';
import type { FolderResponse, WorkflowListResponse } from '@/client/types.gen';
import {
    AlertDialog,
    AlertDialogAction,
    AlertDialogCancel,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
    Collapsible,
    CollapsibleContent,
    CollapsibleTrigger,
} from '@/components/ui/collapsible';
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import logger from '@/lib/logger';
import { cn } from '@/lib/utils';

import { WorkflowTable } from '../WorkflowTable';
import { FolderFormDialog } from './FolderFormDialog';

/**
 * - `folder`        — a real, renameable/deletable folder of active agents
 * - `uncategorized` — active agents with no folder
 * - `archived`      — archived agents (restore-only; not a move target)
 */
type SectionKind = 'folder' | 'uncategorized' | 'archived';

interface FolderSectionProps {
    kind: SectionKind;
    /** Required when kind === 'folder'; ignored otherwise. */
    folder?: FolderResponse | null;
    workflows: WorkflowListResponse[];
    /** All folders, passed through so each row's "Move to folder" menu has targets. */
    allFolders?: FolderResponse[];
    /** Defaults to open only for Uncategorized; folders and Archived start collapsed. */
    defaultOpen?: boolean;
}

export function FolderSection({
    kind,
    folder = null,
    workflows,
    allFolders = [],
    defaultOpen,
}: FolderSectionProps) {
    const router = useRouter();
    const [open, setOpen] = useState(defaultOpen ?? kind === 'uncategorized');
    const [isRenaming, setIsRenaming] = useState(false);
    const [confirmDelete, setConfirmDelete] = useState(false);
    const [isDeleting, setIsDeleting] = useState(false);

    const isFolder = kind === 'folder';
    const isArchived = kind === 'archived';
    const count = workflows.length;
    const title = isFolder ? (folder?.name ?? '') : isArchived ? 'Archived' : 'Uncategorized';

    const handleRename = async (name: string) => {
        if (!folder) return;
        const response = await renameFolderApiV1FolderFolderIdPut({
            path: { folder_id: folder.id },
            body: { name },
        });
        if (response.error) {
            const detail =
                (response.error as { detail?: string })?.detail ??
                'Failed to rename folder';
            toast.error(detail);
            throw new Error(detail);
        }
        toast.success('Folder renamed');
        router.refresh();
    };

    const handleDelete = async () => {
        if (!folder) return;
        setIsDeleting(true);
        try {
            const response = await deleteFolderApiV1FolderFolderIdDelete({
                path: { folder_id: folder.id },
            });
            if (response.error) {
                throw new Error('Failed to delete folder');
            }
            toast.success(`Folder "${folder.name}" deleted`);
            setConfirmDelete(false);
            router.refresh();
        } catch (err) {
            logger.error(`Error deleting folder: ${err}`);
            toast.error('Failed to delete folder');
        } finally {
            setIsDeleting(false);
        }
    };

    return (
        <div className="mb-4">
            <Collapsible open={open} onOpenChange={setOpen}>
                <div className="flex items-center justify-between p-3.5 bg-gray-50/70 dark:bg-[#1c1e1a] hover:bg-gray-100/70 dark:hover:bg-[#232621] border border-gray-200/60 dark:border-[#282b26] rounded-xl transition-all mb-2 cursor-pointer group">
                    <CollapsibleTrigger asChild>
                        <button
                            className="flex-1 flex items-center justify-between text-left cursor-pointer"
                            aria-label={`Toggle ${title}`}
                        >
                            <div className="flex items-center gap-3 min-w-0">
                                <div className="p-2 rounded-lg bg-amber-100/80 dark:bg-amber-500/20 text-amber-700 dark:text-amber-400 group-hover:bg-amber-200/80 transition-colors">
                                    {isFolder ? (
                                        <FolderIcon className="w-4 h-4 fill-amber-500/20" />
                                    ) : isArchived ? (
                                        <Archive className="w-4 h-4 text-purple-400" />
                                    ) : (
                                        <Inbox className="w-4 h-4 text-purple-400" />
                                    )}
                                </div>
                                <div className="flex flex-col min-w-0">
                                    <span className="text-xs font-semibold text-gray-900 dark:text-white truncate">
                                        {title}
                                    </span>
                                    <span className="text-[11px] text-gray-400 dark:text-gray-500">
                                        {count} agent{count === 1 ? '' : 's'}
                                    </span>
                                </div>
                            </div>
                            <div className="flex items-center gap-2">
                                <ChevronRight
                                    size={14}
                                    className={cn(
                                        'shrink-0 text-gray-400 dark:text-gray-500 transition-transform duration-200 group-hover:text-gray-600 dark:group-hover:text-gray-300',
                                        open && 'rotate-90',
                                    )}
                                />
                            </div>
                        </button>
                    </CollapsibleTrigger>

                    {isFolder && (
                        <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                                <Button
                                    variant="ghost"
                                    size="icon"
                                    className="h-8 w-8 text-zinc-400 hover:text-white rounded-lg hover:bg-[#1c1c1f] cursor-pointer"
                                    aria-label="Folder actions"
                                >
                                    <MoreVertical size={15} />
                                </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end" className="bg-[#111113] border border-[#232328] text-zinc-300 rounded-xl p-1.5 shadow-2xl">
                                <DropdownMenuItem onClick={() => setIsRenaming(true)} className="rounded-lg text-xs px-2.5 py-1.5 focus:bg-[#1c1c1f] focus:text-white cursor-pointer">
                                    <Pencil size={13} className="mr-2 text-zinc-400" />
                                    Rename
                                </DropdownMenuItem>
                                <DropdownMenuItem
                                    onClick={() => setConfirmDelete(true)}
                                    className="rounded-lg text-xs px-2.5 py-1.5 text-rose-400 focus:text-rose-400 focus:bg-rose-500/10 cursor-pointer"
                                >
                                    <Trash2 size={13} className="mr-2 text-rose-400" />
                                    Delete
                                </DropdownMenuItem>
                            </DropdownMenuContent>
                        </DropdownMenu>
                    )}
                </div>

                <CollapsibleContent className="data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:slide-in-from-top-1">
                    <div className="pl-3.5 pt-1 pb-4">
                        {count > 0 ? (
                            <WorkflowTable
                                workflows={workflows}
                                showArchived={isArchived}
                                // Archived agents are restore-only — not a move target.
                                folders={isArchived ? undefined : allFolders}
                                currentFolderId={folder?.id ?? null}
                            />
                        ) : (
                            <div className="rounded-2xl border border-dashed border-[#1d1d22] bg-[#111113]/20 p-8 text-center text-xs text-zinc-500">
                                {isArchived
                                    ? 'No archived agents.'
                                    : isFolder
                                      ? 'This folder is empty. Use “Move to folder” on an agent to add it here.'
                                      : 'No uncategorized agents.'}
                            </div>
                        )}
                    </div>
                </CollapsibleContent>
            </Collapsible>

            {isFolder && folder && (
                <>
                    <FolderFormDialog
                        open={isRenaming}
                        onOpenChange={setIsRenaming}
                        title="Rename folder"
                        initialName={folder.name}
                        submitLabel="Rename"
                        onSubmit={handleRename}
                    />
                    <AlertDialog open={confirmDelete} onOpenChange={setConfirmDelete}>
                        <AlertDialogContent>
                            <AlertDialogHeader>
                                <AlertDialogTitle>Delete “{folder.name}”?</AlertDialogTitle>
                                <AlertDialogDescription>
                                    The {count} agent{count === 1 ? '' : 's'} in this folder
                                    won’t be deleted — they’ll move to Uncategorized.
                                </AlertDialogDescription>
                            </AlertDialogHeader>
                            <AlertDialogFooter>
                                <AlertDialogCancel disabled={isDeleting}>
                                    Cancel
                                </AlertDialogCancel>
                                <AlertDialogAction
                                    onClick={(e) => {
                                        e.preventDefault();
                                        handleDelete();
                                    }}
                                    disabled={isDeleting}
                                    className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                                >
                                    {isDeleting ? 'Deleting...' : 'Delete folder'}
                                </AlertDialogAction>
                            </AlertDialogFooter>
                        </AlertDialogContent>
                    </AlertDialog>
                </>
            )}
        </div>
    );
}
