"use client";

import { ExternalLink } from "lucide-react";

import { ServiceConfigurationForm } from "@/components/ServiceConfigurationForm";
import { useUserConfig } from "@/context/UserConfigContext";

interface ServiceConfigurationProps {
    docsUrl?: string;
}

export default function ServiceConfiguration({ docsUrl }: ServiceConfigurationProps) {
    const { saveUserConfig } = useUserConfig();

    return (
        <div className="w-full">
            {docsUrl && (
                <p className="text-xs text-[#a1a1aa] mb-5 leading-relaxed">
                    Configure AI model, voice, and transcription services.{" "}
                    <a href={docsUrl} target="_blank" rel="noopener noreferrer" className="text-blue-400 hover:underline inline-flex items-center gap-0.5">
                        Learn more <ExternalLink className="w-3 h-3 inline" />
                    </a>
                </p>
            )}

            <ServiceConfigurationForm
                mode="global"
                onSave={async (config) => {
                    await saveUserConfig(config);
                }}
            />
        </div>
    );
}
