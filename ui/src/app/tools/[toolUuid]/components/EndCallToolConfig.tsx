"use client";

import type { RecordingResponseSchema } from "@/client/types.gen";
import { RecordingSelect, StaticTextWarning } from "@/components/flow/TextOrAudioInput";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";

import { type EndCallMessageType } from "../../config";

export interface EndCallToolConfigProps {
    name: string;
    onNameChange: (name: string) => void;
    description: string;
    onDescriptionChange: (description: string) => void;
    messageType: EndCallMessageType;
    onMessageTypeChange: (messageType: EndCallMessageType) => void;
    customMessage: string;
    onCustomMessageChange: (message: string) => void;
    audioRecordingId: string;
    onAudioRecordingIdChange: (id: string) => void;
    recordings?: RecordingResponseSchema[];
    endCallReason: boolean;
    onEndCallReasonChange: (enabled: boolean) => void;
    endCallReasonDescription: string;
    onEndCallReasonDescriptionChange: (description: string) => void;
}

export function EndCallToolConfig({
    name,
    onNameChange,
    description,
    onDescriptionChange,
    messageType,
    onMessageTypeChange,
    customMessage,
    onCustomMessageChange,
    audioRecordingId,
    onAudioRecordingIdChange,
    recordings = [],
    endCallReason,
    onEndCallReasonChange,
    endCallReasonDescription,
    onEndCallReasonDescriptionChange,
}: EndCallToolConfigProps) {
    return (
        <Card className="bg-[#111113] border border-[#1d1d22] rounded-2xl p-6 shadow-none">
            <CardHeader className="p-0 pb-6 mb-6 border-b border-[#1d1d22]/50">
                <CardTitle className="text-lg font-bold text-white">End Call Configuration</CardTitle>
                <CardDescription className="text-xs text-zinc-500">
                    Configure the behavior when the call ends
                </CardDescription>
            </CardHeader>
            <CardContent className="p-0 space-y-6">
                <div className="grid gap-1">
                    <Label className="text-xs font-bold text-zinc-300 block mb-1.5">Tool Name</Label>
                    <Input
                        value={name}
                        onChange={(e) => onNameChange(e.target.value)}
                        placeholder="e.g., End Call"
                        className="bg-[#08080a] border border-[#1d1d22] rounded-xl py-2.5 px-4 text-xs text-white focus:outline-none focus:border-zinc-700 focus:ring-1 focus:ring-zinc-700 transition-all"
                    />
                </div>

                <div className="grid gap-1">
                    <Label className="text-xs font-bold text-zinc-300 block">Description</Label>
                    <span className="text-[10px] text-zinc-500 mb-1.5 block leading-snug">
                        Helps the LLM understand when to use this tool
                    </span>
                    <Textarea
                        value={description}
                        onChange={(e) => onDescriptionChange(e.target.value)}
                        placeholder="When should the AI end the call?"
                        rows={3}
                        className="bg-[#08080a] border border-[#1d1d22] rounded-xl py-2.5 px-4 text-xs text-white focus:outline-none focus:border-zinc-700 focus:ring-1 focus:ring-zinc-700 transition-all mt-1"
                    />
                </div>

                <div className="grid gap-2 pt-6 border-t border-[#1d1d22]/50">
                    <div className="flex items-center space-x-3">
                        <Switch
                            id="end-call-reason"
                            checked={endCallReason}
                            onCheckedChange={onEndCallReasonChange}
                            className="data-[state=checked]:bg-[#7c3aed]"
                        />
                        <Label htmlFor="end-call-reason" className="text-xs font-bold text-zinc-200 cursor-pointer">Capture End Call Reason</Label>
                    </div>
                    <Label className="text-[10px] text-zinc-500 leading-snug mt-1">
                        When enabled, the AI will provide a reason for ending the call.
                        The reason will be set as the call disposition and added to call tags for analytics.
                    </Label>
                    {endCallReason && (
                        <div className="grid gap-1 pt-2">
                            <Label className="text-xs font-bold text-zinc-300 block mb-1.5">Reason Description</Label>
                            <Textarea
                                value={endCallReasonDescription}
                                onChange={(e) => onEndCallReasonDescriptionChange(e.target.value)}
                                placeholder="e.g., The reason for ending the call (e.g., 'voicemail_detected', 'issue_resolved', 'customer_requested')"
                                rows={2}
                                className="bg-[#08080a] border border-[#1d1d22] rounded-xl py-2.5 px-4 text-xs text-white focus:outline-none focus:border-zinc-700 focus:ring-1 focus:ring-zinc-700 transition-all"
                            />
                        </div>
                    )}
                </div>

                <div className="grid gap-2 pt-6 border-t border-[#1d1d22]/50">
                    <Label className="text-xs font-bold text-zinc-300 block mb-1.5">Goodbye Message</Label>
                    <RadioGroup
                        value={messageType}
                        onValueChange={(v) => onMessageTypeChange(v as EndCallMessageType)}
                        className="space-y-3"
                    >
                        <label
                            htmlFor="none"
                            className="flex items-start space-x-3 p-4 bg-[#08080a] border border-[#1d1d22] rounded-xl hover:border-zinc-700/80 transition-all cursor-pointer"
                        >
                            <RadioGroupItem value="none" id="none" className="mt-1 border-[#232328] text-[#7c3aed]" />
                            <div className="flex-1">
                                <span className="text-xs font-bold text-zinc-200 block">No Message</span>
                                <p className="text-[10px] text-zinc-500 mt-1 leading-snug">
                                    End the call immediately without any message
                                </p>
                            </div>
                        </label>
                        <div className="flex items-start space-x-3 p-4 bg-[#08080a] border border-[#1d1d22] rounded-xl hover:border-zinc-700/80 transition-all">
                            <RadioGroupItem value="custom" id="custom" className="mt-1 border-[#232328] text-[#7c3aed]" />
                            <label htmlFor="custom" className="flex-1 space-y-2 cursor-pointer">
                                <span className="text-xs font-bold text-zinc-200 block">Custom Message</span>
                                <p className="text-[10px] text-zinc-500 mt-1 leading-snug">
                                    Play a custom message before disconnecting
                                </p>
                            </label>
                        </div>
                        {messageType === "custom" && (
                            <div className="pl-8 space-y-2">
                                <StaticTextWarning />
                                <Textarea
                                    value={customMessage}
                                    onChange={(e) => onCustomMessageChange(e.target.value)}
                                    placeholder="e.g., Thank you for calling. Goodbye!"
                                    rows={2}
                                    className="bg-[#08080a] border border-[#1d1d22] rounded-xl py-2.5 px-4 text-xs text-white focus:outline-none focus:border-zinc-700 focus:ring-1 focus:ring-zinc-700 transition-all"
                                />
                            </div>
                        )}
                        <div className="flex items-start space-x-3 p-4 bg-[#08080a] border border-[#1d1d22] rounded-xl hover:border-zinc-700/80 transition-all">
                            <RadioGroupItem value="audio" id="audio" className="mt-1 border-[#232328] text-[#7c3aed]" />
                            <label htmlFor="audio" className="flex-1 space-y-2 cursor-pointer">
                                <span className="text-xs font-bold text-zinc-200 block">Pre-recorded Audio</span>
                                <p className="text-[10px] text-zinc-500 mt-1 leading-snug">
                                    Play a pre-recorded audio file before disconnecting
                                </p>
                            </label>
                        </div>
                        {messageType === "audio" && (
                            <div className="pl-8">
                                <RecordingSelect
                                    value={audioRecordingId}
                                    onChange={onAudioRecordingIdChange}
                                    recordings={recordings}
                                />
                            </div>
                        )}
                    </RadioGroup>
                </div>
            </CardContent>
        </Card>
    );
}
