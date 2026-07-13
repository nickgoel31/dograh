"use client";

import { ExternalLink, Plus, RotateCcw, Search, Trash2, Wrench } from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";

import {
    createToolApiV1ToolsPost,
    deleteToolApiV1ToolsToolUuidDelete,
    listToolsApiV1ToolsGet,
    unarchiveToolApiV1ToolsToolUuidUnarchivePost,
} from "@/client/sdk.gen";
import type { CreateToolRequest, ToolResponse } from "@/client/types.gen";
import { CredentialSelector } from "@/components/http";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
    Card,
    CardContent,
    CardDescription,
    CardHeader,
    CardTitle,
} from "@/components/ui/card";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { useAuth } from "@/lib/auth";

import {
    createMcpDefinition,
    createToolDefinition,
    getCategoryConfig,
    MCP_URL_PATTERN,
    renderToolIcon,
    TOOL_CATEGORIES,
    type ToolCategory,
} from "./config";

export default function ToolsPage() {
    const { user, getAccessToken, redirectToLogin, loading } = useAuth();
    const router = useRouter();

    const [tools, setTools] = useState<ToolResponse[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [searchQuery, setSearchQuery] = useState("");
    const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false);
    const [newToolName, setNewToolName] = useState("");
    const [newToolDescription, setNewToolDescription] = useState("");
    const [newToolCategory, setNewToolCategory] = useState<ToolCategory>("http_api");
    const [isCreating, setIsCreating] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [createError, setCreateError] = useState<string | null>(null);

    // MCP-specific create dialog state
    const [mcpUrl, setMcpUrl] = useState("");
    const [mcpCredentialUuid, setMcpCredentialUuid] = useState("");
    const [mcpToolsFilter, setMcpToolsFilter] = useState("");

    // Redirect if not authenticated
    useEffect(() => {
        if (!loading && !user) {
            redirectToLogin();
        }
    }, [loading, user, redirectToLogin]);

    const fetchTools = useCallback(async () => {
        if (loading || !user) return;

        try {
            setIsLoading(true);
            setError(null);
            const accessToken = await getAccessToken();

            const response = await listToolsApiV1ToolsGet({
                headers: {
                    Authorization: `Bearer ${accessToken}`,
                },
                query: {
                    status: "active,archived",
                },
            });

            if (response.data) {
                setTools(response.data);
            }
        } catch (err) {
            setError("Failed to fetch tools");
            console.error("Error fetching tools:", err);
        } finally {
            setIsLoading(false);
        }
    }, [loading, user, getAccessToken]);

    useEffect(() => {
        fetchTools();
    }, [fetchTools]);

    const handleCreateTool = async () => {
        if (!newToolName.trim()) {
            setCreateError("Please enter a name for the tool");
            return;
        }

        if (newToolCategory === "mcp" && !mcpUrl.trim()) {
            setCreateError("Please enter the MCP server URL");
            return;
        }

        if (newToolCategory === "mcp" && !MCP_URL_PATTERN.test(mcpUrl.trim())) {
            setCreateError("MCP server URL must start with http:// or https://");
            return;
        }

        try {
            setIsCreating(true);
            setCreateError(null);
            const accessToken = await getAccessToken();

            const categoryConfig = getCategoryConfig(newToolCategory);

            const definition = newToolCategory === "mcp"
                ? createMcpDefinition(mcpUrl, mcpCredentialUuid, mcpToolsFilter)
                : createToolDefinition(newToolCategory);

            const requestBody: CreateToolRequest = {
                name: newToolName,
                description: newToolDescription || undefined,
                category: newToolCategory,
                icon: categoryConfig?.iconName || "globe",
                icon_color: categoryConfig?.iconColor || "#3B82F6",
                definition,
            };

            const response = await createToolApiV1ToolsPost({
                body: requestBody,
                headers: {
                    Authorization: `Bearer ${accessToken}`,
                },
            });

            if (response.error) {
                const errorDetail = (response.error as { detail?: string })?.detail;
                setCreateError(errorDetail || "Failed to create tool");
                return;
            }

            if (response.data) {
                setIsCreateDialogOpen(false);
                setNewToolName("");
                setNewToolDescription("");
                setNewToolCategory("http_api");
                setMcpUrl("");
                setMcpCredentialUuid("");
                setMcpToolsFilter("");
                // Navigate to the new tool's detail page
                router.push(`/tools/${response.data.tool_uuid}`);
            }
        } catch (err: unknown) {
            let errorMessage = "Failed to create tool";
            if (err && typeof err === "object") {
                const errObj = err as Record<string, unknown>;
                // Handle API client error response
                if (errObj.error && typeof errObj.error === "object") {
                    const errorData = errObj.error as Record<string, unknown>;
                    if (typeof errorData.detail === "string") {
                        errorMessage = errorData.detail;
                    }
                }
                // Handle standard Error objects
                else if (errObj.message && typeof errObj.message === "string") {
                    errorMessage = errObj.message;
                }
            }
            setCreateError(errorMessage);
            console.error("Error creating tool:", err);
        } finally {
            setIsCreating(false);
        }
    };

    const handleDeleteTool = async (toolUuid: string, e: React.MouseEvent) => {
        e.stopPropagation();
        if (!confirm("Are you sure you want to archive this tool?")) return;

        try {
            setError(null);
            const accessToken = await getAccessToken();

            await deleteToolApiV1ToolsToolUuidDelete({
                path: {
                    tool_uuid: toolUuid,
                },
                headers: {
                    Authorization: `Bearer ${accessToken}`,
                },
            });

            fetchTools();
        } catch (err) {
            setError("Failed to archive tool");
            console.error("Error archiving tool:", err);
        }
    };

    const handleUnarchiveTool = async (toolUuid: string, e: React.MouseEvent) => {
        e.stopPropagation();

        try {
            setError(null);
            const accessToken = await getAccessToken();

            await unarchiveToolApiV1ToolsToolUuidUnarchivePost({
                path: {
                    tool_uuid: toolUuid,
                },
                headers: {
                    Authorization: `Bearer ${accessToken}`,
                },
            });

            fetchTools();
        } catch (err) {
            setError("Failed to unarchive tool");
            console.error("Error unarchiving tool:", err);
        }
    };

    const filteredTools = tools.filter(
        (tool) =>
            tool.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
            tool.description?.toLowerCase().includes(searchQuery.toLowerCase())
    );

    const activeTools = filteredTools.filter((tool) => tool.status === "active");
    const archivedTools = filteredTools.filter((tool) => tool.status === "archived");

    const getCategoryBadge = (category: string) => {
        switch (category) {
            case "http_api":
                return <Badge variant="default">HTTP API</Badge>;
            case "end_call":
                return <Badge variant="destructive">End Call</Badge>;
            case "calculator":
                return <Badge variant="secondary">Calculator</Badge>;
            case "native":
                return <Badge variant="secondary">Native</Badge>;
            case "integration":
                return <Badge variant="outline">Integration</Badge>;
            case "mcp":
                return <Badge variant="outline">MCP</Badge>;
            default:
                return <Badge variant="outline">{category}</Badge>;
        }
    };

    const getStatusBadge = (status: string) => {
        switch (status) {
            case "active":
                return <Badge className="bg-green-500">Active</Badge>;
            case "draft":
                return <Badge variant="secondary">Draft</Badge>;
            case "archived":
                return <Badge variant="destructive">Archived</Badge>;
            default:
                return <Badge variant="outline">{status}</Badge>;
        }
    };

    if (loading || !user) {
        return (
            <div className="min-h-screen bg-background flex items-center justify-center">
                <div className="space-y-4">
                    <Skeleton className="h-12 w-64" />
                    <Skeleton className="h-64 w-96" />
                </div>
            </div>
        );
    }

    return (
        <div className="min-h-screen bg-[#08080a] p-6 max-w-[1600px] mx-auto w-full page-enter">
            {/* Header */}
            <div className="border-b border-[#1d1d22]/50 pb-6 mb-6">
                <h1 className="text-2xl font-bold tracking-tight text-white flex items-center gap-3">
                    Tools
                </h1>
                <p className="text-xs text-zinc-500 mt-1">
                    Manage reusable tools that can be used across your workflows.{" "}
                    <a href="https://docs.dograh.com/voice-agent/tools/introduction" target="_blank" rel="noopener noreferrer" className="text-blue-400 hover:underline inline-flex items-center gap-0.5">
                        Learn more <ExternalLink className="w-3 h-3 inline" />
                    </a>
                </p>
            </div>

            {error && (
                <div className="mb-4 p-4 bg-destructive/10 border border-destructive/20 rounded-xl text-red-400 text-xs font-semibold">
                    {error}
                </div>
            )}

            <Card className="bg-[#111113] border border-[#1d1d22] rounded-2xl p-6 shadow-none">
                <CardHeader className="p-0 pb-6 mb-6 border-b border-[#1d1d22]/50">
                    <div className="flex justify-between items-center">
                        <div>
                            <CardTitle className="text-lg font-bold text-white">Your Tools</CardTitle>
                            <CardDescription className="text-xs text-zinc-500">
                                Create and manage tools for your organization
                            </CardDescription>
                        </div>
                        <Button onClick={() => setIsCreateDialogOpen(true)} className="bg-[#7c3aed] hover:bg-[#8b5cf6] text-white font-bold text-xs px-5 py-2.5 rounded-xl transition-all shadow-lg cursor-pointer">
                            <Plus className="w-4 h-4 mr-2 inline" />
                            Create Tool
                        </Button>
                    </div>
                </CardHeader>
                <CardContent className="p-0">
                    {/* Search */}
                    <div className="relative mb-6">
                        <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-zinc-500" />
                        <Input
                            placeholder="Search tools..."
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                            className="bg-[#08080a] border border-[#1d1d22] rounded-xl py-2.5 pl-10 pr-4 text-xs text-white focus:outline-none focus:border-zinc-700 focus:ring-1 focus:ring-zinc-700 transition-all w-full"
                        />
                    </div>

                    {isLoading ? (
                        <div className="space-y-4">
                            {[1, 2, 3].map((i) => (
                                <div
                                    key={i}
                                    className="flex items-center justify-between p-4 border border-[#1d1d22] rounded-xl bg-[#111113] shimmer"
                                    style={{ animationDelay: `${i * 0.08}s` }}
                                >
                                    <div className="space-y-2">
                                        <Skeleton className="h-4 w-32" />
                                        <Skeleton className="h-3 w-48" />
                                    </div>
                                    <Skeleton className="h-8 w-20" />
                                </div>
                            ))}
                        </div>
                    ) : activeTools.length === 0 && archivedTools.length === 0 ? (
                        <div className="text-center py-12">
                            {renderToolIcon("http_api", "w-12 h-12 text-zinc-500 mx-auto mb-4")}
                            <p className="text-xs text-zinc-400 mb-4">
                                {searchQuery
                                    ? "No tools match your search"
                                    : "No tools found"}
                            </p>
                            {!searchQuery && (
                                <Button onClick={() => setIsCreateDialogOpen(true)} className="bg-[#7c3aed] hover:bg-[#8b5cf6] text-white font-bold text-xs px-5 py-2.5 rounded-xl transition-all shadow-lg cursor-pointer">
                                    Create Your First Tool
                                </Button>
                            )}
                        </div>
                    ) : (
                        <>
                            {/* Active Tools */}
                            {activeTools.length > 0 ? (
                                <div className="space-y-3">
                                    {activeTools.map((tool) => (
                                        <div
                                            key={tool.tool_uuid}
                                            className="flex items-center justify-between p-4 bg-[#08080a] border border-[#1d1d22] rounded-xl hover:border-zinc-700 transition-all cursor-pointer"
                                            onClick={() =>
                                                router.push(`/tools/${tool.tool_uuid}`)
                                            }
                                        >
                                            <div className="flex items-center gap-4">
                                                <div
                                                    className="w-10 h-10 shrink-0 rounded-xl flex items-center justify-center border border-zinc-700/30"
                                                    style={{
                                                        backgroundColor:
                                                            tool.icon_color || getCategoryConfig(tool.category as ToolCategory)?.iconColor || "#3B82F6",
                                                    }}
                                                >
                                                    {renderToolIcon(tool.category)}
                                                </div>
                                                <div>
                                                    <div className="flex items-center gap-2 flex-wrap">
                                                        <span className="font-semibold text-zinc-200 text-sm hover:text-white transition-colors">
                                                            {tool.name}
                                                        </span>
                                                        <span className="bg-[#1c1c1f] text-zinc-400 border border-zinc-700/50 text-[9px] font-bold px-1.5 py-0.5 rounded uppercase">
                                                            {tool.category === "http_api" ? "HTTP API" : tool.category === "end_call" ? "End Call" : tool.category}
                                                        </span>
                                                    </div>
                                                    {tool.description && (
                                                        <p className="text-xs text-zinc-500 mt-1">
                                                            {tool.description}
                                                        </p>
                                                    )}
                                                </div>
                                            </div>
                                            <Button
                                                variant="ghost"
                                                onClick={(e) =>
                                                    handleDeleteTool(tool.tool_uuid, e)
                                                }
                                                className="p-1.5 rounded-lg border border-zinc-700/50 text-zinc-500 hover:text-rose-400 transition-colors bg-transparent"
                                            >
                                                <Trash2 className="w-4 h-4" />
                                            </Button>
                                        </div>
                                    ))}
                                </div>
                            ) : !searchQuery ? (
                                <div className="text-center py-8">
                                    <p className="text-xs text-zinc-400 mb-4">
                                        No active tools
                                    </p>
                                    <Button onClick={() => setIsCreateDialogOpen(true)} className="bg-[#7c3aed] hover:bg-[#8b5cf6] text-white font-bold text-xs px-5 py-2.5 rounded-xl transition-all shadow-lg cursor-pointer">
                                        Create Your First Tool
                                    </Button>
                                </div>
                            ) : null}

                            {/* Archived Tools */}
                            {archivedTools.length > 0 && (
                                <div className="mt-8 border-t border-[#1d1d22]/50 pt-6">
                                    <h3 className="text-sm font-semibold text-zinc-400 mb-4">
                                        Archived Tools
                                    </h3>
                                    <div className="space-y-3">
                                        {archivedTools.map((tool) => (
                                            <div
                                                key={tool.tool_uuid}
                                                className="flex items-center justify-between p-4 bg-[#08080a]/60 border border-[#1d1d22] rounded-xl hover:border-zinc-700 transition-all cursor-pointer opacity-60"
                                                onClick={() =>
                                                    router.push(`/tools/${tool.tool_uuid}`)
                                                }
                                            >
                                                <div className="flex items-center gap-4">
                                                    <div
                                                        className="w-10 h-10 shrink-0 rounded-xl flex items-center justify-center border border-zinc-700/30"
                                                        style={{
                                                            backgroundColor:
                                                                tool.icon_color || getCategoryConfig(tool.category as ToolCategory)?.iconColor || "#3B82F6",
                                                        }}
                                                    >
                                                        {renderToolIcon(tool.category)}
                                                    </div>
                                                    <div>
                                                        <div className="flex items-center gap-2 flex-wrap">
                                                            <span className="font-semibold text-zinc-300 text-sm">
                                                                {tool.name}
                                                            </span>
                                                            <span className="bg-[#1c1c1f] text-zinc-400 border border-zinc-700/50 text-[9px] font-bold px-1.5 py-0.5 rounded uppercase">
                                                                {tool.category === "http_api" ? "HTTP API" : tool.category === "end_call" ? "End Call" : tool.category}
                                                            </span>
                                                            <span className="bg-zinc-800 text-zinc-400 border border-zinc-700/50 text-[10px] font-semibold px-2.5 py-0.5 rounded-full">Archived</span>
                                                        </div>
                                                        {tool.description && (
                                                            <p className="text-xs text-zinc-500 mt-1">
                                                                {tool.description}
                                                            </p>
                                                        )}
                                                    </div>
                                                </div>
                                                <Button
                                                    variant="ghost"
                                                    onClick={(e) =>
                                                        handleUnarchiveTool(tool.tool_uuid, e)
                                                    }
                                                    className="p-1.5 rounded-lg border border-zinc-700/50 text-zinc-500 hover:text-white transition-colors bg-transparent"
                                                    title="Restore tool"
                                                >
                                                    <RotateCcw className="w-4 h-4" />
                                                </Button>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            )}
                        </>
                    )}
                </CardContent>
            </Card>

            {/* Create Tool Dialog */}
            <Dialog open={isCreateDialogOpen} onOpenChange={(open) => {
                setIsCreateDialogOpen(open);
                if (open) {
                    setCreateError(null);
                } else {
                    // Reset MCP fields when dialog is closed without creating
                    setMcpUrl("");
                    setMcpCredentialUuid("");
                    setMcpToolsFilter("");
                }
            }}>
                <DialogContent className="bg-[#111113] border border-[#2c2c35] rounded-2xl w-full max-w-lg p-6 shadow-2xl space-y-6 text-white">
                    <DialogHeader className="space-y-1">
                        <DialogTitle className="text-lg font-bold text-white">Create New Tool</DialogTitle>
                        <DialogDescription className="text-xs text-zinc-500 leading-relaxed">
                            Create a new tool that can be used in your workflows.
                        </DialogDescription>
                    </DialogHeader>
                    <div className="grid gap-4 py-2">
                        <div className="grid gap-1">
                            <Label className="text-xs font-bold text-zinc-300 block mb-1.5">Tool Type</Label>
                            <Select
                                value={newToolCategory}
                                onValueChange={(v) => {
                                    const category = v as ToolCategory;
                                    setNewToolCategory(category);
                                    setCreateError(null);
                                    const categoryConfig = getCategoryConfig(category);
                                    if (categoryConfig?.autoFill) {
                                        setNewToolName(categoryConfig.autoFill.name);
                                        setNewToolDescription(categoryConfig.autoFill.description);
                                    }
                                }}
                            >
                                <SelectTrigger className="w-full bg-[#08080a] border border-[#1d1d22] rounded-xl py-2.5 px-4 text-xs text-white focus:outline-none focus:border-zinc-700 transition-all">
                                    <SelectValue />
                                </SelectTrigger>
                                <SelectContent className="bg-[#111113] border border-[#1d1d22] text-white">
                                    {TOOL_CATEGORIES.map((category) => (
                                        <SelectItem
                                            key={category.value}
                                            value={category.value}
                                            disabled={category.disabled}
                                        >
                                            {category.label}
                                        </SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                            <p className="text-[10px] text-zinc-500 mt-1 leading-snug">
                                {getCategoryConfig(newToolCategory)?.description}
                            </p>
                        </div>
                        <div className="grid gap-1">
                            <Label htmlFor="name" className="text-xs font-bold text-zinc-300 block">Tool Name</Label>
                            <span className="text-[10px] text-zinc-500 mb-1 leading-snug">
                                Use a descriptive name, like &quot;Get Weather using API&quot; for a tool that fetches weather
                            </span>
                            <Input
                                id="name"
                                value={newToolName}
                                className="bg-[#08080a] border border-[#1d1d22] rounded-xl py-2.5 px-4 text-xs text-white focus:outline-none focus:border-zinc-700 focus:ring-1 focus:ring-zinc-700 transition-all"
                                onChange={(e) => setNewToolName(e.target.value)}
                                placeholder="e.g., Book Appointment, Check Inventory"
                            />
                        </div>
                        <div className="grid gap-1">
                            <Label htmlFor="description" className="text-xs font-bold text-zinc-300 block">Description (Optional)</Label>
                            <span className="text-[10px] text-zinc-500 mb-1 leading-snug">
                                Provide a description which makes it easy for LLM to understand what this tool does
                            </span>
                            <Input
                                id="description"
                                value={newToolDescription}
                                className="bg-[#08080a] border border-[#1d1d22] rounded-xl py-2.5 px-4 text-xs text-white focus:outline-none focus:border-zinc-700 focus:ring-1 focus:ring-zinc-700 transition-all"
                                onChange={(e) => setNewToolDescription(e.target.value)}
                                placeholder="What does this tool do?"
                            />
                        </div>

                        {newToolCategory === "mcp" && (
                            <>
                                <div className="grid gap-1">
                                    <Label htmlFor="mcp-url" className="text-xs font-bold text-zinc-300 block mb-1.5">MCP Server URL</Label>
                                    <Input
                                        id="mcp-url"
                                        value={mcpUrl}
                                        className="bg-[#08080a] border border-[#1d1d22] rounded-xl py-2.5 px-4 text-xs text-white focus:outline-none focus:border-zinc-700 focus:ring-1 focus:ring-zinc-700 transition-all"
                                        onChange={(e) => setMcpUrl(e.target.value)}
                                        placeholder="https://your-mcp-server.example.com/mcp"
                                    />
                                </div>
                                <div className="grid gap-1">
                                    <Label className="text-xs font-bold text-zinc-300 block mb-1.5">Transport</Label>
                                    <Input
                                        value="Streamable HTTP"
                                        className="bg-[#08080a] border border-[#1d1d22] rounded-xl py-2.5 px-4 text-xs text-zinc-400 focus:outline-none focus:border-zinc-700 transition-all"
                                        disabled
                                        readOnly
                                    />
                                </div>
                                <CredentialSelector
                                    value={mcpCredentialUuid}
                                    onChange={setMcpCredentialUuid}
                                    label="Credential (Optional)"
                                    description="Select a credential for authenticating with the MCP server, or leave empty for no auth."
                                />
                                <div className="grid gap-1">
                                    <Label htmlFor="mcp-tools-filter" className="text-xs font-bold text-zinc-300 block mb-1.5">Tools Filter (Optional)</Label>
                                    <Input
                                        id="mcp-tools-filter"
                                        value={mcpToolsFilter}
                                        className="bg-[#08080a] border border-[#1d1d22] rounded-xl py-2.5 px-4 text-xs text-white focus:outline-none focus:border-zinc-700 focus:ring-1 focus:ring-zinc-700 transition-all"
                                        onChange={(e) => setMcpToolsFilter(e.target.value)}
                                        placeholder="e.g., tool_one, tool_two"
                                    />
                                    <p className="text-[10px] text-zinc-500 mt-1 leading-snug">
                                        Comma-separated list of tool names to allow. Leave empty to expose all tools from the server.
                                    </p>
                                </div>
                            </>
                        )}
                    </div>
                    {createError && (
                        <div className="p-3 bg-destructive/10 border border-destructive/20 rounded-xl text-red-400 text-xs font-semibold">
                            {createError}
                        </div>
                    )}
                    <DialogFooter className="flex gap-3 justify-end pt-2 border-t border-[#1d1d22]/50">
                        <Button
                            className="bg-[#121214] border border-[#232328] hover:bg-[#1a1a1f] px-3 py-1.5 rounded-xl text-xs text-zinc-300 font-medium transition-colors cursor-pointer"
                            onClick={() => setIsCreateDialogOpen(false)}
                        >
                            Cancel
                        </Button>
                        <Button className="bg-[#7c3aed] hover:bg-[#8b5cf6] text-white font-bold text-xs px-5 py-2.5 rounded-xl transition-all shadow-lg cursor-pointer" onClick={handleCreateTool} disabled={isCreating}>
                            {isCreating ? "Creating..." : "Create Tool"}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </div>
    );
}
