
import ServiceConfiguration from "@/components/ServiceConfiguration";
import { SETTINGS_DOCUMENTATION_URLS } from "@/constants/documentation";

export default function ServiceConfigurationPage() {
    return (
        <div className="min-h-screen bg-[#08080a] p-6 max-w-[1600px] mx-auto w-full page-enter">
            <div className="border-b border-[#1d1d22]/50 pb-6 mb-6">
                <h1 className="text-2xl font-bold tracking-tight text-white">Models</h1>
                <p className="text-xs text-zinc-500 mt-1">Configure AI, voice, and transcription service providers</p>
            </div>
            <div className="max-w-2xl">
                <ServiceConfiguration docsUrl={SETTINGS_DOCUMENTATION_URLS.modelOverrides} />
            </div>
        </div>
    );
}
