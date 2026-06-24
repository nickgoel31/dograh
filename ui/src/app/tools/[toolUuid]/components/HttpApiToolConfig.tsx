"use client";

import type { RecordingResponseSchema } from "@/client/types.gen";
import { StaticTextWarning, TextOrAudioInput } from "@/components/flow/TextOrAudioInput";
import {
    CredentialSelector,
    type HttpMethod,
    HttpMethodSelector,
    KeyValueEditor,
    type KeyValueItem,
    ParameterEditor,
    PresetParameterEditor,
    type PresetToolParameter,
    type ToolParameter,
    UrlInput,
} from "@/components/http";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";

export interface HttpApiToolConfigProps {
    name: string;
    onNameChange: (name: string) => void;
    description: string;
    onDescriptionChange: (description: string) => void;
    httpMethod: HttpMethod;
    onHttpMethodChange: (method: HttpMethod) => void;
    url: string;
    onUrlChange: (url: string) => void;
    credentialUuid: string;
    onCredentialUuidChange: (uuid: string) => void;
    headers: KeyValueItem[];
    onHeadersChange: (headers: KeyValueItem[]) => void;
    parameters: ToolParameter[];
    onParametersChange: (parameters: ToolParameter[]) => void;
    presetParameters: PresetToolParameter[];
    onPresetParametersChange: (parameters: PresetToolParameter[]) => void;
    timeoutMs: number;
    onTimeoutMsChange: (timeout: number) => void;
    customMessage: string;
    onCustomMessageChange: (message: string) => void;
    customMessageType: 'text' | 'audio';
    onCustomMessageTypeChange: (type: 'text' | 'audio') => void;
    customMessageRecordingId: string;
    onCustomMessageRecordingIdChange: (id: string) => void;
    recordings?: RecordingResponseSchema[];
}

export function HttpApiToolConfig({
    name,
    onNameChange,
    description,
    onDescriptionChange,
    httpMethod,
    onHttpMethodChange,
    url,
    onUrlChange,
    credentialUuid,
    onCredentialUuidChange,
    headers,
    onHeadersChange,
    parameters,
    onParametersChange,
    presetParameters,
    onPresetParametersChange,
    timeoutMs,
    onTimeoutMsChange,
    customMessage,
    onCustomMessageChange,
    customMessageType,
    onCustomMessageTypeChange,
    customMessageRecordingId,
    onCustomMessageRecordingIdChange,
    recordings = [],
}: HttpApiToolConfigProps) {
    return (
        <Card className="bg-[#111113] border border-[#1d1d22] rounded-2xl p-6 shadow-none">
            <CardHeader className="p-0 pb-6 mb-6 border-b border-[#1d1d22]/50">
                <CardTitle className="text-lg font-bold text-white">Tool Configuration</CardTitle>
                <CardDescription className="text-xs text-zinc-500">
                    Configure the HTTP API endpoint and request settings
                </CardDescription>
            </CardHeader>
            <CardContent className="p-0">
                <Tabs defaultValue="settings" className="w-full">
                    <TabsList className="bg-[#08080a] border border-[#1d1d22] p-1 rounded-xl w-full grid grid-cols-3">
                        <TabsTrigger value="settings" className="data-[state=active]:bg-[#111113] data-[state=active]:text-white text-zinc-400 rounded-lg text-xs py-2 transition-all">Settings</TabsTrigger>
                        <TabsTrigger value="auth" className="data-[state=active]:bg-[#111113] data-[state=active]:text-white text-zinc-400 rounded-lg text-xs py-2 transition-all">Authentication</TabsTrigger>
                        <TabsTrigger value="parameters" className="data-[state=active]:bg-[#111113] data-[state=active]:text-white text-zinc-400 rounded-lg text-xs py-2 transition-all">Parameters</TabsTrigger>
                    </TabsList>

                    <TabsContent value="settings" className="space-y-6 mt-6">
                        <div className="grid gap-1">
                            <Label className="text-xs font-bold text-zinc-300 block">Tool Name</Label>
                            <span className="text-[10px] text-zinc-500 mb-1.5 block leading-snug">
                                Use a descriptive name, like &quot;Get Weather using API&quot; for a tool that fetches weather
                            </span>
                            <Input
                                value={name}
                                onChange={(e) => onNameChange(e.target.value)}
                                placeholder="e.g., Book Appointment"
                                className="bg-[#08080a] border border-[#1d1d22] rounded-xl py-2.5 px-4 text-xs text-white focus:outline-none focus:border-zinc-700 focus:ring-1 focus:ring-zinc-700 transition-all"
                            />
                        </div>

                        <div className="grid gap-1">
                            <Label className="text-xs font-bold text-zinc-300 block">Description</Label>
                            <span className="text-[10px] text-zinc-500 mb-1.5 block leading-snug">
                                Provide a description which makes it easy for LLM to understand what this tool does
                            </span>
                            <Textarea
                                value={description}
                                onChange={(e) => onDescriptionChange(e.target.value)}
                                placeholder="What does this tool do?"
                                rows={3}
                                className="bg-[#08080a] border border-[#1d1d22] rounded-xl py-2.5 px-4 text-xs text-white focus:outline-none focus:border-zinc-700 focus:ring-1 focus:ring-zinc-700 transition-all mt-1"
                            />
                        </div>

                        <div className="grid grid-cols-2 gap-4">
                            <div className="grid gap-1">
                                <Label className="text-xs font-bold text-zinc-300 block mb-1.5">HTTP Method</Label>
                                <HttpMethodSelector
                                    value={httpMethod}
                                    onChange={onHttpMethodChange}
                                />
                            </div>
                            <div className="grid gap-1">
                                <Label className="text-xs font-bold text-zinc-300 block mb-1.5">Timeout (ms)</Label>
                                <Input
                                    type="number"
                                    value={timeoutMs}
                                    onChange={(e) =>
                                        onTimeoutMsChange(parseInt(e.target.value) || 5000)
                                    }
                                    min={1000}
                                    max={30000}
                                    className="bg-[#08080a] border border-[#1d1d22] rounded-xl py-2.5 px-4 text-xs text-white focus:outline-none focus:border-zinc-700 focus:ring-1 focus:ring-zinc-700 transition-all"
                                />
                            </div>
                        </div>

                        <div className="grid gap-1">
                            <Label className="text-xs font-bold text-zinc-300 block mb-1.5">Endpoint URL</Label>
                            <UrlInput
                                value={url}
                                onChange={onUrlChange}
                                placeholder="https://api.example.com/appointments"
                                showValidation
                            />
                        </div>

                        <div className="grid gap-1 pt-6 border-t border-[#1d1d22]/50">
                            <Label className="text-xs font-bold text-zinc-300 block">Custom Message</Label>
                            <span className="text-[10px] text-zinc-500 mb-1.5 block leading-snug">
                                Optional message the AI will speak or play before executing this tool.
                            </span>
                            <TextOrAudioInput
                                type={customMessageType}
                                onTypeChange={onCustomMessageTypeChange}
                                recordingId={customMessageRecordingId}
                                onRecordingIdChange={onCustomMessageRecordingIdChange}
                                recordings={recordings}
                            >
                                <>
                                    <StaticTextWarning />
                                    <Textarea
                                        value={customMessage}
                                        onChange={(e) => onCustomMessageChange(e.target.value)}
                                        placeholder="e.g., Let me check that for you, one moment please."
                                        rows={2}
                                        className="bg-[#08080a] border border-[#1d1d22] rounded-xl py-2.5 px-4 text-xs text-white focus:outline-none focus:border-zinc-700 focus:ring-1 focus:ring-zinc-700 transition-all"
                                    />
                                </>
                            </TextOrAudioInput>
                        </div>
                    </TabsContent>

                    <TabsContent value="auth" className="space-y-4 mt-6">
                        <CredentialSelector
                            value={credentialUuid}
                            onChange={onCredentialUuidChange}
                        />
                    </TabsContent>

                    <TabsContent value="parameters" className="space-y-6 mt-6">
                        <div className="grid gap-1">
                            <Label className="text-xs font-bold text-zinc-300 block">LLM Parameters</Label>
                            <span className="text-[10px] text-zinc-500 mb-1.5 block leading-snug">
                                Define the parameters that the LLM will provide when calling this tool.
                                These will be sent as JSON body for POST/PUT/PATCH or as URL query params for GET/DELETE.
                            </span>
                            <ParameterEditor
                                parameters={parameters}
                                onChange={onParametersChange}
                            />
                        </div>

                        <div className="grid gap-1 pt-6 border-t border-[#1d1d22]/50">
                            <Label className="text-xs font-bold text-zinc-300 block">Preset Parameters</Label>
                            <span className="text-[10px] text-zinc-500 mb-1.5 block leading-snug">
                                Add values that Dograh should inject at runtime. These are not exposed to the LLM and can use
                                workflow templates like {`{{initial_context.phone_number}}`} or fixed literals.
                            </span>
                            <PresetParameterEditor
                                parameters={presetParameters}
                                onChange={onPresetParametersChange}
                            />
                        </div>

                        <div className="grid gap-1 pt-6 border-t border-[#1d1d22]/50">
                            <Label className="text-xs font-bold text-zinc-300 block">Custom Headers</Label>
                            <span className="text-[10px] text-zinc-500 mb-1.5 block leading-snug">
                                Add custom headers to include in the request (optional)
                            </span>
                            <KeyValueEditor
                                items={headers}
                                onChange={onHeadersChange}
                                keyPlaceholder="Header name"
                                valuePlaceholder="Header value"
                                addButtonText="Add Header"
                            />
                        </div>
                    </TabsContent>
                </Tabs>
            </CardContent>
        </Card>
    );
}
