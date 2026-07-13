"use client";

import { ArrowLeft, Code, ExternalLink, Loader2, Save } from "lucide-react";
import { useParams, useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";

import {
    getToolApiV1ToolsToolUuidGet,
    listRecordingsApiV1WorkflowRecordingsGet,
    updateToolApiV1ToolsToolUuidPut,
} from "@/client/sdk.gen";
import type {
    EndCallConfig,
    HttpApiToolDefinition,
    RecordingResponseSchema,
    ToolResponse,
    TransferCallConfig as APITransferCallConfig,
    UpdateToolRequest,
} from "@/client/types.gen";
import {
    CredentialSelector,
    type HttpMethod,
    type KeyValueItem,
    type ParameterType,
    type PresetToolParameter,
    type ToolParameter,
    validateUrl,
} from "@/components/http";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { TOOL_DOCUMENTATION_URLS } from "@/constants/documentation";
import { detailFromError } from "@/lib/apiError";
import { useAuth } from "@/lib/auth";

import {
    createMcpDefinition,
    DEFAULT_END_CALL_REASON_DESCRIPTION,
    type EndCallMessageType,
    getCategoryConfig,
    getToolTypeLabel,
    MCP_URL_PATTERN,
    renderToolIcon,
    type ToolCategory,
} from "../config";
import { BuiltinToolConfig, EndCallToolConfig, HttpApiToolConfig, TransferCallToolConfig } from "./components";

function normalizeParameterType(value: string | null | undefined): ParameterType {
    switch (value) {
        case "number":
        case "boolean":
        case "object":
        case "array":
            return value;
        default:
            return "string";
    }
}

export default function ToolDetailPage() {
    const { toolUuid } = useParams<{ toolUuid: string }>();
    const { user, getAccessToken, redirectToLogin, loading } = useAuth();
    const router = useRouter();

    const [tool, setTool] = useState<ToolResponse | null>(null);
    const [isLoading, setIsLoading] = useState(true);
    const [isSaving, setIsSaving] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [saveSuccess, setSaveSuccess] = useState(false);
    const [showCodeDialog, setShowCodeDialog] = useState(false);

    // Common form state
    const [name, setName] = useState("");
    const [description, setDescription] = useState("");

    // Shared form state
    const [customMessage, setCustomMessage] = useState("");

    // HTTP API form state
    const [httpMethod, setHttpMethod] = useState<HttpMethod>("POST");
    const [url, setUrl] = useState("");
    const [credentialUuid, setCredentialUuid] = useState("");
    const [headers, setHeaders] = useState<KeyValueItem[]>([]);
    const [parameters, setParameters] = useState<ToolParameter[]>([]);
    const [presetParameters, setPresetParameters] = useState<PresetToolParameter[]>([]);
    const [timeoutMs, setTimeoutMs] = useState(5000);

    // End Call form state
    const [endCallMessageType, setEndCallMessageType] = useState<EndCallMessageType>("none");
    const [endCallReason, setEndCallReason] = useState(false);
    const [endCallReasonDescription, setEndCallReasonDescription] = useState("");
    const [audioRecordingId, setAudioRecordingId] = useState("");

    const handleEndCallReasonChange = (enabled: boolean) => {
        setEndCallReason(enabled);
        if (enabled && !endCallReasonDescription) {
            setEndCallReasonDescription(DEFAULT_END_CALL_REASON_DESCRIPTION);
        }
    };

    // Transfer Call form state
    const [transferDestination, setTransferDestination] = useState("");
    const [transferMessageType, setTransferMessageType] = useState<EndCallMessageType>("none");
    const [transferTimeout, setTransferTimeout] = useState(30);
    const [transferAudioRecordingId, setTransferAudioRecordingId] = useState("");

    // HTTP API form state - custom message type
    const [customMessageType, setCustomMessageType] = useState<'text' | 'audio'>('text');
    const [customMessageRecordingId, setCustomMessageRecordingId] = useState("");

    // MCP form state
    const [mcpUrl, setMcpUrl] = useState("");
    const [mcpCredentialUuid, setMcpCredentialUuid] = useState("");
    const [mcpToolsFilter, setMcpToolsFilter] = useState("");

    // Org-level recordings for audio dropdowns
    const [recordings, setRecordings] = useState<RecordingResponseSchema[]>([]);

    // Redirect if not authenticated
    useEffect(() => {
        if (!loading && !user) {
            redirectToLogin();
        }
    }, [loading, user, redirectToLogin]);

    const fetchTool = useCallback(async () => {
        if (loading || !user || !toolUuid) return;

        try {
            setIsLoading(true);
            setError(null);
            const accessToken = await getAccessToken();

            const response = await getToolApiV1ToolsToolUuidGet({
                path: { tool_uuid: toolUuid },
                headers: {
                    Authorization: `Bearer ${accessToken}`,
                },
            });

            if (response.data) {
                setTool(response.data);
                populateFormFromTool(response.data);
            }
        } catch (err) {
            setError("Failed to fetch tool");
            console.error("Error fetching tool:", err);
        } finally {
            setIsLoading(false);
        }
    }, [loading, user, toolUuid, getAccessToken]);

    const populateFormFromTool = (tool: ToolResponse) => {
        setName(tool.name);
        setDescription(tool.description || "");

        if (tool.category === "end_call") {
            // Populate end call specific fields
            const config = tool.definition?.config as EndCallConfig | undefined;
            if (config) {
                setEndCallMessageType(config.messageType || "none");
                setCustomMessage(config.customMessage || "");
                setAudioRecordingId(config.audioRecordingId || "");
                setEndCallReason(config.endCallReason ?? false);
                setEndCallReasonDescription(config.endCallReasonDescription || "");
            } else {
                setEndCallMessageType("none");
                setCustomMessage("");
                setAudioRecordingId("");
                setEndCallReason(false);
                setEndCallReasonDescription("");
            }
        } else if (tool.category === "transfer_call") {
            // Populate transfer call specific fields
            const config = tool.definition?.config as APITransferCallConfig | undefined;
            if (config) {
                setTransferDestination(config.destination || "");
                setTransferMessageType(config.messageType || "none");
                setCustomMessage(config.customMessage || "");
                setTransferAudioRecordingId(config.audioRecordingId || "");
                setTransferTimeout(config.timeout ?? 30);
            } else {
                setTransferDestination("");
                setTransferMessageType("none");
                setCustomMessage("");
                setTransferAudioRecordingId("");
                setTransferTimeout(30);
            }
        } else if (tool.category === "mcp") {
            // Populate MCP specific fields
            const config = tool.definition?.config as
                | { url?: string; credential_uuid?: string | null; tools_filter?: string[] }
                | undefined;
            if (config) {
                setMcpUrl(config.url || "");
                setMcpCredentialUuid(config.credential_uuid || "");
                setMcpToolsFilter(
                    Array.isArray(config.tools_filter)
                        ? config.tools_filter.join(", ")
                        : ""
                );
            } else {
                setMcpUrl("");
                setMcpCredentialUuid("");
                setMcpToolsFilter("");
            }
        } else {
            // Populate HTTP API specific fields
            const config = tool.definition?.config as HttpApiToolDefinition["config"] | undefined;
            if (config) {
                setHttpMethod((config.method as HttpMethod) || "POST");
                setUrl(config.url || "");
                setCredentialUuid(config.credential_uuid || "");
                setTimeoutMs(config.timeout_ms || 5000);
                setCustomMessage(config.customMessage || "");
                setCustomMessageType(config.customMessageType || "text");
                setCustomMessageRecordingId(config.customMessageRecordingId || "");

                // Convert headers object to array
                if (config.headers) {
                    setHeaders(
                        Object.entries(config.headers).map(([key, value]) => ({
                            key,
                            value: value as string,
                        }))
                    );
                } else {
                    setHeaders([]);
                }

                // Load parameters
                if (config.parameters && Array.isArray(config.parameters)) {
                    setParameters(
                        config.parameters.map((p) => ({
                            name: p.name || "",
                            type: normalizeParameterType(p.type),
                            description: p.description || "",
                            required: p.required ?? true,
                        }))
                    );
                } else {
                    setParameters([]);
                }

                if (config.preset_parameters && Array.isArray(config.preset_parameters)) {
                    setPresetParameters(
                        config.preset_parameters.map((p) => ({
                            name: p.name || "",
                            type: normalizeParameterType(p.type),
                            valueTemplate: p.value_template || "",
                            required: p.required ?? true,
                        }))
                    );
                } else {
                    setPresetParameters([]);
                }
            }
        }
    };

    const fetchRecordings = useCallback(async () => {
        if (loading || !user) return;
        try {
            const response = await listRecordingsApiV1WorkflowRecordingsGet({
                query: {},
            });
            if (response.data) {
                setRecordings(response.data.recordings);
            }
        } catch {
            // Non-critical — dropdowns will show "No recordings available"
        }
    }, [loading, user]);

    useEffect(() => {
        fetchTool();
        fetchRecordings();
    }, [fetchTool, fetchRecordings]);

    const handleSave = async () => {
        if (!tool) return;

        // Validation based on tool type
        if (tool.category === "calculator") {
            // No validation needed for built-in tools
        } else if (tool.category === "transfer_call") {
            // Validate destination for Transfer Call tools (supports both E.164 and SIP endpoints)
            const e164Pattern = /^\+[1-9]\d{1,14}$/;
            const sipPattern = /^(PJSIP|SIP)\/[\w\-\.@]+$/i;
            const isValidE164 = e164Pattern.test(transferDestination);
            const isValidSip = sipPattern.test(transferDestination);

            if (!transferDestination || (!isValidE164 && !isValidSip)) {
                setError("Please enter a valid phone number (E.164 format) or SIP endpoint (e.g., PJSIP/1234)");
                return;
            }
        } else if (tool.category === "mcp") {
            // Validate MCP server URL (must be http(s))
            if (!mcpUrl.trim()) {
                setError("Please enter the MCP server URL");
                return;
            }
            if (!MCP_URL_PATTERN.test(mcpUrl.trim())) {
                setError("MCP server URL must start with http:// or https://");
                return;
            }
        } else if (tool.category !== "end_call") {
            // Validate URL for HTTP API tools
            const urlValidation = validateUrl(url);
            if (!urlValidation.valid) {
                setError(urlValidation.error || "Invalid URL");
                return;
            }

            // Validate parameters have names
            const invalidParams = parameters.filter((p) => !p.name.trim());
            if (invalidParams.length > 0) {
                setError("All parameters must have a name");
                return;
            }

            const invalidPresetParams = presetParameters.filter(
                (p) => !p.name.trim() || !p.valueTemplate.trim()
            );
            if (invalidPresetParams.length > 0) {
                setError("All preset parameters must have a name and a value");
                return;
            }
        }

        try {
            setIsSaving(true);
            setError(null);
            setSaveSuccess(false);
            const accessToken = await getAccessToken();

            let requestBody: UpdateToolRequest;

            if (tool.category === "calculator") {
                // Built-in tool - only name/description, no config
                requestBody = {
                    name,
                    description: description || undefined,
                    definition: {
                        schema_version: 1,
                        type: "calculator",
                    },
                };
            } else if (tool.category === "end_call") {
                // Build end call request body
                requestBody = {
                    name,
                    description: description || undefined,
                    definition: {
                        schema_version: 1,
                        type: "end_call",
                        config: {
                            messageType: endCallMessageType,
                            customMessage: endCallMessageType === "custom" ? customMessage : undefined,
                            audioRecordingId: endCallMessageType === "audio" ? audioRecordingId || undefined : undefined,
                            endCallReason,
                            endCallReasonDescription: endCallReason ? endCallReasonDescription || undefined : undefined,
                        },
                    },
                };
            } else if (tool.category === "transfer_call") {
                // Build transfer call request body
                requestBody = {
                    name,
                    description: description || undefined,
                    definition: {
                        schema_version: 1,
                        type: "transfer_call",
                        config: {
                            destination: transferDestination,
                            messageType: transferMessageType,
                            customMessage: transferMessageType === "custom" ? customMessage : undefined,
                            audioRecordingId: transferMessageType === "audio" ? transferAudioRecordingId || undefined : undefined,
                            timeout: transferTimeout,
                        },
                    },
                };
            } else if (tool.category === "mcp") {
                requestBody = {
                    name,
                    description: description || undefined,
                    definition: createMcpDefinition(mcpUrl, mcpCredentialUuid, mcpToolsFilter),
                };
            } else {
                // Build HTTP API request body
                const headersObject: Record<string, string> = {};
                headers.filter((h) => h.key && h.value).forEach((h) => {
                    headersObject[h.key] = h.value;
                });

                const validParameters = parameters.filter((p) => p.name.trim());
                const validPresetParameters = presetParameters.filter(
                    (p) => p.name.trim() && p.valueTemplate.trim()
                );

                requestBody = {
                    name,
                    description: description || undefined,
                    definition: {
                        schema_version: 1,
                        type: "http_api",
                        config: {
                            method: httpMethod,
                            url,
                            credential_uuid: credentialUuid || undefined,
                            headers:
                                Object.keys(headersObject).length > 0
                                    ? headersObject
                                    : undefined,
                            parameters:
                                validParameters.length > 0 ? validParameters : undefined,
                            preset_parameters:
                                validPresetParameters.length > 0
                                    ? validPresetParameters.map((p) => ({
                                        name: p.name,
                                        type: p.type,
                                        value_template: p.valueTemplate,
                                        required: p.required,
                                    }))
                                    : undefined,
                            timeout_ms: timeoutMs,
                            customMessage: customMessageType === 'text' ? (customMessage || undefined) : undefined,
                            customMessageType,
                            customMessageRecordingId: customMessageType === 'audio' ? (customMessageRecordingId || undefined) : undefined,
                        },
                    },
                };
            }

            const response = await updateToolApiV1ToolsToolUuidPut({
                path: { tool_uuid: toolUuid },
                body: requestBody,
                headers: {
                    Authorization: `Bearer ${accessToken}`,
                },
            });

            if (response.error) {
                setError(detailFromError(response.error, "Failed to save tool"));
                return;
            }

            if (response.data) {
                setTool(response.data);
                setSaveSuccess(true);
                setTimeout(() => setSaveSuccess(false), 3000);
            }
        } catch (err) {
            setError("Failed to save tool");
            console.error("Error saving tool:", err);
        } finally {
            setIsSaving(false);
        }
    };

    const getCodeSnippet = () => {
        if (!tool) return "";

        const headersObj: Record<string, string> = {
            "Content-Type": "application/json",
        };
        headers.filter((h) => h.key && h.value).forEach((h) => {
            headersObj[h.key] = h.value;
        });

        // Build example body from parameters
        const exampleBody: Record<string, unknown> = {};
        parameters.forEach((p) => {
            if (p.type === "number") {
                exampleBody[p.name] = 0;
            } else if (p.type === "boolean") {
                exampleBody[p.name] = true;
            } else {
                exampleBody[p.name] = `<${p.name}>`;
            }
        });
        presetParameters.forEach((p) => {
            if (p.type === "number") {
                exampleBody[p.name] = p.valueTemplate || 0;
            } else if (p.type === "boolean") {
                exampleBody[p.name] = p.valueTemplate || true;
            } else {
                exampleBody[p.name] = p.valueTemplate || `<${p.name}>`;
            }
        });

        const hasBody =
            httpMethod !== "GET" &&
            httpMethod !== "DELETE" &&
            (parameters.length > 0 || presetParameters.length > 0);

        return `// ${tool.name}
// ${tool.description || "HTTP API Tool"}

const response = await fetch("${url}", {
    method: "${httpMethod}",
    headers: ${JSON.stringify(headersObj, null, 4)},${hasBody ? `
    body: JSON.stringify(${JSON.stringify(exampleBody, null, 4)}),` : ""}
});

const data = await response.json();`;
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

    if (isLoading) {
        return (
            <div className="min-h-screen bg-background">
                <div className="container mx-auto px-4 py-8">
                    <div className="max-w-4xl mx-auto space-y-6">
                        <Skeleton className="h-8 w-48" />
                        <Skeleton className="h-64 w-full" />
                    </div>
                </div>
            </div>
        );
    }

    if (!tool) {
        return (
            <div className="min-h-screen bg-background">
                <div className="container mx-auto px-4 py-8">
                    <div className="max-w-4xl mx-auto text-center">
                        <h1 className="text-2xl font-bold mb-4">Tool not found</h1>
                        <Button onClick={() => router.push("/tools")}>
                            <ArrowLeft className="w-4 h-4 mr-2" />
                            Back to Tools
                        </Button>
                    </div>
                </div>
            </div>
        );
    }

    const isEndCallTool = tool.category === "end_call";
    const isTransferCallTool = tool.category === "transfer_call";
    const isBuiltinTool = tool.category === "calculator";
    const isMcpTool = tool.category === "mcp";
    const categoryConfig = getCategoryConfig(tool.category as ToolCategory);

    return (
        <div className="min-h-screen bg-[#08080a] p-6 max-w-[1600px] mx-auto w-full page-enter">
            <div className="max-w-4xl mx-auto">
                {/* Header */}
                <div className="border-b border-[#1d1d22]/50 pb-6 mb-6">
                    <div className="flex items-center justify-between">
                        <div className="flex items-center gap-4">
                            <Button
                                variant="ghost"
                                onClick={() => router.push("/tools")}
                                className="bg-[#121214] border border-[#232328] hover:bg-[#1a1a1f] p-2.5 rounded-xl text-xs text-zinc-300 transition-colors"
                            >
                                <ArrowLeft className="w-4 h-4" />
                            </Button>
                            <div className="flex items-center gap-3">
                                <div
                                    className="w-10 h-10 rounded-xl flex items-center justify-center border border-zinc-700/30"
                                    style={{
                                        backgroundColor: tool.icon_color || categoryConfig?.iconColor || "#3B82F6",
                                    }}
                                >
                                    {renderToolIcon(tool.category)}
                                </div>
                                <div>
                                    <h1 className="text-xl font-bold text-white tracking-tight">{name}</h1>
                                    <p className="text-xs text-zinc-500 mt-0.5">
                                        {getToolTypeLabel(tool.category)}
                                    </p>
                                </div>
                            </div>
                        </div>
                        <div className="flex items-center gap-2">
                            {!isEndCallTool && !isTransferCallTool && !isBuiltinTool && !isMcpTool && (
                                <Button
                                    onClick={() => setShowCodeDialog(true)}
                                    className="bg-[#121214] border border-[#232328] hover:bg-[#1a1a1f] px-3.5 py-2 rounded-xl text-xs text-zinc-300 font-medium transition-colors"
                                >
                                    <Code className="w-4 h-4 mr-2 inline" />
                                    View Code
                                </Button>
                            )}
                            {TOOL_DOCUMENTATION_URLS[tool.category] && (
                                <a
                                    href={TOOL_DOCUMENTATION_URLS[tool.category]}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="flex items-center gap-1.5 text-xs text-zinc-500 hover:text-zinc-300 transition-colors"
                                >
                                    Docs
                                    <ExternalLink className="h-3.5 w-3.5" />
                                </a>
                            )}
                        </div>
                    </div>
                </div>

                {isBuiltinTool ? (
                    <BuiltinToolConfig
                        name={name}
                        onNameChange={setName}
                        description={description}
                        onDescriptionChange={setDescription}
                        title="Calculator Configuration"
                        subtitle="Built-in calculator for arithmetic operations. No additional configuration needed."
                    />
                ) : isEndCallTool ? (
                    <EndCallToolConfig
                        name={name}
                        onNameChange={setName}
                        description={description}
                        onDescriptionChange={setDescription}
                        messageType={endCallMessageType}
                        onMessageTypeChange={setEndCallMessageType}
                        customMessage={customMessage}
                        onCustomMessageChange={setCustomMessage}
                        audioRecordingId={audioRecordingId}
                        onAudioRecordingIdChange={setAudioRecordingId}
                        recordings={recordings}
                        endCallReason={endCallReason}
                        onEndCallReasonChange={handleEndCallReasonChange}
                        endCallReasonDescription={endCallReasonDescription}
                        onEndCallReasonDescriptionChange={setEndCallReasonDescription}
                    />
                ) : isTransferCallTool ? (
                    <TransferCallToolConfig
                        name={name}
                        onNameChange={setName}
                        description={description}
                        onDescriptionChange={setDescription}
                        destination={transferDestination}
                        onDestinationChange={setTransferDestination}
                        messageType={transferMessageType}
                        onMessageTypeChange={setTransferMessageType}
                        customMessage={customMessage}
                        onCustomMessageChange={setCustomMessage}
                        audioRecordingId={transferAudioRecordingId}
                        onAudioRecordingIdChange={setTransferAudioRecordingId}
                        recordings={recordings}
                        timeout={transferTimeout}
                        onTimeoutChange={setTransferTimeout}
                    />
                ) : isMcpTool ? (
                    <Card className="bg-[#111113] border border-[#1d1d22] rounded-2xl p-6 shadow-none">
                        <CardHeader className="p-0 pb-6 mb-6 border-b border-[#1d1d22]/50">
                            <CardTitle className="text-lg font-bold text-white">MCP Server Configuration</CardTitle>
                            <CardDescription className="text-xs text-zinc-500">
                                Configure the MCP server endpoint. Its tools become available to the agent.
                            </CardDescription>
                        </CardHeader>
                        <CardContent className="p-0 space-y-6">
                            <div className="space-y-1">
                                <Label htmlFor="mcp-name" className="text-xs font-bold text-zinc-300 block mb-1.5">Tool Name</Label>
                                <Input
                                    id="mcp-name"
                                    value={name}
                                    onChange={(e) => setName(e.target.value)}
                                    placeholder="e.g., Customer MCP Server"
                                    className="bg-[#08080a] border border-[#1d1d22] rounded-xl py-2.5 px-4 text-xs text-white focus:outline-none focus:border-zinc-700 focus:ring-1 focus:ring-zinc-700 transition-all"
                                />
                            </div>

                            <div className="space-y-1">
                                <Label htmlFor="mcp-description" className="text-xs font-bold text-zinc-300 block">Description</Label>
                                <span className="text-[10px] text-zinc-500 mb-1.5 block leading-snug">
                                    Provide a description which makes it easy for LLM to understand what this tool does
                                </span>
                                <Textarea
                                    id="mcp-description"
                                    value={description}
                                    onChange={(e) => setDescription(e.target.value)}
                                    placeholder="What does this MCP server provide?"
                                    rows={3}
                                    className="bg-[#08080a] border border-[#1d1d22] rounded-xl py-2.5 px-4 text-xs text-white focus:outline-none focus:border-zinc-700 focus:ring-1 focus:ring-zinc-700 transition-all"
                                />
                            </div>

                            <div className="space-y-1">
                                <Label htmlFor="mcp-url" className="text-xs font-bold text-zinc-300 block mb-1.5">MCP Server URL</Label>
                                <Input
                                    id="mcp-url"
                                    value={mcpUrl}
                                    onChange={(e) => setMcpUrl(e.target.value)}
                                    placeholder="https://your-mcp-server.example.com/mcp"
                                    className="bg-[#08080a] border border-[#1d1d22] rounded-xl py-2.5 px-4 text-xs text-white focus:outline-none focus:border-zinc-700 focus:ring-1 focus:ring-zinc-700 transition-all"
                                />
                            </div>

                            <div className="space-y-1">
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

                            <div className="space-y-1">
                                <Label htmlFor="mcp-tools-filter" className="text-xs font-bold text-zinc-300 block mb-1.5">Tools Filter (Optional)</Label>
                                <Input
                                    id="mcp-tools-filter"
                                    value={mcpToolsFilter}
                                    onChange={(e) => setMcpToolsFilter(e.target.value)}
                                    placeholder="e.g., tool_one, tool_two"
                                    className="bg-[#08080a] border border-[#1d1d22] rounded-xl py-2.5 px-4 text-xs text-white focus:outline-none focus:border-zinc-700 focus:ring-1 focus:ring-zinc-700 transition-all"
                                />
                                <p className="text-[10px] text-zinc-500 mt-1 leading-snug">
                                    Comma-separated list of tool names to allow. Leave empty to expose all tools from the server.
                                </p>
                            </div>
                        </CardContent>
                    </Card>
                ) : (
                    <HttpApiToolConfig
                        name={name}
                        onNameChange={setName}
                        description={description}
                        onDescriptionChange={setDescription}
                        httpMethod={httpMethod}
                        onHttpMethodChange={setHttpMethod}
                        url={url}
                        onUrlChange={setUrl}
                        credentialUuid={credentialUuid}
                        onCredentialUuidChange={setCredentialUuid}
                        headers={headers}
                        onHeadersChange={setHeaders}
                        parameters={parameters}
                        onParametersChange={setParameters}
                        presetParameters={presetParameters}
                        onPresetParametersChange={setPresetParameters}
                        timeoutMs={timeoutMs}
                        onTimeoutMsChange={setTimeoutMs}
                        customMessage={customMessage}
                        onCustomMessageChange={setCustomMessage}
                        customMessageType={customMessageType}
                        onCustomMessageTypeChange={setCustomMessageType}
                        customMessageRecordingId={customMessageRecordingId}
                        onCustomMessageRecordingIdChange={setCustomMessageRecordingId}
                        recordings={recordings}
                    />
                )}

                {error && (
                    <div className="mt-4 p-4 bg-destructive/10 border border-destructive/20 rounded-xl text-red-400 text-xs font-semibold">
                        {error}
                    </div>
                )}

                {saveSuccess && (
                    <div className="mt-4 p-4 bg-green-500/10 border border-green-500/20 rounded-xl text-green-400 text-xs font-semibold">
                        Tool saved successfully!
                    </div>
                )}

                <div className="flex justify-end mt-6">
                    <Button
                        onClick={handleSave}
                        disabled={isSaving}
                        className="bg-[#7c3aed] hover:bg-[#8b5cf6] text-white font-bold text-xs px-5 py-2.5 rounded-xl transition-all shadow-lg cursor-pointer"
                    >
                        {isSaving ? (
                            <>
                                <Loader2 className="w-4 h-4 mr-2 animate-spin inline" />
                                Saving...
                            </>
                        ) : (
                            <>
                                <Save className="w-4 h-4 mr-2 inline" />
                                Save
                            </>
                        )}
                    </Button>
                </div>
            </div>

            {/* Code View Dialog (only for HTTP API tools) */}
            <Dialog open={showCodeDialog} onOpenChange={setShowCodeDialog}>
                <DialogContent className="bg-[#111113] border border-[#2c2c35] rounded-2xl w-full max-w-2xl p-6 shadow-2xl space-y-6 text-white">
                    <DialogHeader className="space-y-1">
                        <DialogTitle className="text-lg font-bold text-white">Code Preview</DialogTitle>
                        <DialogDescription className="text-xs text-zinc-500 leading-relaxed">
                            JavaScript code to make this API call
                        </DialogDescription>
                    </DialogHeader>
                    <div className="bg-[#08080a] border border-[#1d1d22] rounded-xl p-4 font-mono text-xs overflow-auto max-h-96 text-zinc-300">
                        <pre>{getCodeSnippet()}</pre>
                    </div>
                </DialogContent>
            </Dialog>
        </div>
    );
}
