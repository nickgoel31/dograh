'use client';

import { CheckCircle2, FileText, RotateCw, Search, Trash2 } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';

import {
  deleteDocumentApiV1KnowledgeBaseDocumentsDocumentUuidDelete,
  listDocumentsApiV1KnowledgeBaseDocumentsGet,
} from '@/client/sdk.gen';
import type { DocumentResponseSchema } from '@/client/types.gen';
import { Skeleton } from '@/components/ui/skeleton';
import logger from '@/lib/logger';

interface DocumentListProps {
  refreshTrigger: number;
  onOpenUpload?: () => void;
}

export default function DocumentList({ refreshTrigger, onOpenUpload }: DocumentListProps) {
  const [documents, setDocuments] = useState<DocumentResponseSchema[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [error, setError] = useState<string | null>(null);

  const fetchDocuments = useCallback(async () => {
    try {
      setIsLoading(true);
      setError(null);

      const response = await listDocumentsApiV1KnowledgeBaseDocumentsGet({
        query: {
          limit: 100,
          offset: 0,
        },
      });

      if (response.error || !response.data) {
        throw new Error('Failed to fetch documents');
      }

      setDocuments(response.data.documents);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch documents');
      logger.error('Error fetching documents:', err);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchDocuments();
  }, [fetchDocuments, refreshTrigger]);

  useEffect(() => {
    const processingDocs = documents.filter(
      (doc) => doc.processing_status === 'processing' || doc.processing_status === 'pending'
    );

    if (processingDocs.length === 0) return;

    const pollInterval = setInterval(() => {
      logger.info(`Polling for ${processingDocs.length} processing documents...`);
      fetchDocuments();
    }, 5000);

    return () => clearInterval(pollInterval);
  }, [documents, fetchDocuments]);

  const handleDelete = async (documentUuid: string, filename: string) => {
    if (!confirm(`Are you sure you want to delete "${filename}"?`)) return;

    try {
      const response = await deleteDocumentApiV1KnowledgeBaseDocumentsDocumentUuidDelete({
        path: {
          document_uuid: documentUuid,
        },
      });

      if (response.error) {
        throw new Error('Failed to delete document');
      }

      toast.success(`Deleted "${filename}"`);
      fetchDocuments();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to delete document');
      logger.error('Error deleting document:', err);
    }
  };

  const formatFileSize = (bytes: number): string => {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`;
  };

  const formatDate = (dateString: string): string => {
    const date = new Date(dateString);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);

    if (diffMins < 1) return 'Just now';
    if (diffMins < 60) return `${diffMins}m ago`;
    if (diffHours < 24) return `${diffHours}h ago`;
    if (diffDays < 7) return `${diffDays}d ago`;
    return date.toLocaleDateString();
  };

  const filteredDocuments = documents.filter((doc) =>
    doc.filename.toLowerCase().includes(searchQuery.toLowerCase())
  );

  if (isLoading && documents.length === 0) {
    return (
      <div className="space-y-4">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-2">
          {[1, 2].map((i) => (
            <div
              key={i}
              className="p-5 border border-gray-200/80 dark:border-[#282b26] rounded-2xl flex flex-col justify-between gap-4 shimmer"
              style={{ backgroundColor: '#161715' }}
            >
              <div className="space-y-2">
                <Skeleton className="h-4 w-32" />
                <Skeleton className="h-3 w-48" />
              </div>
              <Skeleton className="h-6 w-20" />
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-4 bg-red-500/10 border border-red-500/20 rounded-xl text-red-600 dark:text-red-400 text-xs font-semibold">
        {error}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Search bar & Refresh Button */}
      <div className="flex items-center gap-2">
        <div className="relative flex-1">
          <Search className="w-4 h-4 text-gray-400 dark:text-gray-500 absolute left-3.5 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search documents..."
            className="w-full pl-10 pr-4 py-2 border border-gray-200 dark:border-[#282b26] rounded-xl text-xs text-gray-800 dark:text-white placeholder-gray-400 dark:placeholder-gray-500 font-normal focus:outline-hidden transition-all"
            style={{ backgroundColor: '#161715' }}
          />
        </div>

        <button
          onClick={fetchDocuments}
          disabled={isLoading}
          className="p-2.5 bg-gray-50 dark:bg-[#161715] hover:bg-gray-100 dark:hover:bg-[#232621] border border-gray-200 dark:border-[#282b26] text-gray-600 dark:text-gray-300 rounded-xl transition-colors cursor-pointer"
          title="Refresh List"
        >
          <RotateCw className={`w-4 h-4 ${isLoading ? 'animate-spin' : ''}`} />
        </button>
      </div>

      {/* Documents List or Empty State */}
      {filteredDocuments.length > 0 ? (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-2">
          {filteredDocuments.map((doc) => (
            <div
              key={doc.document_uuid}
              className="p-5 border border-gray-200/80 dark:border-[#282b26] rounded-2xl flex flex-col justify-between gap-4 transition-all group hover:border-gray-300 dark:hover:border-[#383c35]"
              style={{ backgroundColor: '#161715' }}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-center gap-3 min-w-0">
                  <div
                    className="p-2.5 rounded-xl border border-gray-200 dark:border-[#282b26] shadow-2xs text-rose-600 dark:text-rose-400 flex-shrink-0"
                    style={{ backgroundColor: '#1C1E1A' }}
                  >
                    <FileText className="w-5 h-5" />
                  </div>
                  <div className="flex flex-col min-w-0">
                    <h3 className="text-xs font-bold text-gray-900 dark:text-white group-hover:text-amber-700 dark:group-hover:text-amber-400 transition-colors truncate">
                      {doc.filename}
                    </h3>
                    <span className="text-[11px] text-gray-400 dark:text-gray-500">
                      {formatFileSize(doc.file_size_bytes)} • {formatDate(doc.created_at)}
                    </span>
                  </div>
                </div>

                <button
                  onClick={() => handleDelete(doc.document_uuid, doc.filename)}
                  className="p-1 text-gray-400 hover:text-red-600 transition-colors cursor-pointer"
                  title="Delete document"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>

              {doc.processing_error && (
                <p className="text-[11px] text-rose-500 leading-snug">
                  Error: {doc.processing_error}
                </p>
              )}

              <div className="pt-3 border-t border-gray-200/60 dark:border-[#282b26] flex items-center justify-between text-xs">
                <span className="px-2.5 py-0.5 bg-amber-100/80 dark:bg-amber-900/30 text-amber-800 dark:text-amber-300 border border-amber-500/20 rounded-full text-[11px] font-semibold">
                  {doc.retrieval_mode === 'full_document' ? 'Full Document' : 'Chunked Search'}
                </span>

                <span className="flex items-center gap-1 text-[11px] font-semibold text-emerald-700 dark:text-emerald-400">
                  <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" />
                  <span className="capitalize">{doc.processing_status === 'completed' ? 'Ready' : doc.processing_status}</span>
                </span>
              </div>
            </div>
          ))}
        </div>
      ) : (
        /* Empty State matching demo screenshot */
        <div className="py-16 flex flex-col items-center justify-center text-center space-y-4">
          <div className="w-16 h-16 rounded-full bg-gray-100 dark:bg-[#161715] flex items-center justify-center text-gray-400 dark:text-gray-500 border border-gray-200/50 dark:border-[#282b26]">
            <FileText className="w-8 h-8 stroke-[1.5]" />
          </div>

          <div className="space-y-1">
            <h4 className="text-sm font-semibold text-gray-700 dark:text-gray-300">
              {searchQuery ? 'No documents match your search' : 'No documents uploaded yet'}
            </h4>
          </div>

          {onOpenUpload && (
            <button
              onClick={onOpenUpload}
              className="px-5 py-2.5 bg-black dark:bg-[#bcf0da] hover:bg-gray-800 dark:hover:bg-[#a5e9cd] text-white dark:text-[#082117] text-xs font-bold rounded-full shadow-xs transition-all active:scale-[0.98] cursor-pointer"
            >
              Upload First Document
            </button>
          )}
        </div>
      )}
    </div>
  );
}
