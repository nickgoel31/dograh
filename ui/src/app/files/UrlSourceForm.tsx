"use client";

import { Globe, Loader2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { addUrlSource, REFRESH_OPTIONS } from "@/lib/knowledgeBaseUrl";

interface UrlSourceFormProps {
  onAdded: () => void;
  onClose: () => void;
}

const FIELD =
  "w-full rounded-xl border border-gray-200 dark:border-[#282b26] px-3 py-2 text-xs text-gray-800 dark:text-white placeholder-gray-400 focus:outline-hidden";

export default function UrlSourceForm({ onAdded, onClose }: UrlSourceFormProps) {
  const [url, setUrl] = useState("");
  const [mode, setMode] = useState<"chunked" | "full_document">("chunked");
  const [refresh, setRefresh] = useState("24");
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    setBusy(true);
    try {
      await addUrlSource({
        url: url.trim(),
        retrieval_mode: mode,
        refresh_interval_hours: refresh === "" ? null : Number(refresh),
      });
      toast.success("Source added. It will be ready in a moment.");
      onAdded();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not add this URL");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="space-y-1.5">
        <label className="text-xs font-semibold text-gray-700 dark:text-gray-300">Page or document link</label>
        <div className="relative">
          <Globe className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
          <input
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://yourcompany.com/pricing"
            className={`${FIELD} pl-9`}
            style={{ backgroundColor: "#161715" }}
          />
        </div>
        <p className="text-[11px] text-gray-500">
          Web pages, PDFs, Word, text, markdown and JSON are supported. Only public addresses can be used.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <label className="text-xs font-semibold text-gray-700 dark:text-gray-300">Keep it up to date</label>
          <select value={refresh} onChange={(e) => setRefresh(e.target.value)} className={FIELD} style={{ backgroundColor: "#161715" }}>
            {REFRESH_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
        </div>
        <div className="space-y-1.5">
          <label className="text-xs font-semibold text-gray-700 dark:text-gray-300">How agents read it</label>
          <select value={mode} onChange={(e) => setMode(e.target.value as "chunked" | "full_document")} className={FIELD} style={{ backgroundColor: "#161715" }}>
            <option value="chunked">Search (best for long pages)</option>
            <option value="full_document">Whole page (best for short pages)</option>
          </select>
        </div>
      </div>

      <p className="text-[11px] text-gray-500">
        Your agents keep using the current version while a refresh runs, and keep it if the page is temporarily
        unreachable.
      </p>

      <div className="flex justify-end gap-2 pt-1">
        <button onClick={onClose} className="rounded-full px-4 py-2 text-xs font-semibold text-gray-400 hover:text-white">
          Cancel
        </button>
        <button
          onClick={submit}
          disabled={busy || !/^https?:\/\//i.test(url.trim())}
          className="flex items-center gap-1.5 rounded-full bg-[#bcf0da] px-5 py-2 text-xs font-bold text-[#082117] disabled:opacity-50"
        >
          {busy && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
          Add source
        </button>
      </div>
    </div>
  );
}
