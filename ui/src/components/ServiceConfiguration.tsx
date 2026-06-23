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
                <p className="text-xs text-muted-foreground mb-5">
                    Configure AI model, voice, and transcription services.{" "}
                    <a href={docsUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-0.5 text-primary hover:underline">
                        Learn more <ExternalLink className="h-3 w-3" />
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
