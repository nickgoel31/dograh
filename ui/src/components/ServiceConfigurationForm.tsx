"use client";

import { CheckCircle2, ExternalLink, Key, Plus, Save, Sparkles, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useForm } from "react-hook-form";

import { getDefaultConfigurationsApiV1UserConfigurationsDefaultsGet } from '@/client/sdk.gen';
import { VoiceSelector } from "@/components/VoiceSelector";
import { LANGUAGE_DISPLAY_NAMES } from "@/constants/languages";
import { useUserConfig } from "@/context/UserConfigContext";
import type { ModelOverrides } from "@/types/workflow-configurations";

type ServiceSegment = "llm" | "tts" | "stt" | "embeddings" | "realtime";

interface SchemaProperty {
    type?: string;
    default?: string | number | boolean;
    enum?: string[];
    examples?: string[];
    model_options?: Record<string, string[]>;
    allow_custom_input?: boolean;
    $ref?: string;
    description?: string;
    format?: string;
    multiline?: boolean;
    docs_url?: string;
}

interface ProviderSchema {
    title?: string;
    description?: string;
    provider_docs_url?: string;
    properties: Record<string, SchemaProperty>;
    required?: string[];
    $defs?: Record<string, SchemaProperty>;
    [key: string]: unknown;
}

interface FormValues {
    [key: string]: string | number | boolean;
}

const STANDARD_TABS: { key: ServiceSegment; label: string }[] = [
    { key: "llm", label: "LLM" },
    { key: "tts", label: "Voice" },
    { key: "stt", label: "Transcriber" },
    { key: "embeddings", label: "Embedding" },
];

const REALTIME_TABS: { key: ServiceSegment; label: string }[] = [
    { key: "realtime", label: "Realtime Model" },
    { key: "llm", label: "LLM" },
    { key: "embeddings", label: "Embedding" },
];

const OVERRIDE_STANDARD_TABS: { key: ServiceSegment; label: string }[] = [
    { key: "llm", label: "LLM" },
    { key: "tts", label: "Voice" },
    { key: "stt", label: "Transcriber" },
];

const OVERRIDE_REALTIME_TABS: { key: ServiceSegment; label: string }[] = [
    { key: "realtime", label: "Realtime Model" },
    { key: "llm", label: "LLM" },
];

// Display names for Sarvam voices
const VOICE_DISPLAY_NAMES: Record<string, string> = {
    "anushka": "Anushka (Female)",
    "manisha": "Manisha (Female)",
    "vidya": "Vidya (Female)",
    "arya": "Arya (Female)",
    "abhilash": "Abhilash (Male)",
    "karun": "Karun (Male)",
    "hitesh": "Hitesh (Male)",
};

export interface ServiceConfigurationFormProps {
    mode: 'global' | 'override';
    currentOverrides?: ModelOverrides;
    onSave: (config: Record<string, unknown>) => Promise<void>;
    /** Text for the submit button. Defaults to "Save Configuration". */
    submitLabel?: string;
    /** Optional documentation URL */
    docsUrl?: string;
}

function getProviderDisplayName(
    provider: string | undefined,
    providerSchema: ProviderSchema | undefined,
): string | undefined {
    if (!provider) return provider;
    return providerSchema?.title || provider;
}

function getGlobalSummary(
    config: Record<string, unknown> | null | undefined,
    providerSchema: ProviderSchema | undefined,
): string {
    if (!config) return "Not configured";
    const provider = config.provider as string | undefined;
    const model = config.model as string | undefined;
    if (!provider) return "Not configured";
    const providerLabel = getProviderDisplayName(provider, providerSchema);
    return model ? `${providerLabel} / ${model}` : providerLabel || provider;
}

export function ServiceConfigurationForm({
    mode,
    currentOverrides,
    onSave,
    submitLabel,
    docsUrl,
}: ServiceConfigurationFormProps) {
    const [apiError, setApiError] = useState<string | null>(null);
    const [isSaving, setIsSaving] = useState(false);
    const [savedSuccess, setSavedSuccess] = useState(false);
    const [isRealtime, setIsRealtime] = useState(false);
    const [activeTab, setActiveTab] = useState<ServiceSegment>("llm");
    const { userConfig } = useUserConfig();

    const [schemas, setSchemas] = useState<Record<ServiceSegment, Record<string, ProviderSchema>>>({
        llm: {},
        tts: {},
        stt: {},
        embeddings: {},
        realtime: {},
    });
    const [serviceProviders, setServiceProviders] = useState<Record<ServiceSegment, string>>({
        llm: "",
        tts: "",
        stt: "",
        embeddings: "",
        realtime: "",
    });
    const [apiKeys, setApiKeys] = useState<Record<ServiceSegment, string[]>>({
        llm: [""],
        tts: [""],
        stt: [""],
        embeddings: [""],
        realtime: [""],
    });
    const [isCustomInput, setIsCustomInput] = useState<Record<string, boolean>>({});

    // Override-specific state
    const [enabledOverrides, setEnabledOverrides] = useState<Record<string, boolean>>({
        llm: false,
        tts: false,
        stt: false,
        realtime: false,
    });

    const {
        register,
        handleSubmit,
        reset,
        getValues,
        setValue,
        watch
    } = useForm();

    // Build effective config source
    const configSource = useMemo(() => {
        if (mode === 'global' || !currentOverrides) return userConfig;
        const merged = { ...userConfig } as Record<string, unknown>;
        const overrideServices: (keyof ModelOverrides)[] = ["llm", "tts", "stt", "realtime"];
        for (const svc of overrideServices) {
            if (svc === "is_realtime") continue;
            const overrideVal = currentOverrides[svc];
            if (overrideVal && typeof overrideVal === "object") {
                const globalVal = (userConfig as Record<string, unknown> | null)?.[svc] as Record<string, unknown> | undefined;
                merged[svc] = { ...globalVal, ...overrideVal };
            }
        }
        if (currentOverrides.is_realtime !== undefined) {
            merged.is_realtime = currentOverrides.is_realtime;
        }
        return merged as typeof userConfig;
    }, [mode, userConfig, currentOverrides]);

    useEffect(() => {
        const fetchConfigurations = async () => {
            const response = await getDefaultConfigurationsApiV1UserConfigurationsDefaultsGet();
            if (!response.data) {
                console.error("Failed to fetch configurations");
                return;
            }

            const data = response.data as Record<string, unknown>;
            const realtimeSchemas = (data.realtime || {}) as Record<string, ProviderSchema>;

            setSchemas({
                llm: response.data.llm as Record<string, ProviderSchema>,
                tts: response.data.tts as Record<string, ProviderSchema>,
                stt: response.data.stt as Record<string, ProviderSchema>,
                embeddings: response.data.embeddings as Record<string, ProviderSchema>,
                realtime: realtimeSchemas,
            });

            // Restore realtime toggle
            const configData = configSource as Record<string, unknown> | null;
            if (configData?.is_realtime) {
                setIsRealtime(true);
                setActiveTab("realtime");
            } else {
                setActiveTab("llm");
            }

            const defaultValues: Record<string, string | number | boolean> = {};
            const selectedProviders: Record<ServiceSegment, string> = {
                llm: response.data.default_providers.llm,
                tts: response.data.default_providers.tts,
                stt: response.data.default_providers.stt,
                embeddings: response.data.default_providers.embeddings,
                realtime: "",
            };

            const realtimeProviderKeys = Object.keys(realtimeSchemas);
            if (realtimeProviderKeys.length > 0) {
                selectedProviders.realtime = realtimeProviderKeys[0];
            }

            const loadedApiKeys: Record<ServiceSegment, string[]> = {
                llm: [""],
                tts: [""],
                stt: [""],
                embeddings: [""],
                realtime: [""],
            };

            const setServicePropertyValues = (service: ServiceSegment) => {
                const src = service === "realtime"
                    ? (configSource as Record<string, unknown> | null)?.realtime as Record<string, unknown> | undefined
                    : (configSource as Record<string, unknown> | null)?.[service] as Record<string, unknown> | undefined;

                const schemaSource = service === "realtime"
                    ? realtimeSchemas
                    : response.data![service as "llm" | "tts" | "stt" | "embeddings"] as Record<string, ProviderSchema> | undefined;

                if (src?.provider) {
                    Object.entries(src).forEach(([field, value]) => {
                        if (field === "api_key") {
                            if (mode === 'override') {
                                const overrideVal = currentOverrides?.[service as keyof ModelOverrides];
                                const overrideApiKey = overrideVal && typeof overrideVal === "object"
                                    ? (overrideVal as Record<string, unknown>).api_key
                                    : undefined;
                                if (overrideApiKey) {
                                    loadedApiKeys[service] = Array.isArray(overrideApiKey)
                                        ? overrideApiKey as string[]
                                        : [overrideApiKey as string];
                                } else {
                                    loadedApiKeys[service] = [""];
                                }
                            } else {
                                if (Array.isArray(value)) {
                                    loadedApiKeys[service] = (value as string[]).length > 0 ? value as string[] : [""];
                                } else {
                                    loadedApiKeys[service] = value ? [value as string] : [""];
                                }
                            }
                        } else if (field !== "provider") {
                            defaultValues[`${service}_${field}`] = value as string | number | boolean;
                        }
                    });
                    selectedProviders[service] = src.provider as string;
                    const properties = schemaSource?.[selectedProviders[service]]?.properties as Record<string, SchemaProperty>;
                    if (properties) {
                        Object.entries(properties).forEach(([field, schema]) => {
                            const key = `${service}_${field}`;
                            if (field !== "provider" && field !== "api_key" && schema.default !== undefined && !(key in defaultValues)) {
                                defaultValues[key] = schema.default;
                            }
                        });
                    }
                } else {
                    const properties = schemaSource?.[selectedProviders[service]]?.properties as Record<string, SchemaProperty>;
                    if (properties) {
                        Object.entries(properties).forEach(([field, schema]) => {
                            if (field !== "provider" && schema.default !== undefined) {
                                defaultValues[`${service}_${field}`] = schema.default;
                            }
                        });
                    }
                }
            };

            setServicePropertyValues("llm");
            setServicePropertyValues("tts");
            setServicePropertyValues("stt");
            setServicePropertyValues("embeddings");
            setServicePropertyValues("realtime");

            // Detect custom inputs
            const detectedCustomInput: Record<string, boolean> = {};
            const allSchemas = { ...response.data, realtime: realtimeSchemas } as unknown as Record<string, Record<string, ProviderSchema>>;
            (["llm", "tts", "stt", "embeddings", "realtime"] as ServiceSegment[]).forEach(service => {
                const provider = selectedProviders[service];
                const providerSchema = allSchemas[service]?.[provider];
                if (!providerSchema) return;

                const src = service === "realtime"
                    ? (configSource as Record<string, unknown> | null)?.realtime as Record<string, unknown> | undefined
                    : (configSource as Record<string, unknown> | null)?.[service] as Record<string, unknown> | undefined;

                Object.entries(providerSchema.properties).forEach(([field, schema]) => {
                    const actualSchema = (schema as SchemaProperty).$ref && providerSchema.$defs
                        ? providerSchema.$defs[(schema as SchemaProperty).$ref!.split('/').pop() || '']
                        : schema as SchemaProperty;

                    if (!actualSchema?.allow_custom_input || !actualSchema?.examples) return;

                    const savedValue = src?.[field] as string | undefined;
                    if (savedValue && !actualSchema.examples.includes(savedValue)) {
                        detectedCustomInput[`${service}_${field}`] = true;
                    }
                });
            });

            if (mode === 'override') {
                setEnabledOverrides({
                    llm: !!currentOverrides?.llm,
                    tts: !!currentOverrides?.tts,
                    stt: !!currentOverrides?.stt,
                    realtime: !!currentOverrides?.realtime,
                });
            }

            reset(defaultValues);
            setApiKeys(loadedApiKeys);
            setServiceProviders(selectedProviders);
            setIsCustomInput(detectedCustomInput);
        };
        fetchConfigurations();
    }, [reset, configSource, mode, currentOverrides]);

    // Reset voice when TTS model changes
    const ttsModel = watch("tts_model");
    useEffect(() => {
        const voiceSchema = schemas?.tts?.[serviceProviders.tts]?.properties?.voice;
        const modelOptions = voiceSchema?.model_options;
        if (!modelOptions || !ttsModel) return;

        const validVoices = modelOptions[ttsModel as string];
        const currentVoice = getValues("tts_voice") as string;
        if (validVoices && currentVoice && !validVoices.includes(currentVoice)) {
            setValue("tts_voice", validVoices[0], { shouldDirty: true });
        }
    }, [ttsModel, serviceProviders.tts, setValue, getValues, schemas]);

    // Reset language when STT model changes
    const sttModel = watch("stt_model");
    useEffect(() => {
        const languageSchema = schemas?.stt?.[serviceProviders.stt]?.properties?.language;
        const modelOptions = languageSchema?.model_options;
        if (!modelOptions || !sttModel) return;

        const validLanguages = modelOptions[sttModel as string];
        const currentLanguage = getValues("stt_language") as string;
        if (validLanguages && currentLanguage && !validLanguages.includes(currentLanguage)) {
            setValue("stt_language", validLanguages[0], { shouldDirty: true });
        }
    }, [sttModel, serviceProviders.stt, setValue, getValues, schemas]);

    const handleProviderChange = (service: ServiceSegment, providerName: string) => {
        if (!providerName) return;

        const currentValues = getValues();
        const preservedValues: Record<string, string | number | boolean> = {};

        Object.keys(currentValues).forEach(key => {
            if (!key.startsWith(`${service}_`)) {
                preservedValues[key] = currentValues[key];
            }
        });

        if (schemas?.[service]?.[providerName]) {
            const providerSchema = schemas[service][providerName];
            Object.entries(providerSchema.properties).forEach(([field, schema]: [string, SchemaProperty]) => {
                if (field !== "provider" && schema.default !== undefined) {
                    preservedValues[`${service}_${field}`] = schema.default;
                }
            });
        }

        preservedValues[`${service}_provider`] = providerName;
        reset(preservedValues);
        setServiceProviders(prev => ({ ...prev, [service]: providerName }));
        setApiKeys(prev => ({ ...prev, [service]: [""] }));

        setIsCustomInput(prev => {
            const next = { ...prev };
            Object.keys(next).forEach(key => {
                if (key.startsWith(`${service}_`)) delete next[key];
            });
            return next;
        });
    };

    const buildServiceConfig = (service: ServiceSegment, data: FormValues) => {
        const config: Record<string, string | number | string[]> = {
            provider: serviceProviders[service],
        };
        const keys = apiKeys[service].map(k => k.trim()).filter(k => k.length > 0);
        if (keys.length > 0) {
            config.api_key = mode === 'override' ? keys[0] : keys;
        }
        const currentProvider = serviceProviders[service];
        const providerSchema = schemas?.[service]?.[currentProvider];

        Object.entries(data).forEach(([property, value]) => {
            if (!property.startsWith(`${service}_`)) return;
            const field = property.slice(service.length + 1);
            if (field === "api_key" || field === "provider") return;

            const schema = providerSchema?.properties?.[field];
            const actualSchema = schema?.$ref && providerSchema?.$defs
                ? providerSchema.$defs[schema.$ref.split('/').pop() || '']
                : schema;

            if (actualSchema?.type === "number" && value !== undefined && value !== null && value !== "") {
                const num = Number(value);
                config[field] = isNaN(num) ? (value as string | number) : num;
            } else {
                config[field] = value as string | number;
            }
        });
        return config;
    };

    const onSubmit = async (data: FormValues) => {
        setApiError(null);
        setIsSaving(true);

        try {
            if (mode === 'override') {
                const modelOverrides: Record<string, unknown> = {};
                const services = isRealtime ? ["realtime", "llm"] : ["llm", "tts", "stt"];
                for (const svc of services) {
                    if (enabledOverrides[svc]) {
                        modelOverrides[svc] = buildServiceConfig(svc as ServiceSegment, data);
                    }
                }
                const globalIsRealtime = !!(userConfig as Record<string, unknown> | null)?.is_realtime;
                if (isRealtime !== globalIsRealtime) {
                    modelOverrides.is_realtime = isRealtime;
                }
                await onSave({
                    model_overrides: Object.keys(modelOverrides).length > 0 ? modelOverrides : undefined,
                });
            } else {
                const saveConfig: Record<string, unknown> = {
                    llm: buildServiceConfig("llm", data),
                    tts: buildServiceConfig("tts", data),
                    stt: buildServiceConfig("stt", data),
                    is_realtime: isRealtime,
                };
                if (serviceProviders.realtime) {
                    saveConfig.realtime = buildServiceConfig("realtime", data);
                }
                const embeddingsKeys = apiKeys.embeddings.map(k => k.trim()).filter(k => k.length > 0);
                if (embeddingsKeys.length > 0) {
                    saveConfig.embeddings = buildServiceConfig("embeddings", data);
                }
                await onSave(saveConfig);
            }
            setApiError(null);
            setSavedSuccess(true);
            setTimeout(() => setSavedSuccess(false), 3000);
        } catch (error: unknown) {
            if (error instanceof Error) {
                setApiError(error.message);
            } else {
                setApiError('An unknown error occurred');
            }
        } finally {
            setIsSaving(false);
        }
    };

    const getConfigFields = (service: ServiceSegment): string[] => {
        const currentProvider = serviceProviders[service];
        const providerSchema = schemas?.[service]?.[currentProvider];
        if (!providerSchema) return [];
        return Object.keys(providerSchema.properties).filter(
            field => field !== "provider" && field !== "api_key"
        );
    };

    const renderFieldDescription = (field: string, providerSchema: ProviderSchema) => {
        const schema = providerSchema.properties[field];
        if (!schema) return null;
        const actualSchema = schema.$ref && providerSchema.$defs
            ? providerSchema.$defs[schema.$ref.split('/').pop() || '']
            : schema;
        if (!actualSchema?.description && !actualSchema?.docs_url) return null;
        return (
            <p className="text-[11px] text-gray-400 dark:text-gray-500 leading-snug">
                {actualSchema?.description}{" "}
                {actualSchema?.docs_url && (
                    <a
                        href={actualSchema.docs_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-0.5 text-amber-700 dark:text-amber-400 hover:underline"
                    >
                        Supported languages <ExternalLink className="h-3 w-3 inline" />
                    </a>
                )}
            </p>
        );
    };

    const renderFieldInput = (service: ServiceSegment, field: string, providerSchema: ProviderSchema) => {
        const schema = providerSchema.properties[field];
        const actualSchema = schema.$ref && providerSchema.$defs
            ? providerSchema.$defs[schema.$ref.split('/').pop() || '']
            : schema;

        if (service === "tts" && field === "voice" && !actualSchema?.allow_custom_input) {
            const hasVoiceOptions = actualSchema?.enum || actualSchema?.examples;
            if (!hasVoiceOptions) {
                return (
                    <VoiceSelector
                        provider={serviceProviders.tts}
                        value={watch(`${service}_${field}`) as string || ""}
                        onChange={(voiceId) => {
                            setValue(`${service}_${field}`, voiceId, { shouldDirty: true });
                        }}
                        model={watch("tts_model") as string || undefined}
                    />
                );
            }
        }

        if (actualSchema?.allow_custom_input && actualSchema?.examples) {
            const fieldKey = `${service}_${field}`;
            const watchVal = watch(fieldKey);
            const currentValue = watchVal !== undefined && watchVal !== null ? String(watchVal) : "";
            const options = actualSchema.examples;

            if (isCustomInput[fieldKey]) {
                return (
                    <div className="space-y-2">
                        <input
                            type={actualSchema?.type === "number" ? "number" : "text"}
                            {...(actualSchema?.type === "number" && { step: "any" })}
                            placeholder={`Enter ${field}`}
                            value={currentValue}
                            className="w-full px-3.5 py-2.5 border border-gray-200 dark:border-[#282b26] rounded-xl text-xs text-gray-900 dark:text-white focus:outline-hidden focus:ring-2 focus:ring-black/10 dark:focus:ring-white/10 transition-all font-medium"
                            style={{ backgroundColor: '#161715' }}
                            onChange={(e) => {
                                const val = actualSchema?.type === "number" ? (e.target.value === "" ? "" : Number(e.target.value)) : e.target.value;
                                setValue(fieldKey, val, { shouldDirty: true });
                            }}
                        />
                        <label className="flex items-center gap-2 pt-1 cursor-pointer">
                            <input
                                type="checkbox"
                                checked={true}
                                className="rounded border-gray-300 dark:border-[#282b26] text-black dark:text-[#bcf0da] focus:ring-black dark:focus:ring-[#bcf0da]"
                                onChange={(e) => {
                                    const checked = e.target.checked;
                                    setIsCustomInput(prev => ({ ...prev, [fieldKey]: checked }));
                                    if (!checked && options.length > 0) {
                                        const defaultOption = options[0];
                                        const parsedOption = actualSchema?.type === "number" ? Number(defaultOption) : defaultOption;
                                        setValue(fieldKey, parsedOption, { shouldDirty: true });
                                    }
                                }}
                            />
                            <span className="text-xs font-semibold text-gray-700 dark:text-gray-300">
                                Enter Custom Value
                            </span>
                        </label>
                    </div>
                );
            }

            return (
                <div className="space-y-2">
                    <select
                        value={currentValue}
                        onChange={(e) => {
                            const value = e.target.value;
                            if (value === undefined || value === null) return;
                            const parsed = actualSchema?.type === "number" ? Number(value) : value;
                            setValue(fieldKey, parsed, { shouldDirty: true });
                        }}
                        className="w-full px-3.5 py-2.5 border border-gray-200 dark:border-[#282b26] rounded-xl text-xs text-gray-900 dark:text-white appearance-none focus:outline-hidden focus:ring-2 focus:ring-black/10 dark:focus:ring-white/10 transition-all cursor-pointer font-medium"
                        style={{ backgroundColor: '#161715' }}
                    >
                        {options.map((value: string | number) => {
                            const strVal = String(value);
                            return (
                                <option key={strVal} value={strVal} className="bg-white dark:bg-[#1c1e1a] text-gray-900 dark:text-white">
                                    {field === "language" ? (LANGUAGE_DISPLAY_NAMES[strVal] || strVal) : strVal}
                                </option>
                            );
                        })}
                    </select>
                    <label className="flex items-center gap-2 pt-1 cursor-pointer">
                        <input
                            type="checkbox"
                            checked={false}
                            className="rounded border-gray-300 dark:border-[#282b26] text-black dark:text-[#bcf0da] focus:ring-black dark:focus:ring-[#bcf0da]"
                            onChange={(e) => {
                                setIsCustomInput(prev => ({ ...prev, [fieldKey]: e.target.checked }));
                            }}
                        />
                        <span className="text-xs font-semibold text-gray-700 dark:text-gray-300">
                            Enter Custom Value
                        </span>
                    </label>
                </div>
            );
        }

        let dropdownOptions = actualSchema?.enum || actualSchema?.examples;

        if (actualSchema?.model_options) {
            const modelValue = watch(`${service}_model`) as string;
            if (modelValue && actualSchema.model_options[modelValue]) {
                dropdownOptions = actualSchema.model_options[modelValue];
            }
        }

        if (dropdownOptions && dropdownOptions.length > 0) {
            const getDisplayName = (value: string | number) => {
                const strVal = String(value);
                if (field === "language") {
                    return LANGUAGE_DISPLAY_NAMES[strVal] || strVal;
                }
                if (field === "voice") {
                    return VOICE_DISPLAY_NAMES[strVal] || (strVal.length > 0 ? strVal.charAt(0).toUpperCase() + strVal.slice(1) : strVal);
                }
                return strVal;
            };

            const watchVal = watch(`${service}_${field}`);
            const currentStrValue = watchVal !== undefined && watchVal !== null ? String(watchVal) : "";

            return (
                <select
                    value={currentStrValue}
                    onChange={(e) => {
                        const value = e.target.value;
                        if (value === undefined || value === null) return;
                        const parsed = actualSchema?.type === "number" ? Number(value) : value;
                        setValue(`${service}_${field}`, parsed, { shouldDirty: true });
                    }}
                    className="w-full px-3.5 py-2.5 border border-gray-200 dark:border-[#282b26] rounded-xl text-xs text-gray-900 dark:text-white appearance-none focus:outline-hidden focus:ring-2 focus:ring-black/10 dark:focus:ring-white/10 transition-all cursor-pointer font-medium"
                    style={{ backgroundColor: '#161715' }}
                >
                    {dropdownOptions.map((value: string | number) => {
                        const strVal = String(value);
                        return (
                            <option key={strVal} value={strVal} className="bg-white dark:bg-[#1c1e1a] text-gray-900 dark:text-white">
                                {getDisplayName(value)}
                            </option>
                        );
                    })}
                </select>
            );
        }

        if (actualSchema?.multiline) {
            return (
                <textarea
                    rows={6}
                    className="w-full p-3 bg-gray-50 dark:bg-[#161715] border border-gray-200 dark:border-[#282b26] rounded-xl text-[11px] text-gray-900 dark:text-gray-200 leading-relaxed resize-none focus:outline-none focus:ring-2 focus:ring-black/10 dark:focus:ring-white/10 font-mono"
                    placeholder={`Enter ${field}`}
                    {...register(`${service}_${field}`, {
                        required: service !== "embeddings" && providerSchema.required?.includes(field),
                    })}
                />
            );
        }

        return (
            <input
                type={actualSchema?.type === "number" ? "number" : "text"}
                {...(actualSchema?.type === "number" && { step: "any" })}
                placeholder={`Enter ${field}`}
                className="w-full px-3.5 py-2.5 border border-gray-200 dark:border-[#282b26] rounded-xl text-xs text-gray-900 dark:text-white focus:outline-hidden focus:ring-2 focus:ring-black/10 dark:focus:ring-white/10 transition-all font-medium"
                style={{ backgroundColor: '#161715' }}
                {...register(`${service}_${field}`, {
                    required: service !== "embeddings" && providerSchema.required?.includes(field),
                    valueAsNumber: actualSchema?.type === "number"
                })}
            />
        );
    };

    const renderField = (service: ServiceSegment, field: string, providerSchema: ProviderSchema) => {
        return (
            <>
                {renderFieldInput(service, field, providerSchema)}
                {renderFieldDescription(field, providerSchema)}
            </>
        );
    };

    const renderServiceFields = (service: ServiceSegment) => {
        const currentProvider = serviceProviders[service];
        const providerSchema = schemas?.[service]?.[currentProvider];
        const availableProviders = schemas?.[service] ? Object.keys(schemas[service]) : [];
        const configFields = getConfigFields(service);

        return (
            <div className="space-y-6 pt-2">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    {/* Provider */}
                    <div className="space-y-2">
                        <label className="text-xs font-bold text-gray-900 dark:text-white tracking-wide block">
                            Provider
                        </label>
                        <select
                            value={currentProvider}
                            onChange={(e) => handleProviderChange(service, e.target.value)}
                            className="w-full px-3.5 py-2.5 border border-gray-200 dark:border-[#282b26] rounded-xl text-xs text-gray-900 dark:text-white appearance-none focus:outline-hidden focus:ring-2 focus:ring-black/10 dark:focus:ring-white/10 transition-all cursor-pointer font-medium"
                            style={{ backgroundColor: '#161715' }}
                        >
                            {availableProviders.map((provider) => (
                                <option key={provider} value={provider} className="bg-white dark:bg-[#1c1e1a] text-gray-900 dark:text-white">
                                    {getProviderDisplayName(provider, schemas?.[service]?.[provider])}
                                </option>
                            ))}
                        </select>
                        {(providerSchema?.description || providerSchema?.provider_docs_url) && (
                            <p className="text-[11px] text-gray-400 dark:text-gray-500 leading-snug">
                                {providerSchema?.description}{" "}
                                {providerSchema?.provider_docs_url && (
                                    <a
                                        href={providerSchema.provider_docs_url}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        className="inline-flex items-center gap-0.5 text-amber-700 dark:text-amber-400 hover:underline"
                                    >
                                        Learn more <ExternalLink className="h-3 w-3 inline" />
                                    </a>
                                )}
                            </p>
                        )}
                    </div>

                    {/* First config field */}
                    {currentProvider && providerSchema && configFields[0] && (
                        <div className="space-y-2">
                            <label className="capitalize text-xs font-bold text-gray-900 dark:text-white tracking-wide block">
                                {configFields[0].replace(/_/g, ' ')}
                            </label>
                            {renderField(service, configFields[0], providerSchema)}
                        </div>
                    )}
                </div>

                {/* Additional config fields */}
                {currentProvider && providerSchema && configFields.length > 1 && (
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                        {configFields.slice(1).map((field) => {
                            const fieldSchema = providerSchema.properties[field];
                            const actualFieldSchema = fieldSchema?.$ref && providerSchema.$defs
                                ? providerSchema.$defs[fieldSchema.$ref.split('/').pop() || '']
                                : fieldSchema;
                            const fullWidth = actualFieldSchema?.multiline;
                            return (
                                <div key={field} className={`space-y-2 ${fullWidth ? "col-span-full" : ""}`}>
                                    <label className="capitalize text-xs font-bold text-gray-900 dark:text-white tracking-wide block">
                                        {field.replace(/_/g, ' ')}
                                    </label>
                                    {renderField(service, field, providerSchema)}
                                </div>
                            );
                        })}
                    </div>
                )}

                {/* API Key(s) */}
                {currentProvider && providerSchema && providerSchema.properties.api_key && (
                    <div className="space-y-3 pt-4 border-t border-gray-100 dark:border-[#282b26]">
                        <label className="text-xs font-bold text-gray-900 dark:text-white flex items-center gap-2">
                            <Key className="w-3.5 h-3.5 text-gray-500 dark:text-gray-400" />
                            <span>{mode === 'override' ? 'API Key (leave empty to use global)' : 'API Key(s)'}</span>
                        </label>
                        {renderFieldDescription("api_key", providerSchema)}
                        {apiKeys[service].map((key, index) => (
                            <div key={index} className="flex items-center gap-2">
                                <input
                                    type="text"
                                    placeholder="Enter API key"
                                    value={key}
                                    onChange={(e) => {
                                        const newKeys = [...apiKeys[service]];
                                        newKeys[index] = e.target.value;
                                        setApiKeys(prev => ({ ...prev, [service]: newKeys }));
                                    }}
                                    className="w-full px-3.5 py-2.5 border border-gray-200 dark:border-[#282b26] rounded-xl text-xs font-mono text-gray-800 dark:text-gray-200 focus:outline-hidden focus:ring-2 focus:ring-black/10 dark:focus:ring-white/10"
                                    style={{ backgroundColor: '#161715' }}
                                />
                                {apiKeys[service].length > 1 && (
                                    <button
                                        type="button"
                                        className="p-2 rounded-xl text-gray-400 hover:text-rose-500 hover:bg-gray-100 dark:hover:bg-[#232621] transition-colors shrink-0"
                                        onClick={() => {
                                            setApiKeys(prev => ({
                                                ...prev,
                                                [service]: prev[service].filter((_, i) => i !== index),
                                            }));
                                        }}
                                    >
                                        <X className="h-4 w-4" />
                                    </button>
                                )}
                            </div>
                        ))}
                        {mode !== 'override' && (
                            <button
                                type="button"
                                className="px-4 py-2 bg-gray-100 dark:bg-[#161715] hover:bg-gray-200 dark:hover:bg-[#232621] text-gray-900 dark:text-white rounded-xl text-xs font-semibold flex items-center gap-1.5 transition-colors cursor-pointer"
                                onClick={() => {
                                    setApiKeys(prev => ({
                                        ...prev,
                                        [service]: [...prev[service], ""],
                                    }));
                                }}
                            >
                                <Plus className="w-3.5 h-3.5" />
                                <span>Add API Key</span>
                            </button>
                        )}
                    </div>
                )}
            </div>
        );
    };

    const handleOverrideToggle = (service: string, enabled: boolean) => {
        setEnabledOverrides(prev => ({ ...prev, [service]: enabled }));
    };

    const renderOverrideToggle = (service: ServiceSegment, label: string) => {
        const globalVal = (userConfig as Record<string, unknown> | null)?.[service] as Record<string, unknown> | null | undefined;
        const isEnabled = enabledOverrides[service];
        const globalProvider = globalVal?.provider as string | undefined;
        const globalProviderSchema = globalProvider ? schemas?.[service]?.[globalProvider] : undefined;

        return (
            <div className="flex items-center justify-between p-4 bg-gray-50/70 dark:bg-[#161715] border border-gray-200 dark:border-[#282b26] rounded-xl mb-4">
                <div className="space-y-0.5">
                    <label htmlFor={`override-${service}`} className="text-xs cursor-pointer font-bold text-gray-900 dark:text-white">
                        Override {label}
                    </label>
                    {!isEnabled && (
                        <p className="text-[11px] text-gray-400 dark:text-gray-500 leading-snug">
                            Using global: {getGlobalSummary(globalVal, globalProviderSchema)}
                        </p>
                    )}
                </div>
                <button
                    type="button"
                    id={`override-${service}`}
                    onClick={() => handleOverrideToggle(service, !isEnabled)}
                    className={`relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out ${
                        isEnabled ? "bg-black dark:bg-[#bcf0da]" : "bg-gray-300 dark:bg-[#282b26]"
                    }`}
                >
                    <span
                        className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white dark:bg-[#082117] shadow-md ring-0 transition duration-200 ease-in-out ${
                            isEnabled ? "translate-x-5" : "translate-x-0"
                        }`}
                    />
                </button>
            </div>
        );
    };

    const getVisibleTabs = () => {
        if (mode === 'override') {
            return isRealtime ? OVERRIDE_REALTIME_TABS : OVERRIDE_STANDARD_TABS;
        }
        return isRealtime ? REALTIME_TABS : STANDARD_TABS;
    };

    const visibleTabs = getVisibleTabs();

    return (
        <form onSubmit={handleSubmit(onSubmit)} className="flex flex-col h-full text-gray-900 dark:text-white font-sans select-none relative" style={{ backgroundColor: '#161715' }}>
            {/* Top Sub-Header matching demo styling when in global page mode */}
            {mode === 'global' && (
                <header className="px-8 pt-6 pb-3 flex items-center justify-between sticky top-0 z-20 border-b border-gray-100 dark:border-[#282b26]" style={{ backgroundColor: '#161715' }}>
                    <div className="space-y-0.5">
                        <h1 className="text-base font-semibold text-gray-900 dark:text-white tracking-tight">
                            Models & Services
                        </h1>
                        <p className="text-xs text-gray-500 dark:text-gray-400 flex items-center gap-1">
                            <span>Configure AI model, voice, and transcription services.</span>
                            {docsUrl && (
                                <a
                                    href={docsUrl}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="text-amber-700 dark:text-amber-400 hover:underline flex items-center gap-0.5 font-medium"
                                >
                                    <span>Learn more</span>
                                    <ExternalLink className="w-3 h-3" />
                                </a>
                            )}
                        </p>
                    </div>

                    <button
                        type="submit"
                        disabled={isSaving}
                        className="flex items-center gap-1.5 px-5 py-2 bg-black dark:bg-[#bcf0da] hover:bg-gray-800 dark:hover:bg-[#a5e9cd] text-white dark:text-[#082117] text-xs font-bold rounded-full shadow-xs transition-all active:scale-[0.98] cursor-pointer disabled:opacity-50"
                    >
                        <Save className="w-3.5 h-3.5" />
                        <span>{isSaving ? "Saving..." : (submitLabel || "Save Configuration")}</span>
                    </button>
                </header>
            )}

            {/* Scrollable Form Workspace Container */}
            <div className={`${mode === 'global' ? 'max-w-4xl w-full mx-auto px-8 pt-6 pb-16' : 'w-full'} flex flex-col gap-6`}>
                {/* Success Alert Banner */}
                {savedSuccess && (
                    <div className="flex items-center justify-between px-4 py-3 bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-800/50 text-emerald-800 dark:text-emerald-300 rounded-xl text-xs font-semibold animate-in fade-in slide-in-from-top-2 duration-300">
                        <div className="flex items-center gap-2">
                            <CheckCircle2 className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
                            <span>Model configuration saved successfully!</span>
                        </div>
                    </div>
                )}

                {/* Realtime Mode Toggle Banner Card */}
                <div
                    className="border border-gray-200/80 dark:border-[#282b26] rounded-2xl p-5 flex items-center justify-between shadow-2xs"
                    style={{ backgroundColor: '#1C1E1A' }}
                >
                    <div className="space-y-1 max-w-xl">
                        <div className="flex items-center gap-2">
                            <Sparkles className="w-4 h-4 text-amber-600 dark:text-amber-400" />
                            <h3 className="text-sm font-bold text-gray-900 dark:text-white">Realtime Mode</h3>
                        </div>
                        <p className="text-xs text-gray-500 dark:text-gray-400 leading-relaxed">
                            Uses a single speech-to-speech model (no separate STT/TTS). An LLM is still required for variable extraction and QA.
                        </p>
                    </div>

                    {/* Toggle Switch */}
                    <button
                        type="button"
                        onClick={() => {
                            const nextState = !isRealtime;
                            setIsRealtime(nextState);
                            if (nextState) {
                                setActiveTab("realtime");
                            } else if (activeTab === "realtime") {
                                setActiveTab("llm");
                            }
                        }}
                        className={`relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-hidden ${
                            isRealtime ? "bg-black dark:bg-[#bcf0da]" : "bg-gray-300 dark:bg-[#282b26]"
                        }`}
                    >
                        <span
                            className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white dark:bg-[#082117] shadow-md ring-0 transition duration-200 ease-in-out ${
                                isRealtime ? "translate-x-5" : "translate-x-0"
                            }`}
                        />
                    </button>
                </div>

                {/* Configurations Card */}
                <div
                    className="border border-gray-200/90 dark:border-[#282b26] rounded-2xl p-6 shadow-2xs space-y-6"
                    style={{ backgroundColor: '#1C1E1A' }}
                >
                    {/* Sub-Tabs Nav Pill Switcher */}
                    <div
                        className="p-1 rounded-xl flex items-center gap-1 overflow-x-auto border border-gray-200/50 dark:border-[#282b26]"
                        style={{ backgroundColor: '#161715' }}
                    >
                        {visibleTabs.map(({ key, label }) => {
                            const isActive = activeTab === key;
                            return (
                                <button
                                    key={key}
                                    type="button"
                                    onClick={() => setActiveTab(key)}
                                    className={`flex-1 min-w-[100px] py-2 px-3 rounded-lg text-xs font-bold transition-all text-center cursor-pointer ${
                                        isActive
                                            ? "text-gray-900 dark:text-white shadow-2xs font-bold"
                                            : "text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white"
                                    }`}
                                    style={isActive ? { backgroundColor: '#282b26' } : undefined}
                                >
                                    {label}
                                </button>
                            );
                        })}
                    </div>

                    {/* Active Tab Content */}
                    <div>
                        {mode === 'override' && renderOverrideToggle(activeTab, visibleTabs.find(t => t.key === activeTab)?.label || activeTab)}
                        {(mode === 'global' || enabledOverrides[activeTab]) && renderServiceFields(activeTab)}
                    </div>
                </div>

                {apiError && <p className="text-red-600 dark:text-red-400 text-xs font-semibold">{apiError}</p>}

                {/* Bottom Save Button */}
                <div className="pt-2">
                    <button
                        type="submit"
                        disabled={isSaving}
                        className="w-full py-3 bg-black dark:bg-[#bcf0da] hover:bg-gray-800 dark:hover:bg-[#a5e9cd] text-white dark:text-[#082117] text-xs font-bold rounded-full shadow-xs transition-all active:scale-[0.99] text-center cursor-pointer disabled:opacity-50"
                    >
                        {isSaving ? "Saving..." : (submitLabel || "Save Configuration")}
                    </button>
                </div>
            </div>
        </form>
    );
}
