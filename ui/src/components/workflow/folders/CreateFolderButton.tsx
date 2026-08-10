'use client';

import { FolderPlus } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { toast } from 'sonner';

import { createFolderApiV1FolderPost } from '@/client/sdk.gen';
import { Button } from '@/components/ui/button';

import { FolderFormDialog } from './FolderFormDialog';

export function CreateFolderButton() {
    const router = useRouter();
    const [isOpen, setIsOpen] = useState(false);

    const handleCreate = async (name: string) => {
        const response = await createFolderApiV1FolderPost({ body: { name } });
        if (response.error) {
            // 409 = duplicate name; surface the server's message when present.
            const detail =
                (response.error as { detail?: string })?.detail ??
                'Failed to create folder';
            toast.error(detail);
            throw new Error(detail);
        }
        toast.success(`Folder "${name}" created`);
        router.refresh();
    };

    return (
        <>
            <Button 
                onClick={() => setIsOpen(true)}
                className="flex items-center gap-2 px-4 py-2 bg-neutral-900 hover:bg-neutral-800 text-white text-xs font-semibold rounded-xl border border-neutral-800 shadow-2xs transition-all active:scale-[0.98] h-9 cursor-pointer"
            >
                <FolderPlus className="w-4 h-4 stroke-[2]" />
                <span>New Folder</span>
            </Button>
            <FolderFormDialog
                open={isOpen}
                onOpenChange={setIsOpen}
                title="Create folder"
                submitLabel="Create"
                onSubmit={handleCreate}
            />
        </>
    );
}
