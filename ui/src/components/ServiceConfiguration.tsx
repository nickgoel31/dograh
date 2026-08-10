"use client";

import { ServiceConfigurationForm } from "@/components/ServiceConfigurationForm";
import { useUserConfig } from "@/context/UserConfigContext";

interface ServiceConfigurationProps {
    docsUrl?: string;
}

export default function ServiceConfiguration({ docsUrl }: ServiceConfigurationProps) {
    const { saveUserConfig } = useUserConfig();

    return (
        <div className="w-full">
            <ServiceConfigurationForm
                mode="global"
                docsUrl={docsUrl}
                onSave={async (config) => {
                    await saveUserConfig(config);
                }}
            />
        </div>
    );
}
