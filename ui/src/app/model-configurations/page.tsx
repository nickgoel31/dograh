import ServiceConfiguration from "@/components/ServiceConfiguration";
import { SETTINGS_DOCUMENTATION_URLS } from "@/constants/documentation";
import { ClientAccessGuard } from "@/components/layout/ClientAccessGuard";

export default function ServiceConfigurationPage() {
    return (
        <ClientAccessGuard featureName="Model Configurations">
            <div className="w-full min-h-full page-enter">
                <ServiceConfiguration docsUrl={SETTINGS_DOCUMENTATION_URLS.modelOverrides} />
            </div>
        </ClientAccessGuard>
    );
}

