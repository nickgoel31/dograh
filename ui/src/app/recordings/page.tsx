"use client";

import { AudioLines, ExternalLink, Upload } from "lucide-react";
import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useAuth } from "@/lib/auth";

import RecordingsList from "./RecordingsList";
import { RecordingsUploadDialog } from "./RecordingsUploadDialog";

export default function RecordingsPage() {
    const { user, redirectToLogin, loading } = useAuth();
    const [isUploadOpen, setIsUploadOpen] = useState(false);
    const [refreshKey, setRefreshKey] = useState(0);

    useEffect(() => {
        if (!loading && !user) {
            redirectToLogin();
        }
    }, [loading, user, redirectToLogin]);

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
                            <AudioLines className="h-6 w-6" />
                        </div>
                        Recordings
                    </h1>
                    <p className="text-muted-foreground mt-2">
                        Manage audio recordings for your organization. Use{" "}
                        <code className="rounded bg-muted px-1 text-xs">@</code> in prompt fields to insert them,
                        or as transition messages in tool calls.{" "}
                        <a href="https://docs.dograh.com/voice-agent/pre-recorded-audio" target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-0.5 underline text-primary hover:text-primary/80 transition-colors">
                            Learn more <ExternalLink className="h-3 w-3" />
                        </a>
                    </p>
                </div>
            </div>

            <Card className="glass-card fade-in-up" style={{ animationDelay: '0.1s' }}>
                <CardHeader>
                    <div className="flex justify-between items-center">
                        <div>
                            <CardTitle>All Recordings</CardTitle>
                            <CardDescription>
                                Audio recordings shared across all agents in your organization
                            </CardDescription>
                        </div>
                        <Button onClick={() => setIsUploadOpen(true)} className="hover-glow bg-primary hover:bg-primary/90">
                            <Upload className="w-4 h-4 mr-2" />
                            Upload Recording
                        </Button>
                    </div>
                </CardHeader>
                <CardContent>
                    <RecordingsList refreshKey={refreshKey} />
                </CardContent>
            </Card>

            <RecordingsUploadDialog
                open={isUploadOpen}
                onOpenChange={setIsUploadOpen}
                onUploadComplete={() => setRefreshKey((k) => k + 1)}
            />
        </div>
    );
}
