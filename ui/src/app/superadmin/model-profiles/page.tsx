"use client";

import { ArrowLeft, Layers, Plus, Trash2 } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";

import { client } from "@/client/client.gen";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useCurrentUserRole } from "@/hooks/useCurrentUserRole";
import { detailFromError } from "@/lib/apiError";

interface OwnerProfile {
  id: number;
  slug: string;
  display_name: string;
  description: string | null;
  tier: string | null;
  capabilities: string[];
  allowed_org_ids: number[];
  is_active: boolean;
  config: Record<string, unknown>;
}

const TEMPLATE = JSON.stringify(
  {
    llm: { provider: "openai", model: "gpt-4.1", api_key: "sk-..." },
    stt: { provider: "deepgram", model: "nova-3", api_key: "..." },
    tts: { provider: "elevenlabs", model: "eleven_flash_v2_5", voice: "...", api_key: "..." },
  },
  null,
  2,
);

async function api<T>(method: "GET" | "POST" | "PATCH" | "DELETE", path: string, body?: unknown): Promise<T> {
  const res = await client.request<T>({
    method,
    url: `/api/v1/superuser/model-profiles${path}`,
    ...(body !== undefined ? { body: body as Record<string, unknown> } : {}),
  });
  if (res.error) throw new Error(detailFromError(res.error, "Request failed"));
  return res.data as T;
}

export default function ModelProfilesPage() {
  const { isSuperadmin, loading: roleLoading } = useCurrentUserRole();
  const [profiles, setProfiles] = useState<OwnerProfile[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<OwnerProfile | "new" | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setProfiles(await api<OwnerProfile[]>("GET", ""));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to load profiles");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!roleLoading && isSuperadmin) load();
    else if (!roleLoading) setLoading(false);
  }, [roleLoading, isSuperadmin, load]);

  if (roleLoading) return null;
  if (!isSuperadmin) return <div className="p-10 text-sm text-muted-foreground">Platform owner access only.</div>;

  const remove = async (p: OwnerProfile) => {
    if (!confirm(`Delete profile "${p.display_name}"?`)) return;
    try {
      await api("DELETE", `/${p.id}`);
      toast.success("Profile deleted");
      load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to delete");
    }
  };

  return (
    <main className="container mx-auto max-w-5xl space-y-6 p-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <Link href="/superadmin" className="mb-2 inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
            <ArrowLeft className="h-3 w-3" /> Superadmin
          </Link>
          <h1 className="flex items-center gap-2 text-2xl font-bold tracking-tight">
            <Layers className="h-5 w-5 text-emerald-400" /> Model profiles
          </h1>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
            A profile bundles the real LLM / speech providers behind a friendly name. Resellers and clients only ever
            see the name, description and tier - never the providers, models, keys or what they cost you.
            Editing a profile switches the models for every workspace using it.
          </p>
        </div>
        <Button onClick={() => setEditing("new")}>
          <Plus className="mr-1 h-4 w-4" /> New profile
        </Button>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        {profiles.map((p) => (
          <div key={p.id} className="space-y-2 rounded-xl border border-border bg-card p-4">
            <div className="flex items-start justify-between gap-2">
              <div>
                <p className="font-semibold">{p.display_name}{!p.is_active && <span className="ml-2 text-xs text-red-400">inactive</span>}</p>
                <p className="text-xs text-muted-foreground">{p.tier ?? "no tier"} · {p.allowed_org_ids.length ? `${p.allowed_org_ids.length} reseller(s)` : "all resellers"}</p>
              </div>
              <div className="flex gap-1">
                <Button size="sm" variant="outline" onClick={() => setEditing(p)}>Edit</Button>
                <Button size="sm" variant="ghost" onClick={() => remove(p)}><Trash2 className="h-4 w-4 text-red-500" /></Button>
              </div>
            </div>
            {p.description && <p className="text-sm text-muted-foreground">{p.description}</p>}
            <div className="flex flex-wrap gap-1">
              {p.capabilities.map((c) => (
                <span key={c} className="rounded-full border border-border px-2 py-0.5 text-[11px] text-muted-foreground">{c}</span>
              ))}
            </div>
            <p className="font-mono text-[11px] text-muted-foreground">
              {Object.entries(p.config)
                .filter(([, v]) => v && typeof v === "object")
                .map(([k, v]) => `${k}: ${(v as { provider?: string; model?: string }).provider}/${(v as { model?: string }).model ?? ""}`)
                .join("  ·  ")}
            </p>
          </div>
        ))}
        {!loading && profiles.length === 0 && (
          <p className="text-sm text-muted-foreground">No profiles yet. Create one, then assign it to a reseller or client workspace.</p>
        )}
      </div>

      {editing && <ProfileDialog profile={editing === "new" ? null : editing} onClose={() => setEditing(null)} onDone={load} />}
    </main>
  );
}

function ProfileDialog({ profile, onClose, onDone }: { profile: OwnerProfile | null; onClose: () => void; onDone: () => void }) {
  const [name, setName] = useState(profile?.display_name ?? "");
  const [tier, setTier] = useState(profile?.tier ?? "");
  const [description, setDescription] = useState(profile?.description ?? "");
  const [capabilities, setCapabilities] = useState((profile?.capabilities ?? []).join(", "));
  const [allowed, setAllowed] = useState((profile?.allowed_org_ids ?? []).join(", "));
  const [active, setActive] = useState(profile?.is_active ?? true);
  const [config, setConfig] = useState(profile ? JSON.stringify(profile.config, null, 2) : TEMPLATE);
  const [busy, setBusy] = useState(false);

  const save = async () => {
    let parsed: unknown;
    try {
      parsed = JSON.parse(config);
    } catch {
      toast.error("Config is not valid JSON");
      return;
    }
    const body = {
      display_name: name,
      tier: tier || null,
      description: description || null,
      capabilities: capabilities.split(",").map((s) => s.trim()).filter(Boolean),
      allowed_org_ids: allowed.split(",").map((s) => parseInt(s.trim())).filter((n) => Number.isFinite(n)),
      is_active: active,
      config: parsed,
    };
    setBusy(true);
    try {
      if (profile) await api("PATCH", `/${profile.id}`, body);
      else await api("POST", "", body);
      toast.success("Profile saved");
      onDone();
      onClose();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to save");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[88vh] overflow-y-auto sm:max-w-[640px]">
        <DialogHeader>
          <DialogTitle>{profile ? "Edit profile" : "New profile"}</DialogTitle>
          <DialogDescription>Keys already saved show as masked - leave them as they are to keep the stored value.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3 py-2">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1"><Label className="text-xs">Display name (what resellers see)</Label><Input value={name} onChange={(e) => setName(e.target.value)} /></div>
            <div className="space-y-1"><Label className="text-xs">Tier label</Label><Input value={tier} placeholder="Standard / Premium" onChange={(e) => setTier(e.target.value)} /></div>
          </div>
          <div className="space-y-1"><Label className="text-xs">Description</Label><Input value={description} onChange={(e) => setDescription(e.target.value)} /></div>
          <div className="space-y-1"><Label className="text-xs">Highlights (comma separated)</Label><Input value={capabilities} placeholder="Natural voices, Low latency" onChange={(e) => setCapabilities(e.target.value)} /></div>
          <div className="space-y-1"><Label className="text-xs">Only available to reseller org IDs (empty = all)</Label><Input value={allowed} onChange={(e) => setAllowed(e.target.value)} /></div>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} className="h-4 w-4" /> Active</label>
          <div className="space-y-1">
            <Label className="text-xs">Provider configuration (private)</Label>
            <textarea value={config} onChange={(e) => setConfig(e.target.value)} spellCheck={false}
              className="h-64 w-full rounded-md border border-input bg-background p-3 font-mono text-xs focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring" />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={save} disabled={busy || !name.trim()}>Save</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
