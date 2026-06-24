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
                    Recordings
                </h1>
                <p className="text-xs text-zinc-500 mt-1">
                    Manage audio recordings for your organization. Use{" "}
                    <code className="rounded bg-[#1c1c1f] border border-[#232328] px-1 py-0.5 text-xs text-zinc-300">@</code> in prompt fields to insert them,
                    or as transition messages in tool calls.{" "}
                    <a href="https://docs.dograh.com/voice-agent/pre-recorded-audio" target="_blank" rel="noopener noreferrer" className="text-blue-400 hover:underline inline-flex items-center gap-0.5">
                        Learn more <ExternalLink className="w-3.5 h-3.5 inline" />
                    </a>
                </p>
            </div>

            <Card className="bg-[#111113] border border-[#1d1d22] rounded-2xl p-6 shadow-none">
                <CardHeader className="p-0 pb-6 mb-6 border-b border-[#1d1d22]/50">
                    <div className="flex justify-between items-center">
                        <div>
                            <CardTitle className="text-lg font-bold text-white">All Recordings</CardTitle>
                            <CardDescription className="text-xs text-zinc-500">
                                Audio recordings shared across all agents in your organization
                            </CardDescription>
                        </div>
                        <Button onClick={() => setIsUploadOpen(true)} className="bg-[#7c3aed] hover:bg-[#8b5cf6] text-white font-bold text-xs px-5 py-2.5 rounded-xl transition-all shadow-lg cursor-pointer">
                            <Upload className="w-4 h-4 mr-2 inline" />
                            Upload Recording
                        </Button>
                    </div>
                </CardHeader>
                <CardContent className="p-0">
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
