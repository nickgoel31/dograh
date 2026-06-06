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
            <div className="container mx-auto px-4 py-8">
                <div className="space-y-4">
                    <Skeleton className="h-12 w-64" />
                    <Skeleton className="h-64 w-full" />
                </div>
            </div>
        );
    }

    return (
        <div className="container mx-auto px-4 py-8 fade-in-up">
            <div className="flex justify-between items-end mb-8 page-header">
                <div>
                    <h1 className="text-3xl font-extrabold tracking-tight mb-1 flex items-center gap-3">
                        <div className="icon-container">
                            <Files className="h-6 w-6" />
                        </div>
                        Knowledge Base Files
                    </h1>
                    <p className="text-muted-foreground mt-2">
                        Upload and manage documents for your voice agents to reference.{" "}
                        <a href="https://docs.dograh.com/voice-agent/knowledge-base" target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-0.5 underline text-primary hover:text-primary/80 transition-colors">
                            Learn more <ExternalLink className="h-3 w-3" />
                        </a>
                    </p>
                </div>
            </div>

            <Card className="glass-card fade-in-up" style={{ animationDelay: '0.1s' }}>
                <CardHeader>
                    <div className="flex justify-between items-center">
                        <div>
                            <CardTitle>Your Documents</CardTitle>
                            <CardDescription>
                                Documents shared across all agents in your organization
                            </CardDescription>
                        </div>
                        <Button onClick={() => setIsUploadOpen(true)} className="hover-glow bg-primary hover:bg-primary/90">
                            <Upload className="w-4 h-4 mr-2" />
                            Upload Document
                        </Button>
                    </div>
                </CardHeader>
                <CardContent>
                    <DocumentList refreshTrigger={refreshKey} />
                </CardContent>
            </Card>

            <Dialog open={isUploadOpen} onOpenChange={setIsUploadOpen}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>Upload Document</DialogTitle>
                        <DialogDescription>
                            Upload a PDF or document file to add to your knowledge base
                        </DialogDescription>
                    </DialogHeader>
                    <DocumentUpload onUploadSuccess={handleUploadSuccess} />
                </DialogContent>
            </Dialog>
        </div>
    );
}
