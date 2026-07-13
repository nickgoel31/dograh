"use client";

import { ExternalLink, Files, Upload } from "lucide-react";
import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { useAuth } from "@/lib/auth";

import DocumentList from "./DocumentList";
import DocumentUpload from "./DocumentUpload";

export default function FilesPage() {
    const { user, redirectToLogin, loading } = useAuth();
    const [refreshKey, setRefreshKey] = useState(0);
    const [isUploadOpen, setIsUploadOpen] = useState(false);

    // Redirect if not authenticated
    useEffect(() => {
        if (!loading && !user) {
            redirectToLogin();
        }
    }, [loading, user, redirectToLogin]);

    const handleUploadSuccess = () => {
        setRefreshKey(prev => prev + 1);
        setIsUploadOpen(false);
    };

    if (loading || !user) {
        return (
            <div className="min-h-screen bg-[#08080a] p-6 max-w-[1600px] mx-auto w-full page-enter">
                <div className="space-y-4">
                    <Skeleton className="h-12 w-64" />
                    <Skeleton className="h-64 w-full" />
                </div>
            </div>
        );
    }

    return (
        <div className="min-h-screen bg-[#08080a] p-6 max-w-[1600px] mx-auto w-full page-enter">
            {/* Header */}
            <div className="border-b border-[#1d1d22]/50 pb-6 mb-6">
                <h1 className="text-2xl font-bold tracking-tight text-white flex items-center gap-3">
                    Knowledge Base Files
                </h1>
                <p className="text-xs text-zinc-500 mt-1">
                    Upload and manage documents for your voice agents to reference.{" "}
                    <a href="https://docs.dograh.com/voice-agent/knowledge-base" target="_blank" rel="noopener noreferrer" className="text-blue-400 hover:underline inline-flex items-center gap-0.5">
                        Learn more <ExternalLink className="w-3.5 h-3.5 inline" />
                    </a>
                </p>
            </div>

            <Card className="bg-[#111113] border border-[#1d1d22] rounded-2xl p-6 shadow-none">
                <CardHeader className="p-0 pb-6 mb-6 border-b border-[#1d1d22]/50">
                    <div className="flex justify-between items-center">
                        <div>
                            <CardTitle className="text-lg font-bold text-white">Your Documents</CardTitle>
                            <CardDescription className="text-xs text-zinc-500">
                                Documents shared across all agents in your organization
                            </CardDescription>
                        </div>
                        <Button onClick={() => setIsUploadOpen(true)} className="bg-[#7c3aed] hover:bg-[#8b5cf6] text-white font-bold text-xs px-5 py-2.5 rounded-xl transition-all shadow-lg cursor-pointer">
                            <Upload className="w-4 h-4 mr-2 inline" />
                            Upload Document
                        </Button>
                    </div>
                </CardHeader>
                <CardContent className="p-0">
                    <DocumentList refreshTrigger={refreshKey} />
                </CardContent>
            </Card>

            <Dialog open={isUploadOpen} onOpenChange={setIsUploadOpen}>
                <DialogContent className="bg-[#111113] border border-[#2c2c35] rounded-2xl w-full max-w-lg p-6 shadow-2xl space-y-6 text-white">
                    <DialogHeader className="space-y-1">
                        <DialogTitle className="text-lg font-bold text-white">Upload Document</DialogTitle>
                        <DialogDescription className="text-xs text-zinc-500 leading-relaxed">
                            Upload a PDF or document file to add to your knowledge base
                        </DialogDescription>
                    </DialogHeader>
                    <DocumentUpload onUploadSuccess={handleUploadSuccess} />
                </DialogContent>
            </Dialog>
        </div>
    );
}
