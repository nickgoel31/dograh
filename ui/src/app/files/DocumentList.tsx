'use client';

import { FileText, RefreshCw, Search, Trash2 } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';

import {
  deleteDocumentApiV1KnowledgeBaseDocumentsDocumentUuidDelete,
  listDocumentsApiV1KnowledgeBaseDocumentsGet,
} from '@/client/sdk.gen';
import type { DocumentResponseSchema } from '@/client/types.gen';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import logger from '@/lib/logger';

interface DocumentListProps {
  refreshTrigger: number;
}

export default function DocumentList({ refreshTrigger }: DocumentListProps) {
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

  // Fetch documents on mount and when refreshTrigger changes
  useEffect(() => {
    fetchDocuments();
  }, [fetchDocuments, refreshTrigger]);

  // Poll for documents that are processing
  useEffect(() => {
    const processingDocs = documents.filter(
      (doc) => doc.processing_status === 'processing' || doc.processing_status === 'pending'
    );

    if (processingDocs.length === 0) return;

    const pollInterval = setInterval(() => {
      logger.info(`Polling for ${processingDocs.length} processing documents...`);
      fetchDocuments();
    }, 5000); // Poll every 5 seconds

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

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'completed':
        return <Badge className="bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 text-[9px] font-bold px-1.5 py-0.5 rounded uppercase">Completed</Badge>;
      case 'processing':
        return (
          <Badge className="bg-blue-500/10 text-blue-400 border border-blue-500/20 text-[9px] font-bold px-1.5 py-0.5 rounded uppercase animate-pulse">
            Processing
          </Badge>
        );
      case 'pending':
        return <Badge className="bg-zinc-800 text-zinc-400 border border-zinc-700/50 text-[9px] font-bold px-1.5 py-0.5 rounded uppercase">Pending</Badge>;
      case 'failed':
        return <Badge className="bg-rose-500/10 text-rose-400 border border-rose-500/20 text-[9px] font-bold px-1.5 py-0.5 rounded uppercase">Failed</Badge>;
      default:
        return <Badge className="bg-zinc-800 text-zinc-400 border border-zinc-700/50 text-[9px] font-bold px-1.5 py-0.5 rounded uppercase">{status}</Badge>;
    }
  };

  const formatFileSize = (bytes: number): string => {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return `${parseFloat((bytes / Math.pow(k, i)).toFixed(2))} ${sizes[i]}`;
  };

  const formatDate = (dateString: string): string => {
    const date = new Date(dateString);
    return date.toLocaleDateString() + ' ' + date.toLocaleTimeString();
  };

  const filteredDocuments = documents.filter((doc) =>
    doc.filename.toLowerCase().includes(searchQuery.toLowerCase())
  );

  if (isLoading && documents.length === 0) {
    return (
      <div className="space-y-4">
        {[1, 2, 3].map((i) => (
          <div key={i} className="flex items-center justify-between p-4 border border-[#1d1d22] rounded-xl bg-[#111113] shimmer">
            <div className="space-y-2 flex-1">
              <Skeleton className="h-4 w-48 bg-zinc-800" />
              <Skeleton className="h-3 w-64 bg-zinc-800" />
            </div>
            <Skeleton className="h-8 w-24 bg-zinc-800" />
          </div>
        ))}
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-4 bg-destructive/10 border border-destructive/20 rounded-xl text-red-400 text-xs font-semibold">
        {error}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Search and Refresh */}
      <div className="flex items-center gap-4">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-zinc-500" />
          <Input
            placeholder="Search documents..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="bg-[#08080a] border border-[#1d1d22] rounded-xl py-2.5 pl-10 pr-4 text-xs text-white focus:outline-none focus:border-zinc-700 focus:ring-1 focus:ring-zinc-700 transition-all w-full"
          />
        </div>
        <Button
          onClick={fetchDocuments}
          disabled={isLoading}
          className="bg-[#121214] border border-[#232328] hover:bg-[#1a1a1f] p-2.5 rounded-xl text-xs text-zinc-300 transition-colors cursor-pointer"
        >
          <RefreshCw className={`h-4 w-4 ${isLoading ? 'animate-spin' : ''}`} />
        </Button>
      </div>

      {/* Document List */}
      {filteredDocuments.length === 0 ? (
        <div className="text-center py-12">
          <FileText className="w-12 h-12 text-zinc-600 mx-auto mb-4" />
          <p className="text-xs text-zinc-400">
            {searchQuery
              ? 'No documents match your search'
              : 'No documents uploaded yet'}
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {filteredDocuments.map((doc) => (
            <div
              key={doc.document_uuid}
              className="flex items-center justify-between p-4 bg-[#08080a] border border-[#1d1d22] rounded-xl hover:border-zinc-700 transition-all"
            >
              <div className="flex items-center gap-4 flex-1 min-w-0">
                <div className="w-10 h-10 rounded-xl bg-purple-500/10 flex items-center justify-center border border-purple-500/20 shrink-0">
                  <FileText className="w-5 h-5 text-purple-400" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1 flex-wrap">
                    <span className="font-semibold text-zinc-200 text-sm">{doc.filename}</span>
                    {getStatusBadge(doc.processing_status)}
                    {doc.retrieval_mode === 'full_document' ? (
                      <Badge className="bg-[#1c1c1f] text-zinc-400 border border-zinc-700/50 text-[9px] font-bold px-1.5 py-0.5 rounded uppercase">Full Document</Badge>
                    ) : (
                      <Badge className="bg-[#1c1c1f] text-zinc-400 border border-zinc-700/50 text-[9px] font-bold px-1.5 py-0.5 rounded uppercase">Chunked</Badge>
                    )}
                  </div>
                  <div className="flex items-center gap-4 text-xs text-zinc-500">
                    <span>{formatFileSize(doc.file_size_bytes)}</span>
                    {doc.processing_status === 'completed' && doc.retrieval_mode !== 'full_document' && (
                      <span>{doc.total_chunks} chunks</span>
                    )}
                    <span>{formatDate(doc.created_at)}</span>
                  </div>
                  {doc.processing_error && (
                    <p className="text-xs text-rose-400 mt-1">
                      Error: {doc.processing_error}
                    </p>
                  )}
                  {doc.docling_metadata &&
                   typeof doc.docling_metadata === 'object' &&
                   'duplicate_of' in doc.docling_metadata && (
                    <p className="text-xs text-zinc-500 mt-1">
                      Duplicate of another document
                    </p>
                  )}
                </div>
              </div>
              <Button
                onClick={() => handleDelete(doc.document_uuid, doc.filename)}
                className="p-1.5 rounded-lg border border-zinc-700/50 text-zinc-500 hover:text-rose-400 transition-colors bg-transparent cursor-pointer"
              >
                <Trash2 className="w-4 h-4" />
              </Button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
