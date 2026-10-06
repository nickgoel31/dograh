import ServiceConfiguration from "@/components/ServiceConfiguration";
import { SETTINGS_DOCUMENTATION_URLS } from "@/constants/documentation";
import { ManagedModelsGate } from "@/components/layout/ManagedModelsGate";
import { ClientAccessGuard } from "@/components/layout/ClientAccessGuard";

export default function ServiceConfigurationPage() {
    return (
        <ClientAccessGuard featureName="Model Configurations">
            <div className="w-full min-h-full page-enter">
                <ManagedModelsGate>
                    <ServiceConfiguration docsUrl={SETTINGS_DOCUMENTATION_URLS.modelOverrides} />
                </ManagedModelsGate>
            </div>
        </ClientAccessGuard>
    );
}

