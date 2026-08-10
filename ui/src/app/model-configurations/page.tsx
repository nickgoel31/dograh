import ServiceConfiguration from "@/components/ServiceConfiguration";
import { SETTINGS_DOCUMENTATION_URLS } from "@/constants/documentation";

export default function ServiceConfigurationPage() {
    return (
        <div className="w-full min-h-full page-enter">
            <ServiceConfiguration docsUrl={SETTINGS_DOCUMENTATION_URLS.modelOverrides} />
        </div>
    );
}
