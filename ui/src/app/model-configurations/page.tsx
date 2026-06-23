
import ServiceConfiguration from "@/components/ServiceConfiguration";
import { SETTINGS_DOCUMENTATION_URLS } from "@/constants/documentation";

export default function ServiceConfigurationPage() {
    return (
        <div className="min-h-screen page-enter">
            <div className="px-6 py-6 border-b border-border/50">
                <h1 className="text-2xl font-bold tracking-tight">Models</h1>
                <p className="text-sm text-muted-foreground mt-0.5">Configure AI, voice, and transcription service providers</p>
            </div>
            <div className="px-6 py-6">
                <div className="max-w-2xl">
                    <ServiceConfiguration docsUrl={SETTINGS_DOCUMENTATION_URLS.modelOverrides} />
                </div>
            </div>
        </div>
    );
}
