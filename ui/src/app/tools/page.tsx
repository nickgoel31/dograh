"use client";

import { ExternalLink, Globe, Plus, RotateCcw, Search, Trash2, Wrench, X } from "lucide-react";
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

    const handleCreateTool = async (e?: React.FormEvent) => {
        if (e) e.preventDefault();
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
                router.push(`/tools/${response.data.tool_uuid}`);
            }
        } catch (err: unknown) {
            let errorMessage = "Failed to create tool";
            if (err && typeof err === "object") {
                const errObj = err as Record<string, unknown>;
                if (errObj.error && typeof errObj.error === "object") {
                    const errorData = errObj.error as Record<string, unknown>;
                    if (typeof errorData.detail === "string") {
                        errorMessage = errorData.detail;
                    }
                } else if (errObj.message && typeof errObj.message === "string") {
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

    if (loading || !user) {
        return (
            <div className="w-full py-16 flex items-center justify-center">
                <div className="space-y-4">
                    <Skeleton className="h-12 w-64" />
                    <Skeleton className="h-64 w-96" />
                </div>
            </div>
        );
    }

    return (
        <div className="flex flex-col h-full text-gray-900 dark:text-white font-sans select-none relative" style={{ backgroundColor: '#161715' }}>
            {/* Top Sub-Header matching demo styling */}
            <header className="px-8 pt-6 pb-3 flex items-center justify-between sticky top-0 z-20 border-b border-gray-100 dark:border-[#282b26]" style={{ backgroundColor: '#161715' }}>
                <div className="space-y-0.5">
                    <h1 className="text-base font-semibold text-gray-900 dark:text-white tracking-tight">
                        Tools
                    </h1>
                    <p className="text-xs text-gray-500 dark:text-gray-400 flex items-center gap-1">
                        <span>Manage reusable tools that can be used across your workflows.</span>
                        <a
                            href="https://docs.dograh.com/voice-agent/tools/introduction"
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-amber-700 dark:text-amber-400 hover:underline flex items-center gap-0.5 font-medium"
                        >
                            <span>Learn more</span>
                            <ExternalLink className="w-3 h-3" />
                        </a>
                    </p>
                </div>

                <button
                    onClick={() => setIsCreateDialogOpen(true)}
                    className="flex items-center gap-1.5 px-4 py-2 bg-black dark:bg-[#bcf0da] hover:bg-gray-800 dark:hover:bg-[#a5e9cd] text-white dark:text-[#082117] text-xs font-bold rounded-full shadow-xs transition-all active:scale-[0.98] cursor-pointer"
                >
                    <Plus className="w-3.5 h-3.5 stroke-[2.5]" />
                    <span>Create Tool</span>
                </button>
            </header>

            {/* Main Content Workspace Container */}
            <div className="max-w-5xl w-full mx-auto px-8 pt-6 pb-16 flex flex-col gap-6">
                {error && (
                    <div className="p-4 bg-red-500/10 border border-red-500/20 rounded-xl text-red-600 dark:text-red-400 text-xs font-semibold">
                        {error}
                    </div>
                )}

                {/* Your Tools Container Card matching demo aesthetic */}
                <div
                    className="border border-gray-200/90 dark:border-[#282b26] rounded-2xl p-6 shadow-2xs space-y-6"
                    style={{ backgroundColor: '#1C1E1A' }}
                >
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                        <div className="space-y-0.5">
                            <h2 className="text-sm font-bold text-gray-900 dark:text-white">Your Tools</h2>
                            <p className="text-xs text-gray-400 dark:text-gray-500">
                                Create and manage tools for your organization
                            </p>
                        </div>

                        <button
                            onClick={() => setIsCreateDialogOpen(true)}
                            className="flex items-center gap-1.5 px-4 py-2 bg-black dark:bg-[#bcf0da] hover:bg-gray-800 dark:hover:bg-[#a5e9cd] text-white dark:text-[#082117] text-xs font-bold rounded-full shadow-xs transition-all active:scale-[0.98] w-fit cursor-pointer"
                        >
                            <Plus className="w-3.5 h-3.5 stroke-[2.5]" />
                            <span>Create Tool</span>
                        </button>
                    </div>

                    {/* Search Tools Input */}
                    <div className="relative w-full">
                        <Search className="w-4 h-4 text-gray-400 dark:text-gray-500 absolute left-3.5 top-1/2 -translate-y-1/2" />
                        <input
                            type="text"
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                            placeholder="Search tools..."
                            className="w-full pl-10 pr-4 py-2.5 border border-gray-200 dark:border-[#282b26] rounded-xl text-xs text-gray-800 dark:text-white placeholder-gray-400 dark:placeholder-gray-500 focus:outline-hidden transition-all font-normal"
                            style={{ backgroundColor: '#161715' }}
                        />
                    </div>

                    {/* Tools List or Empty State */}
                    {isLoading ? (
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
                    ) : activeTools.length > 0 ? (
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-2">
                            {activeTools.map((tool) => (
                                <div
                                    key={tool.tool_uuid}
                                    className="p-5 border border-gray-200/80 dark:border-[#282b26] rounded-2xl flex flex-col justify-between gap-4 transition-all group cursor-pointer hover:border-gray-300 dark:hover:border-[#383c35]"
                                    style={{ backgroundColor: '#161715' }}
                                    onClick={() => router.push(`/tools/${tool.tool_uuid}`)}
                                >
                                    <div className="space-y-2">
                                        <div className="flex items-start justify-between gap-2">
                                            <div className="flex items-center gap-2.5">
                                                <div
                                                    className="p-2 rounded-xl border border-gray-200 dark:border-[#282b26] shadow-2xs flex items-center justify-center"
                                                    style={{ backgroundColor: '#1C1E1A' }}
                                                >
                                                    {renderToolIcon(tool.category, "w-4 h-4 text-amber-600 dark:text-amber-400")}
                                                </div>
                                                <h3 className="text-xs font-bold text-gray-900 dark:text-white group-hover:text-amber-700 dark:group-hover:text-amber-400 transition-colors">
                                                    {tool.name}
                                                </h3>
                                            </div>

                                            <button
                                                onClick={(e) => handleDeleteTool(tool.tool_uuid, e)}
                                                className="p-1 text-gray-400 hover:text-red-600 transition-colors cursor-pointer"
                                                title="Archive Tool"
                                            >
                                                <Trash2 className="w-4 h-4" />
                                            </button>
                                        </div>

                                        <p className="text-[11.5px] text-gray-500 dark:text-gray-400 leading-relaxed">
                                            {tool.description || "No description provided."}
                                        </p>
                                    </div>

                                    <div className="pt-3 border-t border-gray-200/60 dark:border-[#282b26] flex items-center justify-between text-xs text-gray-400 dark:text-gray-500">
                                        <span className="px-2.5 py-0.5 bg-gray-200/60 dark:bg-[#282b26] text-gray-800 dark:text-gray-200 rounded-full text-[11px] font-semibold">
                                            {tool.category === "http_api" ? "HTTP API" : tool.category === "end_call" ? "End Call" : tool.category}
                                        </span>

                                        <span className="capitalize">{tool.status}</span>
                                    </div>
                                </div>
                            ))}
                        </div>
                    ) : (
                        /* Empty State matching demo screenshot */
                        <div className="py-16 flex flex-col items-center justify-center text-center space-y-4">
                            <div className="w-16 h-16 rounded-full bg-gray-100 dark:bg-[#161715] flex items-center justify-center text-gray-400 dark:text-gray-500 border border-gray-200/50 dark:border-[#282b26]">
                                <Globe className="w-8 h-8 stroke-[1.5]" />
                            </div>

                            <div className="space-y-1">
                                <h4 className="text-sm font-semibold text-gray-700 dark:text-gray-300">
                                    {searchQuery ? "No tools match your search" : "No tools found"}
                                </h4>
                            </div>

                            <button
                                onClick={() => setIsCreateDialogOpen(true)}
                                className="px-5 py-2.5 bg-black dark:bg-[#bcf0da] hover:bg-gray-800 dark:hover:bg-[#a5e9cd] text-white dark:text-[#082117] text-xs font-bold rounded-full shadow-xs transition-all active:scale-[0.98] cursor-pointer"
                            >
                                Create Your First Tool
                            </button>
                        </div>
                    )}

                    {/* Archived Tools Section */}
                    {archivedTools.length > 0 && (
                        <div className="mt-8 border-t border-gray-200/60 dark:border-[#282b26] pt-6">
                            <h3 className="text-xs font-bold text-gray-500 dark:text-gray-400 mb-4">
                                Archived Tools
                            </h3>
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                {archivedTools.map((tool) => (
                                    <div
                                        key={tool.tool_uuid}
                                        className="p-5 border border-gray-200/80 dark:border-[#282b26] rounded-2xl flex flex-col justify-between gap-4 opacity-60 hover:opacity-100 transition-all cursor-pointer"
                                        style={{ backgroundColor: '#161715' }}
                                        onClick={() => router.push(`/tools/${tool.tool_uuid}`)}
                                    >
                                        <div className="space-y-2">
                                            <div className="flex items-start justify-between gap-2">
                                                <div className="flex items-center gap-2.5">
                                                    <div
                                                        className="p-2 rounded-xl border border-gray-200 dark:border-[#282b26] shadow-2xs flex items-center justify-center"
                                                        style={{ backgroundColor: '#1C1E1A' }}
                                                    >
                                                        {renderToolIcon(tool.category, "w-4 h-4 text-gray-400")}
                                                    </div>
                                                    <h3 className="text-xs font-bold text-gray-700 dark:text-gray-300">
                                                        {tool.name}
                                                    </h3>
                                                </div>

                                                <button
                                                    onClick={(e) => handleUnarchiveTool(tool.tool_uuid, e)}
                                                    className="p-1 text-gray-400 hover:text-white transition-colors cursor-pointer"
                                                    title="Restore Tool"
                                                >
                                                    <RotateCcw className="w-4 h-4" />
                                                </button>
                                            </div>

                                            <p className="text-[11.5px] text-gray-500 dark:text-gray-400 leading-relaxed">
                                                {tool.description || "No description provided."}
                                            </p>
                                        </div>

                                        <div className="pt-3 border-t border-gray-200/60 dark:border-[#282b26] flex items-center justify-between text-xs text-gray-400 dark:text-gray-500">
                                            <span className="px-2.5 py-0.5 bg-gray-200/60 dark:bg-[#282b26] text-gray-800 dark:text-gray-200 rounded-full text-[11px] font-semibold">
                                                {tool.category === "http_api" ? "HTTP API" : tool.category}
                                            </span>

                                            <span className="capitalize">Archived</span>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}
                </div>
            </div>

            {/* Create New Tool Modal exact matching demo screenshot fields */}
            {isCreateDialogOpen && (
                <div className="fixed inset-0 bg-black/50 backdrop-blur-xs z-50 flex items-center justify-center p-4">
                    <div
                        className="border border-gray-200 dark:border-[#282b26] rounded-2xl p-6 w-full max-w-lg shadow-2xl space-y-6 text-gray-900 dark:text-white"
                        style={{ backgroundColor: '#1C1E1A' }}
                    >
                        <div className="flex items-center justify-between pb-3 border-b border-gray-100 dark:border-[#282b26]">
                            <div className="space-y-0.5">
                                <h3 className="text-base font-bold text-gray-900 dark:text-white">
                                    Create New Tool
                                </h3>
                                <p className="text-xs text-gray-500 dark:text-gray-400">
                                    Create a new tool that can be used in your workflows.
                                </p>
                            </div>

                            <button
                                onClick={() => setIsCreateDialogOpen(false)}
                                className="p-1 text-gray-400 hover:text-gray-900 dark:hover:text-white rounded-lg transition-colors cursor-pointer"
                            >
                                <X className="w-5 h-5" />
                            </button>
                        </div>

                        <form onSubmit={handleCreateTool} className="space-y-5">
                            {/* Tool Type */}
                            <div className="space-y-1.5">
                                <label className="text-xs font-bold text-gray-900 dark:text-white block">
                                    Tool Type
                                </label>
                                <select
                                    value={newToolCategory}
                                    onChange={(e) => {
                                        const category = e.target.value as ToolCategory;
                                        setNewToolCategory(category);
                                        setCreateError(null);
                                        const categoryConfig = getCategoryConfig(category);
                                        if (categoryConfig?.autoFill) {
                                            setNewToolName(categoryConfig.autoFill.name);
                                            setNewToolDescription(categoryConfig.autoFill.description);
                                        }
                                    }}
                                    className="w-full px-3.5 py-2.5 border border-gray-200 dark:border-[#282b26] rounded-xl text-xs text-gray-900 dark:text-white font-medium focus:outline-hidden transition-all cursor-pointer"
                                    style={{ backgroundColor: '#161715' }}
                                >
                                    {TOOL_CATEGORIES.map((cat) => (
                                        <option
                                            key={cat.value}
                                            value={cat.value}
                                            disabled={cat.disabled}
                                            className="bg-white dark:bg-[#1c1e1a] text-gray-900 dark:text-white"
                                        >
                                            {cat.label}
                                        </option>
                                    ))}
                                </select>
                                <p className="text-[11px] text-gray-400 dark:text-gray-500">
                                    {getCategoryConfig(newToolCategory)?.description}
                                </p>
                            </div>

                            {/* Tool Name */}
                            <div className="space-y-1.5">
                                <label className="text-xs font-bold text-gray-900 dark:text-white block">
                                    Tool Name
                                </label>
                                <input
                                    type="text"
                                    value={newToolName}
                                    onChange={(e) => setNewToolName(e.target.value)}
                                    placeholder="e.g., Book Appointment, Check Inventory"
                                    required
                                    autoFocus
                                    className="w-full px-3.5 py-2.5 border border-gray-200 dark:border-[#282b26] rounded-xl text-xs text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-gray-500 font-normal focus:outline-hidden transition-all"
                                    style={{ backgroundColor: '#161715' }}
                                />
                                <p className="text-[11px] text-gray-400 dark:text-gray-500">
                                    Use a descriptive name, like &quot;Get Weather using API&quot; for a tool that fetches weather
                                </p>
                            </div>

                            {/* Description */}
                            <div className="space-y-1.5">
                                <label className="text-xs font-bold text-gray-900 dark:text-white block">
                                    Description (Optional)
                                </label>
                                <input
                                    type="text"
                                    value={newToolDescription}
                                    onChange={(e) => setNewToolDescription(e.target.value)}
                                    placeholder="What does this tool do?"
                                    className="w-full px-3.5 py-2.5 border border-gray-200 dark:border-[#282b26] rounded-xl text-xs text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-gray-500 font-normal focus:outline-hidden transition-all"
                                    style={{ backgroundColor: '#161715' }}
                                />
                                <p className="text-[11px] text-gray-400 dark:text-gray-500">
                                    Provide a description which makes it easy for LLM to understand what this tool does
                                </p>
                            </div>

                            {/* MCP Specific Fields */}
                            {newToolCategory === "mcp" && (
                                <>
                                    <div className="space-y-1.5">
                                        <label className="text-xs font-bold text-gray-900 dark:text-white block">MCP Server URL</label>
                                        <input
                                            type="text"
                                            value={mcpUrl}
                                            onChange={(e) => setMcpUrl(e.target.value)}
                                            placeholder="https://your-mcp-server.example.com/mcp"
                                            className="w-full px-3.5 py-2.5 border border-gray-200 dark:border-[#282b26] rounded-xl text-xs text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-gray-500 focus:outline-hidden transition-all"
                                            style={{ backgroundColor: '#161715' }}
                                        />
                                    </div>
                                    <CredentialSelector
                                        value={mcpCredentialUuid}
                                        onChange={setMcpCredentialUuid}
                                        label="Credential (Optional)"
                                        description="Select a credential for authenticating with the MCP server, or leave empty for no auth."
                                    />
                                    <div className="space-y-1.5">
                                        <label className="text-xs font-bold text-gray-900 dark:text-white block">Tools Filter (Optional)</label>
                                        <input
                                            type="text"
                                            value={mcpToolsFilter}
                                            onChange={(e) => setMcpToolsFilter(e.target.value)}
                                            placeholder="e.g., tool_one, tool_two"
                                            className="w-full px-3.5 py-2.5 border border-gray-200 dark:border-[#282b26] rounded-xl text-xs text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-gray-500 focus:outline-hidden transition-all"
                                            style={{ backgroundColor: '#161715' }}
                                        />
                                    </div>
                                </>
                            )}

                            {createError && (
                                <div className="p-3 bg-red-500/10 border border-red-500/20 rounded-xl text-red-600 dark:text-red-400 text-xs font-semibold">
                                    {createError}
                                </div>
                            )}

                            {/* Modal Buttons */}
                            <div className="pt-3 border-t border-gray-100 dark:border-[#282b26] flex items-center justify-end gap-3">
                                <button
                                    type="button"
                                    onClick={() => setIsCreateDialogOpen(false)}
                                    className="px-5 py-2.5 bg-gray-100 dark:bg-[#161715] hover:bg-gray-200 dark:hover:bg-[#232621] text-gray-800 dark:text-gray-200 text-xs font-semibold rounded-full transition-all cursor-pointer"
                                >
                                    Cancel
                                </button>

                                <button
                                    type="submit"
                                    disabled={isCreating}
                                    className="px-5 py-2.5 bg-black dark:bg-[#bcf0da] hover:bg-gray-800 dark:hover:bg-[#a5e9cd] text-white dark:text-[#082117] text-xs font-bold rounded-full shadow-xs transition-all active:scale-[0.98] cursor-pointer disabled:opacity-50"
                                >
                                    {isCreating ? "Creating..." : "Create Tool"}
                                </button>
                            </div>
                        </form>
                    </div>
                </div>
            )}
        </div>
    );
}
