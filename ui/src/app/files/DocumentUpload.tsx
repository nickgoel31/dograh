'use client';

import { FileText, Info, Upload, X } from 'lucide-react';
import { useRef, useState } from 'react';
import { toast } from 'sonner';

import {
  getUploadUrlApiV1KnowledgeBaseUploadUrlPost,
  processDocumentApiV1KnowledgeBaseProcessDocumentPost,
} from '@/client/sdk.gen';
import type { DocumentUploadResponseSchema } from '@/client/types.gen';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Progress } from '@/components/ui/progress';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { useAppConfig } from '@/context/AppConfigContext';
import logger from '@/lib/logger';

interface DocumentUploadProps {
  onUploadSuccess: () => void;
}

const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5MB
const ACCEPTED_FILE_TYPES = ['.pdf', '.docx', '.doc', '.txt', '.json'];

export default function DocumentUpload({ onUploadSuccess }: DocumentUploadProps) {
  const { config } = useAppConfig();
  const isOSS = config?.deploymentMode === 'oss';
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [retrievalMode, setRetrievalMode] = useState<string>('full_document');
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
    setRetrievalMode('full_document');
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  const uploadFile = async () => {
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

  const handleButtonClick = () => {
    fileInputRef.current?.click();
  };

  // Step 2: File selected — show retrieval mode choice
  if (selectedFile && !uploading) {
    return (
      <div className="space-y-4">
        {ossNotice}
        {/* Selected file info */}
        <div className="flex items-center gap-3 p-4 bg-[#08080a] border border-[#1d1d22] rounded-xl">
          <FileText className="w-8 h-8 text-purple-400 flex-shrink-0" />
          <div className="flex-1 min-w-0">
            <p className="text-xs font-semibold text-zinc-200 truncate">{selectedFile.name}</p>
            <p className="text-[10px] text-zinc-500 mt-0.5">
              {(selectedFile.size / 1024).toFixed(1)} KB
            </p>
          </div>
          <Button variant="ghost" size="icon" onClick={clearSelectedFile} className="p-1 rounded-lg text-zinc-500 hover:text-zinc-300 hover:bg-[#1a1a1f] transition-all bg-transparent">
            <X className="w-4 h-4" />
          </Button>
        </div>

        {/* Retrieval mode selection */}
        <div className="space-y-3">
          <Label className="text-xs font-bold text-zinc-300 block mb-1.5">How should the agent use this document?</Label>
          <RadioGroup value={retrievalMode} onValueChange={setRetrievalMode} className="space-y-3">
            <label
              htmlFor="full_document"
              className={`flex items-start gap-3 p-4 bg-[#08080a] border rounded-xl cursor-pointer transition-colors ${
                retrievalMode === 'full_document' ? 'border-[#7c3aed]' : 'border-[#1d1d22] hover:border-zinc-700'
              }`}
            >
              <RadioGroupItem value="full_document" id="full_document" className="mt-0.5 border-[#232328] text-[#7c3aed]" />
              <div>
                <p className="font-bold text-xs text-zinc-200">Full Document</p>
                <p className="text-[10px] text-zinc-500 mt-1 leading-snug">
                  The entire document is provided to the agent on each retrieval.
                  Best for menus, price lists, FAQs, and other small reference documents.
                </p>
              </div>
            </label>
            <label
              htmlFor="chunked"
              className={`flex items-start gap-3 p-4 bg-[#08080a] border rounded-xl cursor-pointer transition-colors ${
                retrievalMode === 'chunked' ? 'border-[#7c3aed]' : 'border-[#1d1d22] hover:border-zinc-700'
              }`}
            >
              <RadioGroupItem value="chunked" id="chunked" className="mt-0.5 border-[#232328] text-[#7c3aed]" />
              <div>
                <p className="font-bold text-xs text-zinc-200">Chunked Search</p>
                <p className="text-[10px] text-zinc-500 mt-1 leading-snug">
                  The document is split into chunks and the most relevant ones are retrieved.
                  Better for large documents like manuals or policies.
                </p>
              </div>
            </label>
          </RadioGroup>
        </div>

        {/* Upload button */}
        <Button onClick={uploadFile} className="bg-[#7c3aed] hover:bg-[#8b5cf6] text-white font-bold text-xs px-5 py-2.5 rounded-xl transition-all shadow-lg cursor-pointer w-full">
          Upload & Process
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {ossNotice}
      <input
        ref={fileInputRef}
        type="file"
        accept={ACCEPTED_FILE_TYPES.join(',')}
        onChange={handleFileSelect}
        className="hidden"
        disabled={uploading}
      />

      {/* Drag and Drop Area */}
      <div
        className={`
          border-2 border-dashed rounded-xl p-8 text-center transition-colors
          ${dragActive ? 'border-[#7c3aed] bg-[#7c3aed]/5' : 'border-[#1d1d22]'}
          ${uploading ? 'opacity-50 pointer-events-none' : 'cursor-pointer hover:border-zinc-700 hover:bg-[#08080a]/50'}
        `}
        onDragEnter={handleDrag}
        onDragLeave={handleDrag}
        onDragOver={handleDrag}
        onDrop={handleDrop}
        onClick={handleButtonClick}
      >
        <Upload className="w-12 h-12 mx-auto mb-4 text-zinc-600" />
        <p className="text-sm font-semibold mb-1 text-zinc-200">
          {uploading ? 'Uploading...' : 'Drop your document here'}
        </p>
        <p className="text-xs text-zinc-500 mb-4">
          or click to browse
        </p>
        <p className="text-[10px] text-zinc-500">
          Supported formats: {ACCEPTED_FILE_TYPES.join(', ')} (Max 5MB)
        </p>
      </div>

      {/* Upload Progress */}
      {uploading && (
        <div className="space-y-2">
          <div className="flex justify-between text-sm">
            <span>Uploading...</span>
            <span>{uploadProgress}%</span>
          </div>
          <Progress value={uploadProgress} className="h-2 bg-[#08080a] border border-[#1d1d22] rounded-full [&>div]:bg-[#7c3aed]" />
        </div>
      )}

      {/* Manual Upload Button */}
      {!uploading && (
        <div className="flex justify-center">
          <Button
            type="button"
            onClick={handleButtonClick}
            className="bg-[#121214] border border-[#232328] hover:bg-[#1a1a1f] px-4 py-2 rounded-xl text-xs text-zinc-300 font-medium transition-colors cursor-pointer"
          >
            Choose File
          </Button>
        </div>
      )}
    </div>
  );
}
