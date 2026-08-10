'use client';

import { FileText, Info, Upload, X } from 'lucide-react';
import { useRef, useState } from 'react';
import { toast } from 'sonner';

import {
  getUploadUrlApiV1KnowledgeBaseUploadUrlPost,
  processDocumentApiV1KnowledgeBaseProcessDocumentPost,
} from '@/client/sdk.gen';
import type { DocumentUploadResponseSchema } from '@/client/types.gen';
import { Progress } from '@/components/ui/progress';
import { useAppConfig } from '@/context/AppConfigContext';
import logger from '@/lib/logger';

interface DocumentUploadProps {
  onUploadSuccess: () => void;
  onClose?: () => void;
}

const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5MB
const ACCEPTED_FILE_TYPES = ['.pdf', '.docx', '.doc', '.txt', '.json'];

export default function DocumentUpload({ onUploadSuccess, onClose }: DocumentUploadProps) {
  const { config } = useAppConfig();
  const isOSS = config?.deploymentMode === 'oss';
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [retrievalMode, setRetrievalMode] = useState<'full_document' | 'chunked'>('chunked');
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [dragActive, setDragActive] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const ossNotice = isOSS ? (
    <div className="flex gap-3 rounded-xl border border-amber-500/30 bg-amber-500/10 p-4 text-white">
      <Info className="h-4 w-4 flex-shrink-0 text-amber-400 mt-0.5" />
      <div className="text-xs text-zinc-300">
        <p className="font-bold text-amber-400">Processed by an external service</p>
        <p className="mt-1 leading-relaxed">
          Uploaded documents are sent to Dograh&apos;s managed Model Proxy Service for
          parsing and chunking. Dograh Model Proxy Service does not store or read your documents -
          the extracted text and embeddings are returned and stored locally in your
          self-hosted database.
        </p>
      </div>
    </div>
  ) : null;

  const validateFile = (file: File): boolean => {
    const fileExtension = '.' + file.name.split('.').pop()?.toLowerCase();
    if (!ACCEPTED_FILE_TYPES.includes(fileExtension)) {
      toast.error(`Please select a supported file type: ${ACCEPTED_FILE_TYPES.join(', ')}`);
      return false;
    }

    if (file.size > MAX_FILE_SIZE) {
      toast.error('File size must be less than 5MB');
      return false;
    }

    return true;
  };

  const handleFileSelected = (file: File) => {
    if (!validateFile(file)) {
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
      return;
    }
    setSelectedFile(file);
  };

  const clearSelectedFile = () => {
    setSelectedFile(null);
    setRetrievalMode('chunked');
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  const uploadFile = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedFile) return;

    setUploading(true);
    setUploadProgress(0);

    try {
      logger.info('Requesting presigned upload URL for:', selectedFile.name);
      const uploadUrlResponse = await getUploadUrlApiV1KnowledgeBaseUploadUrlPost({
        body: {
          filename: selectedFile.name,
          mime_type: selectedFile.type || 'application/octet-stream',
          custom_metadata: {
            original_filename: selectedFile.name,
            uploaded_at: new Date().toISOString(),
          },
        },
      });

      if (uploadUrlResponse.error || !uploadUrlResponse.data) {
        throw new Error('Failed to get upload URL');
      }

      const uploadData: DocumentUploadResponseSchema = uploadUrlResponse.data;
      setUploadProgress(25);

      const uploadResponse = await fetch(uploadData.upload_url, {
        method: 'PUT',
        body: selectedFile,
        headers: {
          'Content-Type': selectedFile.type || 'application/octet-stream',
        },
      });

      if (!uploadResponse.ok) {
        throw new Error('Failed to upload file to storage');
      }

      setUploadProgress(75);

      const processResponse = await processDocumentApiV1KnowledgeBaseProcessDocumentPost({
        body: {
          document_uuid: uploadData.document_uuid,
          s3_key: uploadData.s3_key,
          retrieval_mode: retrievalMode,
        },
      });

      if (processResponse.error) {
        throw new Error('Failed to trigger processing');
      }

      setUploadProgress(100);
      toast.success(`File uploaded: ${selectedFile.name}. Processing started.`);
      clearSelectedFile();
      onUploadSuccess();
    } catch (error) {
      logger.error('Error uploading document:', error);
      toast.error(error instanceof Error ? error.message : 'Failed to upload document');
    } finally {
      setUploading(false);
      setUploadProgress(0);
    }
  };

  const handleFileSelect = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) {
      handleFileSelected(file);
    }
  };

  const handleDrag = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === 'dragenter' || e.type === 'dragover') {
      setDragActive(true);
    } else if (e.type === 'dragleave') {
      setDragActive(false);
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);

    const file = e.dataTransfer.files?.[0];
    if (file) {
      handleFileSelected(file);
    }
  };

  return (
    <form onSubmit={uploadFile} className="space-y-5">
      {ossNotice}
      <input
        ref={fileInputRef}
        type="file"
        accept={ACCEPTED_FILE_TYPES.join(',')}
        onChange={handleFileSelect}
        className="hidden"
        disabled={uploading}
      />

      {/* Selected File Card or Drag & Drop Zone */}
      {selectedFile ? (
        <div
          className="flex items-center justify-between p-3.5 border border-gray-200 dark:border-[#282b26] rounded-xl"
          style={{ backgroundColor: '#161715' }}
        >
          <div className="flex items-center gap-3 min-w-0">
            <div className="p-2 rounded-lg bg-rose-100/80 dark:bg-rose-950/40 text-rose-700 dark:text-rose-400">
              <FileText className="w-5 h-5" />
            </div>
            <div className="flex flex-col min-w-0">
              <span className="text-xs font-bold text-gray-900 dark:text-white truncate">
                {selectedFile.name}
              </span>
              <span className="text-[11px] text-gray-400 dark:text-gray-500">
                {(selectedFile.size / 1024).toFixed(1)} KB
              </span>
            </div>
          </div>

          <button
            type="button"
            onClick={clearSelectedFile}
            className="p-1 text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      ) : (
        <label
          onDragEnter={handleDrag}
          onDragLeave={handleDrag}
          onDragOver={handleDrag}
          onDrop={handleDrop}
          className={`flex flex-col items-center justify-center p-6 border-2 border-dashed rounded-xl cursor-pointer transition-colors space-y-2 ${
            dragActive
              ? 'border-black dark:border-[#bcf0da] bg-gray-100/50 dark:bg-white/5'
              : 'border-gray-200 dark:border-[#282b26] hover:border-gray-400 dark:hover:border-gray-500'
          }`}
          style={{ backgroundColor: '#161715' }}
        >
          <Upload className="w-8 h-8 text-gray-400 dark:text-gray-500" />
          <span className="text-xs font-semibold text-gray-700 dark:text-gray-300">
            Click to browse PDF or Document file
          </span>
          <span className="text-[10px] text-gray-400 dark:text-gray-500">
            Supported formats: {ACCEPTED_FILE_TYPES.join(', ')} (Max 5MB)
          </span>
          <input
            type="file"
            accept={ACCEPTED_FILE_TYPES.join(',')}
            onChange={handleFileSelect}
            className="hidden"
            disabled={uploading}
          />
        </label>
      )}

      {/* Usage Radio Options matching demo */}
      <div className="space-y-3 pt-1">
        <label className="text-xs font-bold text-gray-900 dark:text-white block">
          How should the agent use this document?
        </label>

        {/* Option 1: Full Document */}
        <div
          onClick={() => setRetrievalMode('full_document')}
          className={`p-4 rounded-xl border transition-all cursor-pointer flex items-start gap-3 ${
            retrievalMode === 'full_document'
              ? 'border-black dark:border-[#bcf0da] ring-1 ring-black dark:ring-[#bcf0da]'
              : 'border-gray-200 dark:border-[#282b26] hover:border-gray-300 dark:hover:border-[#383c35]'
          }`}
          style={{ backgroundColor: '#161715' }}
        >
          <input
            type="radio"
            name="retrievalMode"
            checked={retrievalMode === 'full_document'}
            onChange={() => setRetrievalMode('full_document')}
            className="mt-0.5 accent-black dark:accent-[#bcf0da] cursor-pointer"
          />
          <div className="space-y-1">
            <h4 className="text-xs font-bold text-gray-900 dark:text-white">
              Full Document
            </h4>
            <p className="text-[11.5px] text-gray-500 dark:text-gray-400 leading-relaxed">
              The entire document is provided to the agent on each retrieval. Best for menus, price lists, FAQs, and other small reference documents.
            </p>
          </div>
        </div>

        {/* Option 2: Chunked Search */}
        <div
          onClick={() => setRetrievalMode('chunked')}
          className={`p-4 rounded-xl border transition-all cursor-pointer flex items-start gap-3 ${
            retrievalMode === 'chunked'
              ? 'border-black dark:border-[#bcf0da] ring-1 ring-black dark:ring-[#bcf0da]'
              : 'border-gray-200 dark:border-[#282b26] hover:border-gray-300 dark:hover:border-[#383c35]'
          }`}
          style={{ backgroundColor: '#161715' }}
        >
          <input
            type="radio"
            name="retrievalMode"
            checked={retrievalMode === 'chunked'}
            onChange={() => setRetrievalMode('chunked')}
            className="mt-0.5 accent-black dark:accent-[#bcf0da] cursor-pointer"
          />
          <div className="space-y-1">
            <h4 className="text-xs font-bold text-gray-900 dark:text-white">
              Chunked Search
            </h4>
            <p className="text-[11.5px] text-gray-500 dark:text-gray-400 leading-relaxed">
              The document is split into chunks and the most relevant ones are retrieved. Better for large documents like manuals or policies.
            </p>
          </div>
        </div>
      </div>

      {/* Upload Progress */}
      {uploading && (
        <div className="space-y-2">
          <div className="flex justify-between text-xs font-semibold text-gray-700 dark:text-gray-300">
            <span>Uploading & Processing...</span>
            <span>{uploadProgress}%</span>
          </div>
          <Progress value={uploadProgress} className="h-2 bg-gray-200 dark:bg-[#161715] rounded-full [&>div]:bg-black dark:[&>div]:bg-[#bcf0da]" />
        </div>
      )}

      {/* Submit Button */}
      <div className="pt-2 flex items-center justify-end gap-3">
        {onClose && (
          <button
            type="button"
            onClick={onClose}
            className="px-5 py-2.5 bg-gray-100 dark:bg-[#161715] hover:bg-gray-200 dark:hover:bg-[#232621] text-gray-800 dark:text-gray-200 text-xs font-semibold rounded-full transition-all cursor-pointer"
          >
            Cancel
          </button>
        )}
        <button
          type="submit"
          disabled={!selectedFile || uploading}
          className="flex-1 py-3 bg-black dark:bg-[#bcf0da] hover:bg-gray-800 dark:hover:bg-[#a5e9cd] disabled:opacity-50 text-white dark:text-[#082117] text-xs font-bold rounded-full shadow-xs transition-all active:scale-[0.99] text-center cursor-pointer"
        >
          {uploading ? 'Processing...' : 'Upload & Process'}
        </button>
      </div>
    </form>
  );
}
