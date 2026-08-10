"use client";

import { format } from "date-fns";
import {
  ArrowLeft,
  BookA,
  Brain,
  CalendarIcon,
  CheckCircle2,
  Clipboard,
  Cpu,
  Download,
  ExternalLink,
  FileDown,
  FileText,
  Fingerprint,
  Loader2,
  Mic,
  Pause,
  PhoneOff,
  Play,
  Plus,
  Rocket,
  Save,
  Settings,
  Trash2Icon,
  Upload,
  Variable,
  X,
} from "lucide-react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";

import {
  downloadWorkflowReportApiV1WorkflowWorkflowIdReportGet,
  getAmbientNoiseUploadUrlApiV1WorkflowAmbientNoiseUploadUrlPost,
  getWorkflowApiV1WorkflowFetchWorkflowIdGet,
} from "@/client/sdk.gen";
import type { WorkflowResponse } from "@/client/types.gen";
import { FlowEdge, FlowNode } from "@/components/flow/types";
import { LLMConfigSelector } from "@/components/LLMConfigSelector";
import { ServiceConfigurationForm } from "@/components/ServiceConfigurationForm";
import SpinLoader from "@/components/SpinLoader";
import { Calendar } from "@/components/ui/calendar";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { SETTINGS_DOCUMENTATION_URLS } from "@/constants/documentation";
import { UnsavedChangesProvider, useUnsavedChanges, useUnsavedChangesContext } from "@/context/UnsavedChangesContext";
import { useAudioPlayback } from "@/hooks/useAudioPlayback";
import { useCurrentUserRole } from "@/hooks/useCurrentUserRole";
import { useAuth } from "@/lib/auth";
import logger from "@/lib/logger";
import {
  type AmbientNoiseConfiguration,
  DEFAULT_VOICEMAIL_DETECTION_CONFIGURATION,
  DEFAULT_WORKFLOW_CONFIGURATIONS,
  type TurnStopStrategy,
  type VoicemailDetectionConfiguration,
  type WorkflowConfigurations,
} from "@/types/workflow-configurations";

import { EmbedDialog } from "../components/EmbedDialog";
import { useWorkflowState } from "../hooks/useWorkflowState";

// ---------------------------------------------------------------------------
// Constants & Defaults
// ---------------------------------------------------------------------------

const DEFAULT_AMBIENT_NOISE_CONFIG: AmbientNoiseConfiguration = {
  enabled: false,
  volume: 0.3,
};

const DEFAULT_VOICEMAIL_SYSTEM_PROMPT = `You are a voicemail detection classifier for an OUTBOUND calling system. A bot has called a phone number and you need to determine if a human answered or if the call went to voicemail based on the provided text.

HUMAN ANSWERED - LIVE CONVERSATION (respond "CONVERSATION"):
- Personal greetings: "Hello?", "Hi", "Yeah?", "John speaking"
- Interactive responses: "Who is this?", "What do you want?", "Can I help you?"
- Conversational tone expecting back-and-forth dialogue
- Questions directed at the caller: "Hello? Anyone there?"
- Informal responses: "Yep", "What's up?", "Speaking"
- Natural, spontaneous speech patterns
- Immediate acknowledgment of the call

VOICEMAIL SYSTEM (respond "VOICEMAIL"):
- Automated voicemail greetings: "Hi, you've reached [name], please leave a message"
- Phone carrier messages: "The number you have dialed is not in service", "Please leave a message", "All circuits are busy"
- Professional voicemail: "This is [name], I'm not available right now"
- Instructions about leaving messages: "leave a message", "leave your name and number"
- References to callback or messaging: "call me back", "I'll get back to you"
- Carrier system messages: "mailbox is full", "has not been set up"
- Business hours messages: "our office is currently closed"

Respond with ONLY "CONVERSATION" if a person answered, or "VOICEMAIL" if it's voicemail/recording.`;

const NAV_ITEMS = [
  { id: "general", label: "General", icon: Settings },
  { id: "models", label: "Model Overrides", icon: Cpu },
  { id: "variables", label: "Template Variables", icon: Variable },
  { id: "dictionary", label: "Dictionary", icon: BookA },
  { id: "voicemail", label: "Voicemail Detection", icon: PhoneOff },
  { id: "recordings", label: "Recordings", icon: Mic },
  { id: "deployment", label: "Add to Website", icon: Rocket },
  { id: "report", label: "Report", icon: FileText },
  { id: "identity", label: "Agent UUID", icon: Fingerprint },
];

const MAX_AMBIENT_NOISE_FILE_SIZE = 10 * 1024 * 1024; // 10MB

// ---------------------------------------------------------------------------
// Section 1: General
// ---------------------------------------------------------------------------

function GeneralSection({
  workflowConfigurations,
  workflowName,
  workflowId,
  initialConcurrencyLimit,
  onSave,
}: {
  workflowConfigurations: WorkflowConfigurations;
  workflowName: string;
  workflowId: number;
  initialConcurrencyLimit?: number | null;
  onSave: (configurations: WorkflowConfigurations, workflowName: string, concurrencyLimit?: number | null) => Promise<void>;
}) {
  const [name, setName] = useState(workflowName);
  const [concurrencyLimit, setConcurrencyLimit] = useState<number | "">(initialConcurrencyLimit ?? "");
  const [ambientNoiseConfig, setAmbientNoiseConfig] = useState<AmbientNoiseConfiguration>(
    workflowConfigurations.ambient_noise_configuration || DEFAULT_AMBIENT_NOISE_CONFIG,
  );
  const [maxCallDuration, setMaxCallDuration] = useState(workflowConfigurations.max_call_duration || 600);
  const [maxUserIdleTimeout, setMaxUserIdleTimeout] = useState(workflowConfigurations.max_user_idle_timeout || 10);
  const [smartTurnStopSecs, setSmartTurnStopSecs] = useState(workflowConfigurations.smart_turn_stop_secs || 2);
  const [turnStopStrategy, setTurnStopStrategy] = useState<TurnStopStrategy>(
    workflowConfigurations.turn_stop_strategy || "turn_analyzer",
  );
  const [contextCompactionEnabled, setContextCompactionEnabled] = useState(
    workflowConfigurations.context_compaction_enabled ?? false,
  );
  const [isSaving, setIsSaving] = useState(false);
  const [isUploadingAudio, setIsUploadingAudio] = useState(false);
  const [audioUploadError, setAudioUploadError] = useState<string | null>(null);
  const ambientFileInputRef = useRef<HTMLInputElement>(null);
  const { playingId, toggle: togglePlayback } = useAudioPlayback();

  const { getAccessToken } = useAuth();
  const [orgConcurrencyStatus, setOrgConcurrencyStatus] = useState<{
    concurrency_limit: number | null;
    allocated_concurrency: number;
  } | null>(null);

  useEffect(() => {
    const fetchStatus = async () => {
      try {
        const token = await getAccessToken();
        const res = await fetch("/api/v1/organizations/concurrency-status", {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (res.ok) {
          const data = await res.json();
          setOrgConcurrencyStatus(data);
        }
      } catch (err) {
        logger.error("Failed to fetch organization concurrency status", err);
      }
    };
    fetchStatus();
  }, [getAccessToken]);

  const isConcurrencyExceeded = useMemo(() => {
    if (!orgConcurrencyStatus || orgConcurrencyStatus.concurrency_limit === null) return false;
    const numericLimit = concurrencyLimit === "" ? 0 : concurrencyLimit;
    const initialLimit = initialConcurrencyLimit || 0;
    const otherAllocated = orgConcurrencyStatus.allocated_concurrency - initialLimit;
    return otherAllocated + numericLimit > orgConcurrencyStatus.concurrency_limit;
  }, [orgConcurrencyStatus, concurrencyLimit, initialConcurrencyLimit]);

  const isDirty = useMemo(() => {
    const initAmbient = workflowConfigurations.ambient_noise_configuration || DEFAULT_AMBIENT_NOISE_CONFIG;
    return (
      name !== workflowName ||
      JSON.stringify(ambientNoiseConfig) !== JSON.stringify(initAmbient) ||
      maxCallDuration !== (workflowConfigurations.max_call_duration || 600) ||
      maxUserIdleTimeout !== (workflowConfigurations.max_user_idle_timeout || 10) ||
      smartTurnStopSecs !== (workflowConfigurations.smart_turn_stop_secs || 2) ||
      turnStopStrategy !== (workflowConfigurations.turn_stop_strategy || "turn_analyzer") ||
      contextCompactionEnabled !== (workflowConfigurations.context_compaction_enabled ?? false) ||
      (concurrencyLimit === "" ? null : concurrencyLimit) !== (initialConcurrencyLimit ?? null)
    );
  }, [
    name,
    workflowName,
    ambientNoiseConfig,
    maxCallDuration,
    maxUserIdleTimeout,
    smartTurnStopSecs,
    turnStopStrategy,
    contextCompactionEnabled,
    workflowConfigurations,
    concurrencyLimit,
    initialConcurrencyLimit,
  ]);

  useUnsavedChanges("general", isDirty);

  const handleAmbientFileUpload = async (file: File) => {
    if (file.size > MAX_AMBIENT_NOISE_FILE_SIZE) {
      setAudioUploadError(`File too large (${(file.size / (1024 * 1024)).toFixed(1)}MB). Maximum is 10MB.`);
      return;
    }
    setIsUploadingAudio(true);
    setAudioUploadError(null);
    try {
      const res = await getAmbientNoiseUploadUrlApiV1WorkflowAmbientNoiseUploadUrlPost({
        body: {
          workflow_id: Number(workflowId),
          filename: file.name,
          mime_type: file.type || "audio/wav",
          file_size: file.size,
        },
      });
      if (res.error || !res.data?.upload_url) {
        throw new Error("Failed to get upload URL");
      }
      const data = res.data;
      const uploadRes = await fetch(data.upload_url, {
        method: "PUT",
        body: file,
        headers: { "Content-Type": file.type || "audio/wav" },
      });
      if (!uploadRes.ok) {
        throw new Error("File upload failed");
      }
      setAmbientNoiseConfig((prev) => ({
        ...prev,
        storage_key: data.storage_key,
        storage_backend: data.storage_backend,
        original_filename: file.name,
      }));
    } catch (err) {
      setAudioUploadError(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setIsUploadingAudio(false);
      if (ambientFileInputRef.current) ambientFileInputRef.current.value = "";
    }
  };

  const handleSave = async () => {
    setIsSaving(true);
    try {
      await onSave(
        {
          ...workflowConfigurations,
          ambient_noise_configuration: ambientNoiseConfig,
          max_call_duration: maxCallDuration,
          max_user_idle_timeout: maxUserIdleTimeout,
          smart_turn_stop_secs: smartTurnStopSecs,
          turn_stop_strategy: turnStopStrategy,
          context_compaction_enabled: contextCompactionEnabled,
        },
        name,
        concurrencyLimit !== "" ? concurrencyLimit : null,
      );
      toast.success("General Settings saved successfully!");
    } catch (error) {
      console.error("Failed to save general settings:", error);
      toast.error("Failed to save settings");
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <section
      id="general"
      className="border border-gray-200/90 dark:border-[#282b26] rounded-2xl p-6 shadow-2xs space-y-6"
      style={{ backgroundColor: '#1C1E1A' }}
    >
      <div className="space-y-1 pb-2 border-b border-gray-100 dark:border-[#282b26]">
        <div className="flex items-center gap-2">
          <Settings className="w-4 h-4 text-amber-600" />
          <h2 className="text-xl font-normal text-gray-900 dark:text-[#f2f4f0] font-serif tracking-tight">
            General
          </h2>
        </div>
        <p className="text-xs text-gray-500 dark:text-[#9ca39a] flex items-center gap-1">
          <span>Agent name, call behavior, and turn detection.</span>
          <a
            href={SETTINGS_DOCUMENTATION_URLS.general}
            target="_blank"
            rel="noopener noreferrer"
            className="text-amber-700 hover:underline inline-flex items-center gap-0.5"
          >
            Learn more <ExternalLink className="w-3 h-3" />
          </a>
        </p>
      </div>

      {/* Agent Name */}
      <div className="space-y-1.5">
        <label className="text-xs font-bold text-gray-900 dark:text-[#f2f4f0]">Agent Name</label>
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="w-full px-3.5 py-2.5 bg-gray-50 dark:bg-[#1a1c18] border border-gray-200 dark:border-[#2e312b] rounded-xl text-xs font-semibold text-gray-900 dark:text-[#f2f4f0] focus:outline-hidden"
        />
      </div>

      {/* Concurrency Limit */}
      <div className="space-y-1.5">
        <div className="flex justify-between items-center">
          <label className="text-xs font-bold text-gray-900 dark:text-[#f2f4f0]">Concurrency Limit</label>
          <span className="text-[11px] text-gray-400 dark:text-[#9ca39a] font-medium">
            Org Limit: {orgConcurrencyStatus?.concurrency_limit ?? 6}
          </span>
        </div>
        <input
          type="number"
          min="1"
          value={concurrencyLimit}
          onChange={(e) => setConcurrencyLimit(e.target.value === "" ? "" : parseInt(e.target.value, 10))}
          placeholder="Leave empty for unlimited (up to org limit)"
          className="w-full px-3.5 py-2.5 bg-gray-50 dark:bg-[#1a1c18] border border-gray-200 dark:border-[#2e312b] rounded-xl text-xs text-gray-900 dark:text-[#f2f4f0] focus:outline-hidden"
        />
        {isConcurrencyExceeded && (
          <p className="text-xs text-rose-400 mt-1">
            The sum of agent concurrency limits exceeds the total limit allocated for your organization ({orgConcurrencyStatus?.concurrency_limit}).
          </p>
        )}
      </div>

      {/* Ambient Noise */}
      <div className="p-4 bg-gray-50/80 dark:bg-[#1a1c18] border border-gray-200/80 dark:border-[#2e312b] rounded-xl flex items-center justify-between">
        <div className="space-y-0.5">
          <h4 className="text-xs font-bold text-gray-900 dark:text-[#f2f4f0]">Ambient Noise</h4>
          <p className="text-[11.5px] text-gray-500 dark:text-[#9ca39a]">
            Add background ambient noise to make the conversation sound more natural.
          </p>
          <span className="text-xs font-semibold text-gray-800 dark:text-[#c8ccc5] inline-block pt-1">
            Use Ambient Noise
          </span>
        </div>
        <Switch
          checked={ambientNoiseConfig.enabled}
          onCheckedChange={(checked) => setAmbientNoiseConfig((prev) => ({ ...prev, enabled: checked }))}
        />
      </div>

      {/* Turn Detection */}
      <div className="space-y-4 pt-2">
        <div className="space-y-0.5">
          <h3 className="text-xs font-bold text-gray-900 dark:text-[#f2f4f0]">Turn Detection</h3>
          <p className="text-[11.5px] text-gray-500 dark:text-[#9ca39a]">
            Configure how the agent detects when the user has finished speaking.
          </p>
        </div>

        <div className="space-y-2">
          <label className="text-xs font-bold text-gray-900 dark:text-[#f2f4f0]">Detection Strategy</label>
          <select
            value={turnStopStrategy}
            onChange={(e) => setTurnStopStrategy(e.target.value as TurnStopStrategy)}
            className="w-full px-3.5 py-2.5 bg-gray-50 dark:bg-[#1a1c18] border border-gray-200 dark:border-[#2e312b] rounded-xl text-xs text-gray-900 dark:text-[#f2f4f0] font-medium"
          >
            <option value="turn_analyzer">Smart Turn Analyzer</option>
            <option value="transcription">Server VAD (Transcription-based)</option>
          </select>
          <p className="text-[11px] text-gray-400 dark:text-[#9ca39a]">
            Best for longer responses with natural pauses. Uses ML model to detect end of turn.
          </p>
        </div>

        <div className="space-y-1.5">
          <label className="text-xs font-bold text-gray-900 dark:text-[#f2f4f0]">Incomplete Turn Timeout (seconds)</label>
          <input
            type="number"
            step="0.5"
            min="0.5"
            max="10"
            value={smartTurnStopSecs}
            onChange={(e) => setSmartTurnStopSecs(parseFloat(e.target.value) || 2)}
            className="w-full px-3.5 py-2.5 bg-gray-50 dark:bg-[#1a1c18] border border-gray-200 dark:border-[#2e312b] rounded-xl text-xs text-gray-900 dark:text-[#f2f4f0] font-mono"
          />
          <p className="text-[11px] text-gray-400 dark:text-[#9ca39a]">
            Max silence duration before ending an incomplete turn. Default: 2 seconds
          </p>
        </div>
      </div>

      {/* Context Compaction */}
      <div className="space-y-2 pt-2 border-t border-gray-100 dark:border-[#282b26]">
        <div className="space-y-0.5">
          <h3 className="text-xs font-bold text-gray-900 dark:text-[#f2f4f0]">Context Compaction</h3>
          <p className="text-[11.5px] text-gray-500 dark:text-[#9ca39a] leading-relaxed">
            Automatically summarize conversation context when transitioning between nodes. Not applicable in Realtime mode — the speech-to-speech service manages its own conversation state and this setting is ignored.
          </p>
        </div>

        <div className="p-4 bg-gray-50/80 dark:bg-[#1a1c18] border border-gray-200/80 dark:border-[#2e312b] rounded-xl flex items-center justify-between">
          <span className="text-xs font-bold text-gray-900 dark:text-[#f2f4f0]">Enable Context Compaction</span>
          <Switch checked={contextCompactionEnabled} onCheckedChange={setContextCompactionEnabled} />
        </div>
      </div>

      {/* Call Management */}
      <div className="space-y-4 pt-2 border-t border-gray-100 dark:border-[#282b26]">
        <div className="space-y-0.5">
          <h3 className="text-xs font-bold text-gray-900 dark:text-[#f2f4f0]">Call Management</h3>
          <p className="text-[11.5px] text-gray-500 dark:text-[#9ca39a]">
            Configure call duration limits and idle timeout settings.
          </p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="space-y-1.5">
            <label className="text-xs font-bold text-gray-900 dark:text-[#f2f4f0]">Max Call Duration (seconds)</label>
            <input
              type="number"
              min="1"
              value={maxCallDuration}
              onChange={(e) => setMaxCallDuration(parseInt(e.target.value, 10) || 600)}
              className="w-full px-3.5 py-2.5 bg-gray-50 dark:bg-[#1a1c18] border border-gray-200 dark:border-[#2e312b] rounded-xl text-xs font-mono text-gray-900 dark:text-[#f2f4f0]"
            />
            <p className="text-[11px] text-gray-400 dark:text-[#9ca39a]">Default: 600 (10 minutes)</p>
          </div>

          <div className="space-y-1.5">
            <label className="text-xs font-bold text-gray-900 dark:text-[#f2f4f0]">Max User Idle Timeout (seconds)</label>
            <input
              type="number"
              min="1"
              value={maxUserIdleTimeout}
              onChange={(e) => setMaxUserIdleTimeout(parseInt(e.target.value, 10) || 10)}
              className="w-full px-3.5 py-2.5 bg-gray-50 dark:bg-[#1a1c18] border border-gray-200 dark:border-[#2e312b] rounded-xl text-xs font-mono text-gray-900 dark:text-[#f2f4f0]"
            />
            <p className="text-[11px] text-gray-400 dark:text-[#9ca39a]">Default: 10 seconds</p>
          </div>
        </div>
      </div>

      <button
        onClick={handleSave}
        disabled={isSaving || !isDirty}
        className="px-5 py-2.5 bg-black dark:bg-[#bcf0da] hover:bg-gray-800 dark:hover:bg-[#a5e9cc] text-white dark:text-[#082117] text-xs font-bold rounded-full shadow-xs transition-all active:scale-[0.98] disabled:opacity-50 cursor-pointer"
      >
        {isSaving ? "Saving..." : "Save General Settings"}
      </button>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Section 2: Template Variables
// ---------------------------------------------------------------------------

function TemplateVariablesSection({
  templateContextVariables,
  onSave,
}: {
  templateContextVariables: Record<string, string>;
  onSave: (variables: Record<string, string>) => Promise<void>;
}) {
  const [contextVars, setContextVars] = useState<Record<string, string>>(templateContextVariables);
  const [newKey, setNewKey] = useState("");
  const [newValue, setNewValue] = useState("");
  const [isSaving, setIsSaving] = useState(false);

  const isDirty = useMemo(() => {
    const pendingVars = newKey && newValue ? { ...contextVars, [newKey]: newValue } : contextVars;
    return JSON.stringify(pendingVars) !== JSON.stringify(templateContextVariables);
  }, [contextVars, newKey, newValue, templateContextVariables]);

  useUnsavedChanges("variables", isDirty);

  const handleAdd = (e: React.FormEvent) => {
    e.preventDefault();
    if (newKey && newValue) {
      setContextVars((prev) => ({ ...prev, [newKey]: newValue }));
      setNewKey("");
      setNewValue("");
    }
  };

  const handleRemove = (key: string) => {
    setContextVars((prev) => {
      const next = { ...prev };
      delete next[key];
      return next;
    });
  };

  const handleSave = async () => {
    setIsSaving(true);
    try {
      let varsToSave = contextVars;
      if (newKey && newValue) {
        varsToSave = { ...varsToSave, [newKey]: newValue };
      }
      await onSave(varsToSave);
      toast.success("Template Variables saved successfully!");
    } catch (error) {
      console.error("Failed to save variables:", error);
      toast.error("Failed to save variables");
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <section
      id="variables"
      className="border border-gray-200/90 dark:border-[#282b26] rounded-2xl p-6 shadow-2xs space-y-6"
      style={{ backgroundColor: '#1C1E1A' }}
    >
      <div className="space-y-1 pb-2 border-b border-gray-100 dark:border-[#282b26]">
        <div className="flex items-center gap-2">
          <Variable className="w-4 h-4 text-amber-600" />
          <h2 className="text-xl font-normal text-gray-900 dark:text-[#f2f4f0] font-serif tracking-tight">
            Template Variables
          </h2>
        </div>
        <p className="text-xs text-gray-500 dark:text-[#9ca39a] flex items-center gap-1">
          <span>Variables available in workflow prompts via {"{{variable_name}}"} syntax for testing the workflow.</span>
          <a
            href={SETTINGS_DOCUMENTATION_URLS.templateVariables}
            target="_blank"
            rel="noopener noreferrer"
            className="text-amber-700 hover:underline inline-flex items-center gap-0.5"
          >
            Learn more <ExternalLink className="w-3 h-3" />
          </a>
        </p>
      </div>

      {/* Existing Variables List */}
      {Object.entries(contextVars).length > 0 && (
        <div className="space-y-2">
          {Object.entries(contextVars).map(([key, value]) => (
            <div
              key={key}
              className="flex items-center justify-between p-3 bg-gray-50 dark:bg-[#1a1c18] border border-gray-200 dark:border-[#2e312b] rounded-xl text-xs"
            >
              <div className="flex items-center gap-2 font-mono">
                <span className="font-bold text-gray-900 dark:text-[#f2f4f0]">{`{{${key}}}`}</span>
                <span className="text-gray-400 dark:text-[#9ca39a]">=</span>
                <span className="text-gray-700 dark:text-[#c8ccc5]">{value}</span>
              </div>
              <button
                onClick={() => handleRemove(key)}
                className="p-1 text-gray-400 dark:text-[#9ca39a] hover:text-rose-400 cursor-pointer"
              >
                <Trash2Icon className="w-4 h-4" />
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Add New Variable Form */}
      <form onSubmit={handleAdd} className="space-y-3 pt-2">
        <span className="text-xs font-bold text-gray-900 dark:text-[#f2f4f0]">Add New Variable</span>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <input
            type="text"
            value={newKey}
            onChange={(e) => setNewKey(e.target.value)}
            placeholder="Enter variable key"
            className="px-3.5 py-2.5 bg-gray-50 dark:bg-[#1a1c18] border border-gray-200 dark:border-[#2e312b] rounded-xl text-xs text-gray-900 dark:text-[#f2f4f0] focus:outline-hidden"
          />
          <input
            type="text"
            value={newValue}
            onChange={(e) => setNewValue(e.target.value)}
            placeholder="Enter variable value"
            className="px-3.5 py-2.5 bg-gray-50 dark:bg-[#1a1c18] border border-gray-200 dark:border-[#2e312b] rounded-xl text-xs text-gray-900 dark:text-[#f2f4f0] focus:outline-hidden"
          />
        </div>

        <button
          type="submit"
          disabled={!newKey || !newValue}
          className="px-4 py-2 bg-gray-100 dark:bg-[#252822] hover:bg-gray-200 dark:hover:bg-[#2e322a] text-gray-900 dark:text-[#f2f4f0] text-xs font-bold rounded-full transition-colors flex items-center gap-1.5 disabled:opacity-50 cursor-pointer"
        >
          <Plus className="w-3.5 h-3.5" />
          <span>Add Variable</span>
        </button>
      </form>

      <button
        onClick={handleSave}
        disabled={isSaving || !isDirty}
        className="px-5 py-2.5 bg-black dark:bg-[#bcf0da] hover:bg-gray-800 dark:hover:bg-[#a5e9cc] text-white dark:text-[#082117] text-xs font-bold rounded-full shadow-xs transition-all active:scale-[0.98] disabled:opacity-50 cursor-pointer"
      >
        {isSaving ? "Saving..." : "Save Variables"}
      </button>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Section 3: Dictionary
// ---------------------------------------------------------------------------

function DictionarySection({
  dictionary,
  onSave,
}: {
  dictionary: string;
  onSave: (dictionary: string) => Promise<void>;
}) {
  const [dictionaryValue, setDictionaryValue] = useState(dictionary);
  const [isSaving, setIsSaving] = useState(false);

  const isDirty = dictionaryValue !== dictionary;
  useUnsavedChanges("dictionary", isDirty);

  const handleSave = async () => {
    setIsSaving(true);
    try {
      await onSave(dictionaryValue);
      toast.success("Dictionary words saved successfully!");
    } catch (error) {
      console.error("Failed to save dictionary:", error);
      toast.error("Failed to save dictionary");
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <section
      id="dictionary"
      className="border border-gray-200/90 dark:border-[#282b26] rounded-2xl p-6 shadow-2xs space-y-5"
      style={{ backgroundColor: '#1C1E1A' }}
    >
      <div className="space-y-1 pb-2 border-b border-gray-100 dark:border-[#282b26]">
        <div className="flex items-center gap-2">
          <BookA className="w-4 h-4 text-amber-600" />
          <h2 className="text-xl font-normal text-gray-900 dark:text-[#f2f4f0] font-serif tracking-tight">
            Dictionary
          </h2>
        </div>
        <p className="text-xs text-gray-500 dark:text-[#9ca39a]">
          Add words the agent should actively listen for — company jargon, names, industry terms. May incur extra cost depending on provider.
        </p>
      </div>

      <textarea
        rows={3}
        value={dictionaryValue}
        onChange={(e) => setDictionaryValue(e.target.value)}
        placeholder="Enter words separated by comma (e.g. billing department, tretinoin)"
        className="w-full p-3.5 bg-gray-50 dark:bg-[#1a1c18] border border-gray-200 dark:border-[#2e312b] rounded-xl text-xs text-gray-900 dark:text-[#f2f4f0] focus:outline-hidden font-normal leading-relaxed"
      />

      <button
        onClick={handleSave}
        disabled={isSaving || !isDirty}
        className="px-5 py-2.5 bg-black dark:bg-[#bcf0da] hover:bg-gray-800 dark:hover:bg-[#a5e9cc] text-white dark:text-[#082117] text-xs font-bold rounded-full shadow-xs transition-all active:scale-[0.98] disabled:opacity-50 cursor-pointer"
      >
        {isSaving ? "Saving..." : "Save Dictionary"}
      </button>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Section 4: Voicemail Detection
// ---------------------------------------------------------------------------

function VoicemailSection({
  workflowConfigurations,
  workflowName,
  onSave,
}: {
  workflowConfigurations: WorkflowConfigurations;
  workflowName: string;
  onSave: (configurations: WorkflowConfigurations, workflowName: string) => Promise<void>;
}) {
  const getConfig = (): VoicemailDetectionConfiguration => ({
    ...DEFAULT_VOICEMAIL_DETECTION_CONFIGURATION,
    ...workflowConfigurations.voicemail_detection,
  });

  const [enabled, setEnabled] = useState(getConfig().enabled);
  const [useWorkflowLlm, setUseWorkflowLlm] = useState(getConfig().use_workflow_llm);
  const [provider, setProvider] = useState(getConfig().provider || "openai");
  const [model, setModel] = useState(getConfig().model || "gpt-4.1");
  const [apiKey, setApiKey] = useState(getConfig().api_key || "");
  const [systemPrompt, setSystemPrompt] = useState(getConfig().system_prompt || DEFAULT_VOICEMAIL_SYSTEM_PROMPT);
  const [longSpeechTimeout, setLongSpeechTimeout] = useState(getConfig().long_speech_timeout);
  const [isSaving, setIsSaving] = useState(false);

  const isDirty = useMemo(() => {
    const init = {
      ...DEFAULT_VOICEMAIL_DETECTION_CONFIGURATION,
      ...workflowConfigurations.voicemail_detection,
    };
    return (
      enabled !== init.enabled ||
      useWorkflowLlm !== init.use_workflow_llm ||
      provider !== (init.provider || "openai") ||
      model !== (init.model || "gpt-4.1") ||
      apiKey !== (init.api_key || "") ||
      systemPrompt !== (init.system_prompt || DEFAULT_VOICEMAIL_SYSTEM_PROMPT) ||
      longSpeechTimeout !== init.long_speech_timeout
    );
  }, [enabled, useWorkflowLlm, provider, model, apiKey, systemPrompt, longSpeechTimeout, workflowConfigurations]);

  useUnsavedChanges("voicemail", isDirty);

  const handleSave = async () => {
    setIsSaving(true);
    try {
      const voicemailConfig: VoicemailDetectionConfiguration = {
        enabled,
        use_workflow_llm: useWorkflowLlm,
        provider: useWorkflowLlm ? undefined : provider,
        model: useWorkflowLlm ? undefined : model,
        api_key: useWorkflowLlm ? undefined : apiKey,
        system_prompt:
          systemPrompt && systemPrompt !== DEFAULT_VOICEMAIL_SYSTEM_PROMPT ? systemPrompt : undefined,
        long_speech_timeout: longSpeechTimeout,
      };
      await onSave({ ...workflowConfigurations, voicemail_detection: voicemailConfig }, workflowName);
      toast.success("Voicemail settings saved successfully!");
    } catch (error) {
      console.error("Failed to save voicemail settings:", error);
      toast.error("Failed to save voicemail settings");
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <section
      id="voicemail"
      className="border border-gray-200/90 dark:border-[#282b26] rounded-2xl p-6 shadow-2xs space-y-5"
      style={{ backgroundColor: '#1C1E1A' }}
    >
      <div className="space-y-1 pb-2 border-b border-gray-100 dark:border-[#282b26]">
        <div className="flex items-center gap-2">
          <PhoneOff className="w-4 h-4 text-amber-600" />
          <h2 className="text-xl font-normal text-gray-900 dark:text-[#f2f4f0] font-serif tracking-tight">
            Voicemail Detection
          </h2>
        </div>
        <p className="text-xs text-gray-500 dark:text-[#9ca39a]">
          Automatically detect and end calls when a voicemail system is reached.
        </p>
      </div>

      <div className="p-4 bg-gray-50/80 dark:bg-[#1a1c18] border border-gray-200/80 dark:border-[#2e312b] rounded-xl flex items-center justify-between">
        <span className="text-xs font-bold text-gray-900 dark:text-[#f2f4f0]">Enable Voicemail Detection</span>
        <Switch checked={enabled} onCheckedChange={setEnabled} />
      </div>

      {enabled && (
        <div className="space-y-4 pt-2">
          <div className="p-4 bg-gray-50/80 dark:bg-[#1a1c18] border border-gray-200/80 dark:border-[#2e312b] rounded-xl flex items-center justify-between">
            <span className="text-xs font-bold text-gray-900 dark:text-[#f2f4f0]">Use Workflow LLM</span>
            <Switch checked={useWorkflowLlm} onCheckedChange={setUseWorkflowLlm} />
          </div>

          {!useWorkflowLlm && (
            <LLMConfigSelector
              provider={provider}
              onProviderChange={setProvider}
              model={model}
              onModelChange={setModel}
              apiKey={apiKey}
              onApiKeyChange={setApiKey}
            />
          )}

          <div className="space-y-1.5">
            <label className="text-xs font-bold text-gray-900 dark:text-[#f2f4f0]">System Prompt</label>
            <textarea
              rows={6}
              value={systemPrompt}
              onChange={(e) => setSystemPrompt(e.target.value)}
              className="w-full p-3 bg-gray-50 dark:bg-[#1a1c18] border border-gray-200 dark:border-[#2e312b] rounded-xl text-xs font-mono text-gray-900 dark:text-[#f2f4f0] focus:outline-hidden leading-relaxed"
            />
          </div>

          <div className="space-y-1.5">
            <label className="text-xs font-bold text-gray-900 dark:text-[#f2f4f0]">Speech Cutoff (seconds)</label>
            <input
              type="number"
              step="0.5"
              min="1"
              max="30"
              value={longSpeechTimeout}
              onChange={(e) => setLongSpeechTimeout(parseFloat(e.target.value) || 8.0)}
              className="w-full px-3.5 py-2.5 bg-gray-50 dark:bg-[#1a1c18] border border-gray-200 dark:border-[#2e312b] rounded-xl text-xs font-mono text-gray-900 dark:text-[#f2f4f0]"
            />
          </div>
        </div>
      )}

      <button
        onClick={handleSave}
        disabled={isSaving || !isDirty}
        className="px-5 py-2.5 bg-black dark:bg-[#bcf0da] hover:bg-gray-800 dark:hover:bg-[#a5e9cc] text-white dark:text-[#082117] text-xs font-bold rounded-full shadow-xs transition-all active:scale-[0.98] disabled:opacity-50 cursor-pointer"
      >
        {isSaving ? "Saving..." : "Save Voicemail Settings"}
      </button>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Section 5: Report
// ---------------------------------------------------------------------------

function ReportSection({ workflowId }: { workflowId: number }) {
  const [startDate, setStartDate] = useState<Date | undefined>(undefined);
  const [startTime, setStartTime] = useState("00:00");
  const [endDate, setEndDate] = useState<Date | undefined>(undefined);
  const [endTime, setEndTime] = useState("23:59");
  const [isPopoverOpen, setIsPopoverOpen] = useState(false);
  const [isDownloading, setIsDownloading] = useState(false);

  const buildDateTime = (date: Date | undefined, time: string): string | undefined => {
    if (!date) return undefined;
    const [hours, minutes] = time.split(":").map(Number);
    const combined = new Date(date);
    combined.setHours(hours, minutes, 0, 0);
    return combined.toISOString();
  };

  const handleDownload = async () => {
    setIsDownloading(true);
    setIsPopoverOpen(false);
    try {
      const response = await downloadWorkflowReportApiV1WorkflowWorkflowIdReportGet({
        path: { workflow_id: workflowId },
        query: {
          start_date: buildDateTime(startDate, startTime),
          end_date: buildDateTime(endDate, endTime),
        },
        parseAs: "blob",
      });

      if (response.data) {
        const blob = response.data as Blob;
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `workflow_${workflowId}_report.csv`;
        document.body.appendChild(a);
        a.click();
        a.remove();
        window.URL.revokeObjectURL(url);
      } else {
        toast.error("Failed to download report");
      }
    } catch (err) {
      logger.error(`Failed to download workflow report: ${err}`);
      toast.error("Failed to download report");
    } finally {
      setIsDownloading(false);
    }
  };

  return (
    <section
      id="report"
      className="border border-gray-200/90 dark:border-[#282b26] rounded-2xl p-6 shadow-2xs space-y-5"
      style={{ backgroundColor: '#1C1E1A' }}
    >
      <div className="space-y-1 pb-2 border-b border-gray-100 dark:border-[#282b26]">
        <div className="flex items-center gap-2">
          <FileText className="w-4 h-4 text-amber-600" />
          <h2 className="text-xl font-normal text-gray-900 dark:text-[#f2f4f0] font-serif tracking-tight">
            Report
          </h2>
        </div>
        <p className="text-xs text-gray-500 dark:text-[#9ca39a]">
          Download a CSV report of completed runs for this agent, optionally filtered by date range.
        </p>
      </div>

      <Popover open={isPopoverOpen} onOpenChange={setIsPopoverOpen}>
        <PopoverTrigger asChild>
          <button className="px-5 py-2.5 bg-gray-100 dark:bg-[#252822] hover:bg-gray-200 dark:hover:bg-[#2e322a] text-gray-900 dark:text-[#f2f4f0] text-xs font-bold rounded-full transition-all flex items-center gap-2 cursor-pointer">
            <Download className="w-3.5 h-3.5" />
            <span>Download Report</span>
          </button>
        </PopoverTrigger>
        <PopoverContent className="w-auto p-4 border border-[#282b26] rounded-2xl" align="start" style={{ backgroundColor: '#161715' }}>
          <div className="space-y-4 text-white">
            <div className="text-xs font-bold">Filter by date range</div>
            <div className="grid gap-3">
              <div className="space-y-1.5">
                <label className="text-[11px] font-medium text-[#9ca39a]">From</label>
                <div className="flex gap-2">
                  <Popover>
                    <PopoverTrigger asChild>
                      <button className="px-3 py-1.5 bg-[#1a1c18] border border-[#2e312b] rounded-xl text-xs text-[#c8ccc5] flex items-center gap-2">
                        <CalendarIcon className="h-3.5 w-3.5 text-[#9ca39a]" />
                        {startDate ? format(startDate, "MMM dd, yyyy") : "Start date"}
                      </button>
                    </PopoverTrigger>
                    <PopoverContent className="w-auto p-0" align="start">
                      <Calendar
                        mode="single"
                        selected={startDate}
                        onSelect={setStartDate}
                        disabled={(date) => (endDate ? date > endDate : false)}
                      />
                    </PopoverContent>
                  </Popover>
                  <input
                    type="time"
                    value={startTime}
                    onChange={(e) => setStartTime(e.target.value)}
                    className="w-[100px] px-2 py-1 bg-[#1a1c18] border border-[#2e312b] rounded-xl text-xs text-white"
                  />
                </div>
              </div>
              <div className="space-y-1.5">
                <label className="text-[11px] font-medium text-[#9ca39a]">To</label>
                <div className="flex gap-2">
                  <Popover>
                    <PopoverTrigger asChild>
                      <button className="px-3 py-1.5 bg-[#1a1c18] border border-[#2e312b] rounded-xl text-xs text-[#c8ccc5] flex items-center gap-2">
                        <CalendarIcon className="h-3.5 w-3.5 text-[#9ca39a]" />
                        {endDate ? format(endDate, "MMM dd, yyyy") : "End date"}
                      </button>
                    </PopoverTrigger>
                    <PopoverContent className="w-auto p-0" align="start">
                      <Calendar
                        mode="single"
                        selected={endDate}
                        onSelect={setEndDate}
                        disabled={(date) => (startDate ? date < startDate : false)}
                      />
                    </PopoverContent>
                  </Popover>
                  <input
                    type="time"
                    value={endTime}
                    onChange={(e) => setEndTime(e.target.value)}
                    className="w-[100px] px-2 py-1 bg-[#1a1c18] border border-[#2e312b] rounded-xl text-xs text-white"
                  />
                </div>
              </div>
            </div>
            <div className="flex justify-between pt-2 border-t border-[#282b26]">
              <button
                onClick={() => { setStartDate(undefined); setEndDate(undefined); }}
                className="px-3 py-1.5 text-xs text-[#9ca39a] hover:text-white"
              >
                Clear
              </button>
              <button
                onClick={handleDownload}
                disabled={isDownloading}
                className="px-4 py-1.5 bg-[#8b5cf6] hover:bg-[#7c3aed] text-white text-xs font-bold rounded-xl"
              >
                {startDate || endDate ? "Download Filtered" : "Download All"}
              </button>
            </div>
          </div>
        </PopoverContent>
      </Popover>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Section 6: Agent UUID
// ---------------------------------------------------------------------------

function AgentUuidSection({ workflowUuid }: { workflowUuid: string }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(workflowUuid);
      setCopied(true);
      toast.success("Agent UUID copied to clipboard");
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error("Failed to copy Agent UUID");
    }
  };

  return (
    <section
      id="identity"
      className="border border-gray-200/90 dark:border-[#282b26] rounded-2xl p-6 shadow-2xs space-y-5"
      style={{ backgroundColor: '#1C1E1A' }}
    >
      <div className="space-y-1 pb-2 border-b border-gray-100 dark:border-[#282b26]">
        <div className="flex items-center gap-2">
          <Fingerprint className="w-4 h-4 text-amber-600" />
          <h2 className="text-xl font-normal text-gray-900 dark:text-[#f2f4f0] font-serif tracking-tight">
            Agent UUID
          </h2>
        </div>
        <p className="text-xs text-gray-500 dark:text-[#9ca39a]">
          Stable identifier for this agent. Used in agent-stream URLs and other integrations where a numeric workflow ID isn't portable.
        </p>
      </div>

      <div className="flex items-center justify-between p-3.5 bg-gray-50 dark:bg-[#1a1c18] border border-gray-200 dark:border-[#2e312b] rounded-xl">
        <span className="font-mono text-xs text-gray-900 dark:text-[#f2f4f0] font-bold select-all truncate">
          {workflowUuid}
        </span>
        <button
          onClick={handleCopy}
          className="flex items-center gap-1 text-xs font-semibold text-gray-600 dark:text-[#9ca39a] hover:text-black dark:hover:text-white transition-colors ml-3 flex-shrink-0 cursor-pointer"
        >
          <Clipboard className="w-4 h-4" />
          <span>{copied ? "Copied!" : "Copy"}</span>
        </button>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Main Page & Page Wrapper
// ---------------------------------------------------------------------------

export default function WorkflowSettingsPage() {
  const params = useParams();
  const { user, redirectToLogin, loading: authLoading } = useAuth();
  const [workflow, setWorkflow] = useState<WorkflowResponse | undefined>(undefined);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!authLoading && !user) {
      redirectToLogin();
    }
  }, [authLoading, user, redirectToLogin]);

  useEffect(() => {
    const fetchWorkflow = async () => {
      if (!user) return;
      try {
        const response = await getWorkflowApiV1WorkflowFetchWorkflowIdGet({
          path: { workflow_id: Number(params.workflowId) },
        });
        setWorkflow(response.data);
      } catch (err) {
        setError("Failed to fetch workflow");
        logger.error(`Error fetching workflow settings: ${err}`);
      } finally {
        setLoading(false);
      }
    };
    if (user) fetchWorkflow();
  }, [params.workflowId, user]);

  if (loading || authLoading) return <SpinLoader />;

  if (error || !workflow) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#161715] text-white">
        <div className="text-sm text-rose-400 font-semibold">{error || "Workflow not found"}</div>
      </div>
    );
  }

  if (!user) return null;

  return (
    <UnsavedChangesProvider>
      <WorkflowSettingsInner workflow={workflow} user={user} />
    </UnsavedChangesProvider>
  );
}

function WorkflowSettingsInner({
  workflow,
  user,
}: {
  workflow: WorkflowResponse;
  user: { id: string; email?: string };
}) {
  const router = useRouter();
  const { dirtySections, confirmNavigate } = useUnsavedChangesContext();
  const { role: userRole } = useCurrentUserRole();

  const [isEmbedDialogOpen, setIsEmbedDialogOpen] = useState(false);
  const [activeSection, setActiveSection] = useState("general");
  const [saveToast, setSaveToast] = useState<string | null>(null);

  const workflowId = workflow.id;

  const initialFlow = useMemo(
    () => ({
      nodes: workflow.workflow_definition.nodes as FlowNode[],
      edges: workflow.workflow_definition.edges as FlowEdge[],
      viewport: { x: 0, y: 0, zoom: 0 },
    }),
    [workflow],
  );

  const initialTemplateContextVariables = useMemo(
    () => (workflow.template_context_variables as Record<string, string>) || {},
    [workflow],
  );

  const initialWorkflowConfigurations = useMemo(
    () => (workflow.workflow_configurations as WorkflowConfigurations) || DEFAULT_WORKFLOW_CONFIGURATIONS,
    [workflow],
  );

  const {
    workflowName,
    workflowConfigurations,
    templateContextVariables,
    dictionary,
    saveWorkflowConfigurations,
    saveTemplateContextVariables,
    saveDictionary,
  } = useWorkflowState({
    initialWorkflowName: workflow.name,
    workflowId,
    initialFlow,
    initialTemplateContextVariables,
    initialWorkflowConfigurations,
    user,
  });

  const triggerToast = (msg: string) => {
    setSaveToast(msg);
    setTimeout(() => setSaveToast(null), 3000);
  };

  const handleGlobalSave = async () => {
    if (!workflowConfigurations) return;
    try {
      await saveWorkflowConfigurations(workflowConfigurations, workflowName);
      triggerToast("All Agent Settings saved successfully!");
    } catch {
      toast.error("Failed to save changes");
    }
  };

  // Intersection observer for active section
  useEffect(() => {
    const ids = NAV_ITEMS.map((n) => n.id);
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            setActiveSection(entry.target.id);
            break;
          }
        }
      },
      { rootMargin: "-20% 0px -60% 0px" },
    );
    ids.forEach((id) => {
      const el = document.getElementById(id);
      if (el) observer.observe(el);
    });
    return () => observer.disconnect();
  }, []);

  const scrollToSection = (id: string) => {
    setActiveSection(id);
    const el = document.getElementById(id);
    if (el) {
      el.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  };

  return (
    <div
      className="flex-1 h-full overflow-y-auto flex flex-col font-sans select-none relative"
      style={{ backgroundColor: '#161715' }}
    >
      {/* Sticky Top Header */}
      <header
        className="px-8 pt-6 pb-4 flex items-center justify-between sticky top-0 z-20 border-b border-[#242722]"
        style={{ backgroundColor: '#161715' }}
      >
        <div className="flex items-center gap-3">
          <button
            onClick={() => confirmNavigate(() => router.push(`/workflow/${workflowId}`))}
            className="p-1.5 rounded-xl bg-gray-50 dark:bg-[#1a1c18] hover:bg-gray-100 dark:hover:bg-[#232621] text-gray-600 dark:text-[#9ca39a] transition-colors border border-gray-200 dark:border-[#2e312b] cursor-pointer"
            title="Back to Agent Editor"
          >
            <ArrowLeft className="w-4 h-4" />
          </button>

          <div className="space-y-0.5">
            <h1 className="text-base font-semibold text-gray-900 dark:text-[#f2f4f0] tracking-tight flex items-center gap-2">
              <span>{workflowName || workflow.name}</span>
              <span className="px-2 py-0.5 bg-emerald-100 dark:bg-emerald-900/40 text-emerald-800 dark:text-emerald-400 text-[10.5px] font-bold rounded-full">
                Active
              </span>
            </h1>
            <p className="text-xs text-gray-400 dark:text-[#9ca39a]">Agent Configuration & Workflow Settings</p>
          </div>
        </div>

        <button
          onClick={handleGlobalSave}
          className="flex items-center gap-1.5 px-5 py-2 bg-black dark:bg-[#bcf0da] hover:bg-gray-800 dark:hover:bg-[#a5e9cc] text-white dark:text-[#082117] text-xs font-bold rounded-full shadow-xs transition-all active:scale-[0.98] cursor-pointer"
        >
          <Save className="w-3.5 h-3.5" />
          <span>Save Changes</span>
        </button>
      </header>

      {/* Main Content Layout */}
      <div className="max-w-6xl w-full mx-auto px-8 pt-6 pb-20 flex gap-8">
        {/* Left Form Sections */}
        <div className="flex-1 space-y-8 min-w-0">
          {saveToast && (
            <div className="flex items-center justify-between px-4 py-3 bg-emerald-900/30 border border-emerald-800 text-emerald-400 rounded-xl text-xs font-semibold animate-in fade-in duration-300">
              <div className="flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                <span>{saveToast}</span>
              </div>
            </div>
          )}

          {workflowConfigurations && (
            <>
              {/* Section 1: General */}
              <GeneralSection
                workflowConfigurations={workflowConfigurations}
                workflowName={workflowName || workflow.name}
                workflowId={workflowId}
                initialConcurrencyLimit={workflow.concurrency_limit}
                onSave={saveWorkflowConfigurations}
              />

              {/* Section 2: Model Overrides */}
              {userRole !== "client" && (
                <section
                  id="models"
                  className="border border-gray-200/90 dark:border-[#282b26] rounded-2xl p-6 shadow-2xs space-y-6"
                  style={{ backgroundColor: '#1C1E1A' }}
                >
                  <div className="space-y-1 pb-2 border-b border-gray-100 dark:border-[#282b26]">
                    <div className="flex items-center gap-2">
                      <Cpu className="w-4 h-4 text-amber-600" />
                      <h2 className="text-xl font-normal text-gray-900 dark:text-[#f2f4f0] font-serif tracking-tight">
                        Model Overrides
                      </h2>
                    </div>
                    <p className="text-xs text-gray-500 dark:text-[#9ca39a] flex items-center gap-1">
                      <span>Override global model settings for this workflow. Toggle individual services to customize.</span>
                      <a
                        href={SETTINGS_DOCUMENTATION_URLS.modelOverrides}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-amber-700 hover:underline inline-flex items-center gap-0.5"
                      >
                        Learn more <ExternalLink className="w-3 h-3" />
                      </a>
                    </p>
                  </div>

                  <ServiceConfigurationForm
                    mode="override"
                    currentOverrides={workflowConfigurations.model_overrides}
                    submitLabel="Save Model Overrides"
                    onSave={async (config) => {
                      await saveWorkflowConfigurations(
                        {
                          ...workflowConfigurations,
                          model_overrides: config.model_overrides as WorkflowConfigurations["model_overrides"],
                        } as WorkflowConfigurations,
                        workflowName,
                      );
                      toast.success("Model Overrides saved successfully!");
                    }}
                  />
                </section>
              )}

              {/* Section 3: Template Variables */}
              <TemplateVariablesSection
                templateContextVariables={templateContextVariables}
                onSave={saveTemplateContextVariables}
              />

              {/* Section 4: Dictionary */}
              <DictionarySection dictionary={dictionary} onSave={saveDictionary} />

              {/* Section 5: Voicemail Detection */}
              <VoicemailSection
                workflowConfigurations={workflowConfigurations}
                workflowName={workflowName}
                onSave={saveWorkflowConfigurations}
              />

              {/* Section 6: Recordings */}
              <section
                id="recordings"
                className="border border-gray-200/90 dark:border-[#282b26] rounded-2xl p-6 shadow-2xs space-y-5"
                style={{ backgroundColor: '#1C1E1A' }}
              >
                <div className="space-y-1 pb-2 border-b border-gray-100 dark:border-[#282b26]">
                  <div className="flex items-center gap-2">
                    <Mic className="w-4 h-4 text-amber-600" />
                    <h2 className="text-xl font-normal text-gray-900 dark:text-[#f2f4f0] font-serif tracking-tight">
                      Recordings
                    </h2>
                  </div>
                  <p className="text-xs text-gray-500 dark:text-[#9ca39a] flex items-center gap-1">
                    <span>Recordings are now managed at the organization level and shared across all agents. Use @ in prompt fields to insert them.</span>
                    <a
                      href={SETTINGS_DOCUMENTATION_URLS.recordings}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-amber-700 hover:underline inline-flex items-center gap-0.5"
                    >
                      Learn more <ExternalLink className="w-3 h-3" />
                    </a>
                  </p>
                </div>

                <Link
                  href="/recordings"
                  className="px-5 py-2.5 bg-gray-100 dark:bg-[#252822] hover:bg-gray-200 dark:hover:bg-[#2e322a] text-gray-900 dark:text-[#f2f4f0] text-xs font-bold rounded-full transition-all inline-flex items-center gap-2"
                >
                  <span>Go to Recordings</span>
                  <ExternalLink className="w-3.5 h-3.5" />
                </Link>
              </section>

              {/* Section 7: Add to Website */}
              <section
                id="deployment"
                className="border border-gray-200/90 dark:border-[#282b26] rounded-2xl p-6 shadow-2xs space-y-5"
                style={{ backgroundColor: '#1C1E1A' }}
              >
                <div className="space-y-1 pb-2 border-b border-gray-100 dark:border-[#282b26]">
                  <div className="flex items-center gap-2">
                    <Rocket className="w-4 h-4 text-amber-600" />
                    <h2 className="text-xl font-normal text-gray-900 dark:text-[#f2f4f0] font-serif tracking-tight">
                      Add to Website
                    </h2>
                  </div>
                  <p className="text-xs text-gray-500 dark:text-[#9ca39a] flex items-center gap-1">
                    <span>Configure a widget to add this voice agent to your website.</span>
                    <a
                      href={SETTINGS_DOCUMENTATION_URLS.deployment}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-amber-700 hover:underline inline-flex items-center gap-0.5"
                    >
                      Learn more <ExternalLink className="w-3 h-3" />
                    </a>
                  </p>
                </div>

                <button
                  onClick={() => setIsEmbedDialogOpen(true)}
                  className="px-5 py-2.5 bg-gray-100 dark:bg-[#252822] hover:bg-gray-200 dark:hover:bg-[#2e322a] text-gray-900 dark:text-[#f2f4f0] text-xs font-bold rounded-full transition-all cursor-pointer"
                >
                  Configure Widget
                </button>
              </section>

              {/* Section 8: Report */}
              <ReportSection workflowId={workflowId} />

              {/* Section 9: Agent UUID */}
              {workflow.workflow_uuid && <AgentUuidSection workflowUuid={workflow.workflow_uuid} />}
            </>
          )}
        </div>

        {/* Right-side Sticky "On This Page" Nav Sidebar */}
        <div className="w-56 hidden lg:block flex-shrink-0">
          <div className="sticky top-24 space-y-3">
            <h4 className="text-[11px] font-bold uppercase tracking-wider text-gray-400 dark:text-[#6b7068] px-3">
              On This Page
            </h4>

            <nav className="space-y-0.5">
              {NAV_ITEMS.filter((item) => userRole !== "client" || item.id !== "models").map((sec) => {
                const Icon = sec.icon;
                const isActive = activeSection === sec.id;
                const isDirtySection = dirtySections.has(sec.id);
                return (
                  <button
                    key={sec.id}
                    onClick={() => scrollToSection(sec.id)}
                    className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-xl text-xs font-medium transition-all text-left cursor-pointer ${
                      isActive
                        ? "bg-gray-100 dark:bg-white/10 text-gray-900 dark:text-white font-bold shadow-2xs"
                        : "text-gray-500 dark:text-[#9ca39a] hover:text-gray-900 dark:hover:text-white hover:bg-gray-50 dark:hover:bg-white/5"
                    }`}
                  >
                    <Icon className={`w-3.5 h-3.5 ${isActive ? "text-amber-600" : "text-gray-400 dark:text-[#6b7068]"}`} />
                    <span className="truncate flex-1">{sec.label}</span>
                    {isDirtySection && <span className="w-1.5 h-1.5 rounded-full bg-amber-500 flex-shrink-0" />}
                  </button>
                );
              })}
            </nav>
          </div>
        </div>
      </div>

      <EmbedDialog
        open={isEmbedDialogOpen}
        onOpenChange={setIsEmbedDialogOpen}
        workflowId={workflowId}
        workflowName={workflowName || workflow.name}
      />
    </div>
  );
}
