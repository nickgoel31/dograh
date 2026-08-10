'use client';

import { Folder } from 'lucide-react';
import { useRouter } from 'next/navigation';

import type { FolderResponse, WorkflowListResponse } from '@/client/types.gen';

interface FolderCardProps {
    folder: FolderResponse;
    workflows: WorkflowListResponse[];
}

export function FolderCard({ folder, workflows }: FolderCardProps) {
    const router = useRouter();

    const lastEdited = folder.updated_at || folder.created_at;
    const timeAgo = lastEdited
        ? (() => {
              const diff = Date.now() - new Date(lastEdited).getTime();
              const mins = Math.floor(diff / 60000);
              const hrs = Math.floor(diff / 3600000);
              const days = Math.floor(diff / 86400000);
              if (mins < 60) return `${mins}m ago`;
              if (hrs < 24) return `${hrs}h ago`;
              return `${days}d ago`;
          })()
        : null;

    return (
        <div
            onClick={() => router.push(`/workflow?folder=${folder.id}`)}
            className="flex items-center justify-between p-3.5 bg-gray-50/70 dark:bg-[#1c1e1a] hover:bg-gray-100/70 dark:hover:bg-[#232621] border border-gray-200/60 dark:border-[#282b26] rounded-xl transition-all cursor-pointer group"
        >
            <div className="flex items-center gap-3 min-w-0">
                <div className="p-2 rounded-lg bg-amber-100/80 dark:bg-amber-500/15 text-amber-700 dark:text-amber-400 group-hover:bg-amber-200/80 dark:group-hover:bg-amber-500/25 transition-colors flex-shrink-0">
                    <Folder className="w-4 h-4 fill-amber-500/20" />
                </div>
                <div className="flex flex-col min-w-0">
                    <span className="text-xs font-semibold text-gray-900 dark:text-white truncate">
                        {folder.name}
                    </span>
                    <span className="text-[11px] text-gray-400 dark:text-gray-500">
                        {workflows.length} agent{workflows.length !== 1 ? 's' : ''}
                    </span>
                </div>
            </div>
            {timeAgo && (
                <span className="text-[11px] text-gray-400 dark:text-gray-500 flex-shrink-0 ml-3">
                    {timeAgo}
                </span>
            )}
        </div>
    );
}
