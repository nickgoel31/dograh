"use client";

import {useState } from "react";

import type { RecordingResponseSchema } from "@/client/types.gen";
import { RecordingSelect, StaticTextWarning } from "@/components/flow/TextOrAudioInput";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Textarea } from "@/components/ui/textarea";

import { type EndCallMessageType } from "../../config";

export interface TransferCallToolConfigProps {
    name: string;
    onNameChange: (name: string) => void;
    description: string;
    onDescriptionChange: (description: string) => void;
    destination: string;
    onDestinationChange: (destination: string) => void;
    messageType: EndCallMessageType;
    onMessageTypeChange: (messageType: EndCallMessageType) => void;
    customMessage: string;
    onCustomMessageChange: (message: string) => void;
    audioRecordingId: string;
    onAudioRecordingIdChange: (id: string) => void;
    recordings?: RecordingResponseSchema[];
    timeout?: number;  // Make optional to match API type
    onTimeoutChange: (timeout: number) => void;
}

export function TransferCallToolConfig({
    name,
    onNameChange,
    description,
    onDescriptionChange,
    destination,
    onDestinationChange,
    messageType,
    onMessageTypeChange,
    customMessage,
    onCustomMessageChange,
    audioRecordingId,
    onAudioRecordingIdChange,
    recordings = [],
    timeout,
    onTimeoutChange,
}: TransferCallToolConfigProps) {
    const [sipMode, setSipMode] = useState(() => /^(PJSIP|SIP)\//i.test(destination));

    // Validation patterns
    const isValidPhoneNumber = (phone: string): boolean => {
        const e164Pattern = /^\+[1-9]\d{1,14}$/;
        return e164Pattern.test(phone);
    };

    const isValidSipEndpoint = (endpoint: string): boolean => {
        const sipPattern = /^(PJSIP|SIP)\/[\w\-\.@]+$/i;
        return sipPattern.test(endpoint);
    };

    const getValidationError = (): string | null => {
        if (!destination) return null;

        if (sipMode) {
            return isValidSipEndpoint(destination)
                ? null
                : "Please enter a valid SIP endpoint (e.g., PJSIP/1234 or SIP/extension@domain.com)";
        } else {
            return isValidPhoneNumber(destination)
                ? null
                : "Please enter a valid phone number in E.164 format (e.g., +1234567890)";
        }
    };

    const destinationError = getValidationError();

    const handleSipModeToggle = () => {
        setSipMode(!sipMode);
        onDestinationChange(""); // Clear destination when switching modes
    };

    return (
        <Card className="bg-[#111113] border border-[#1d1d22] rounded-2xl p-6 shadow-none">
            <CardHeader className="p-0 pb-6 mb-6 border-b border-[#1d1d22]/50">
                <CardTitle className="text-lg font-bold text-white">Transfer Call Configuration</CardTitle>
                <CardDescription className="text-xs text-zinc-500">
                    Configure call transfer settings. Supports phone numbers (Twilio) and SIP endpoints (Asterisk ARI).
                </CardDescription>
            </CardHeader>
            <CardContent className="p-0 space-y-6">
                <div className="grid gap-1">
                    <Label className="text-xs font-bold text-zinc-300 block mb-1.5">Tool Name</Label>
                    <Input
                        value={name}
                        onChange={(e) => onNameChange(e.target.value)}
                        placeholder="e.g., Transfer Call"
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
                        placeholder="When should the AI transfer the call?"
                        rows={3}
                        className="bg-[#08080a] border border-[#1d1d22] rounded-xl py-2.5 px-4 text-xs text-white focus:outline-none focus:border-zinc-700 focus:ring-1 focus:ring-zinc-700 transition-all mt-1"
                    />
                </div>

                <div className="grid gap-1 pt-6 border-t border-[#1d1d22]/50">
                    <Label className="text-xs font-bold text-zinc-300 block">Transfer Destination</Label>
                    <span className="text-[10px] text-zinc-500 mb-1.5 block leading-snug">
                        {sipMode
                            ? "SIP endpoint to transfer the call to (e.g., PJSIP/1234 or SIP/extension@domain.com)"
                            : "Phone number to transfer the call to (E.164 format with country code)"
                        }
                    </span>
                    <Input
                        value={destination}
                        onChange={(e) => onDestinationChange(e.target.value)}
                        placeholder={sipMode ? "PJSIP/1234 or SIP/extension@domain.com" : "+1234567890"}
                        className={`bg-[#08080a] border border-[#1d1d22] rounded-xl py-2.5 px-4 text-xs text-white focus:outline-none focus:border-zinc-700 focus:ring-1 focus:ring-zinc-700 transition-all ${
                            destinationError ? "border-red-500 focus:border-red-500 focus:ring-red-500" : ""
                        }`}
                    />
                    {destinationError && (
                        <Label className="text-xs text-red-500 mt-1 block">
                            {destinationError}
                        </Label>
                    )}
                    <button
                        type="button"
                        className="text-[11px] text-purple-400 hover:text-purple-300 hover:underline w-fit mt-1.5 font-medium cursor-pointer"
                        onClick={handleSipModeToggle}
                    >
                        {sipMode ? "Use phone number instead" : "Use SIP endpoint instead"}
                    </button>
                </div>

                <div className="grid gap-2 pt-6 border-t border-[#1d1d22]/50">
                    <Label className="text-xs font-bold text-zinc-300 block mb-1.5">Pre-Transfer Message</Label>
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
                                    Transfer the call immediately without any message
                                </p>
                            </div>
                        </label>
                        <div className="flex items-start space-x-3 p-4 bg-[#08080a] border border-[#1d1d22] rounded-xl hover:border-zinc-700/80 transition-all">
                            <RadioGroupItem value="custom" id="custom" className="mt-1 border-[#232328] text-[#7c3aed]" />
                            <label htmlFor="custom" className="flex-1 space-y-2 cursor-pointer">
                                <span className="text-xs font-bold text-zinc-200 block">Custom Message</span>
                                <p className="text-[10px] text-zinc-500 mt-1 leading-snug">
                                    Play a custom message before transferring
                                </p>
                            </label>
                        </div>
                        {messageType === "custom" && (
                            <div className="pl-8 space-y-2">
                                <StaticTextWarning />
                                <Textarea
                                    value={customMessage}
                                    onChange={(e) => onCustomMessageChange(e.target.value)}
                                    placeholder="e.g., Please hold while I transfer your call."
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
                                    Play a pre-recorded audio file before transferring
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

                <div className="grid gap-1 pt-6 border-t border-[#1d1d22]/50">
                    <Label className="text-xs font-bold text-zinc-300 block">Transfer Timeout</Label>
                    <span className="text-[10px] text-zinc-500 mb-1.5 block leading-snug">
                        Maximum time to wait for destination to answer (5-120 seconds). Default: 30 seconds.
                    </span>
                    <Input
                        type="number"
                        value={timeout ?? 30}
                        onChange={(e) => {
                            const value = parseInt(e.target.value) || 30;
                            const clampedValue = Math.min(Math.max(value, 5), 120);
                            onTimeoutChange(clampedValue);
                        }}
                        placeholder="30"
                        min="5"
                        max="120"
                        className="bg-[#08080a] border border-[#1d1d22] rounded-xl py-2.5 px-4 text-xs text-white focus:outline-none focus:border-zinc-700 focus:ring-1 focus:ring-zinc-700 transition-all w-32"
                    />
                </div>
            </CardContent>
        </Card>
    );
}
