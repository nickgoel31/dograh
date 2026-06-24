"use client";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

export interface BuiltinToolConfigProps {
    name: string;
    onNameChange: (name: string) => void;
    description: string;
    onDescriptionChange: (description: string) => void;
    title: string;
    subtitle: string;
}

export function BuiltinToolConfig({
    name,
    onNameChange,
    description,
    onDescriptionChange,
    title,
    subtitle,
}: BuiltinToolConfigProps) {
    return (
        <Card className="bg-[#111113] border border-[#1d1d22] rounded-2xl p-6 shadow-none">
            <CardHeader className="p-0 pb-6 mb-6 border-b border-[#1d1d22]/50">
                <CardTitle className="text-lg font-bold text-white">{title}</CardTitle>
                <CardDescription className="text-xs text-zinc-500">{subtitle}</CardDescription>
            </CardHeader>
            <CardContent className="p-0 space-y-6">
                {/* Tool Name */}
                <div className="space-y-1">
                    <Label htmlFor="tool-name" className="text-xs font-bold text-zinc-300 block mb-1.5">Tool Name</Label>
                    <Input
                        id="tool-name"
                        value={name}
                        onChange={(e) => onNameChange(e.target.value)}
                        placeholder="Tool name"
                        className="bg-[#08080a] border border-[#1d1d22] rounded-xl py-2.5 px-4 text-xs text-white focus:outline-none focus:border-zinc-700 focus:ring-1 focus:ring-zinc-700 transition-all"
                    />
                </div>

                {/* Tool Description */}
                <div className="space-y-1">
                    <Label htmlFor="tool-description" className="text-xs font-bold text-zinc-300 block mb-1.5">Description</Label>
                    <p className="text-[10px] text-zinc-500 mt-1 leading-snug">
                        Provide a description which makes it easy for LLM to understand what this tool does
                    </p>
                    <Textarea
                        id="tool-description"
                        value={description}
                        onChange={(e) => onDescriptionChange(e.target.value)}
                        placeholder="Describe what this tool does..."
                        rows={3}
                        className="bg-[#08080a] border border-[#1d1d22] rounded-xl py-2.5 px-4 text-xs text-white focus:outline-none focus:border-zinc-700 focus:ring-1 focus:ring-zinc-700 transition-all mt-1.5"
                    />
                </div>
            </CardContent>
        </Card>
    );
}
