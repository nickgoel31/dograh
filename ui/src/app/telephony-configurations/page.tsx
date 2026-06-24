"use client";

import {
  AlertTriangle,
  ChevronRight,
  Copy,
  ExternalLink,
  Pencil,
  Phone,
  Plus,
  Star,
  Trash2,
} from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";

import {
  deleteTelephonyConfigurationApiV1OrganizationsTelephonyConfigsConfigIdDelete,
  getTelephonyConfigurationByIdApiV1OrganizationsTelephonyConfigsConfigIdGet,
  listTelephonyConfigurationsApiV1OrganizationsTelephonyConfigsGet,
  setDefaultOutboundApiV1OrganizationsTelephonyConfigsConfigIdSetDefaultOutboundPost,
} from "@/client/sdk.gen";
import type {
  TelephonyConfigurationDetail,
  TelephonyConfigurationListItem,
} from "@/client/types.gen";
import { ConfigFormDialog } from "@/components/telephony/ConfigFormDialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { useTelephonyConfigWarnings } from "@/context/TelephonyConfigWarningsContext";
import { detailFromError } from "@/lib/apiError";
import { useAuth } from "@/lib/auth";

const PROVIDER_LABELS: Record<string, string> = {
  twilio: "Twilio",
  telnyx: "Telnyx",
  vobiz: "Vobiz",
  plivo: "Plivo",
};

export default function TelephonyConfigurationsPage() {
  const { user, getAccessToken, loading: authLoading } = useAuth();
  const {
    telnyxMissingWebhookPublicKeyCount,
    refresh: refreshWarnings,
  } = useTelephonyConfigWarnings();
  const [items, setItems] = useState<TelephonyConfigurationListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [createOpen, setCreateOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<TelephonyConfigurationDetail | null>(null);
  const [editOpen, setEditOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<TelephonyConfigurationListItem | null>(null);

  const fetchItems = useCallback(async () => {
    if (authLoading || !user) return;
    setLoading(true);
    try {
      const token = await getAccessToken();
      const res = await listTelephonyConfigurationsApiV1OrganizationsTelephonyConfigsGet(
        { headers: { Authorization: `Bearer ${token}` } },
      );
      if (res.error) throw new Error(detailFromError(res.error));
      setItems(res.data?.configurations ?? []);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to load configurations");
    } finally {
      setLoading(false);
    }
  }, [authLoading, user, getAccessToken]);

  const onSaved = useCallback(async () => {
    await fetchItems();
    await refreshWarnings();
  }, [fetchItems, refreshWarnings]);

  useEffect(() => { fetchItems(); }, [fetchItems]);

  const onEdit = async (item: TelephonyConfigurationListItem) => {
    try {
      const token = await getAccessToken();
      const res = await getTelephonyConfigurationByIdApiV1OrganizationsTelephonyConfigsConfigIdGet(
        { headers: { Authorization: `Bearer ${token}` }, path: { config_id: item.id } },
      );
      if (res.error) throw new Error(detailFromError(res.error));
      setEditTarget(res.data ?? null);
      setEditOpen(true);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to load configuration");
    }
  };

  const onSetDefault = async (item: TelephonyConfigurationListItem) => {
    try {
      const token = await getAccessToken();
      const res = await setDefaultOutboundApiV1OrganizationsTelephonyConfigsConfigIdSetDefaultOutboundPost(
        { headers: { Authorization: `Bearer ${token}` }, path: { config_id: item.id } },
      );
      if (res.error) throw new Error(detailFromError(res.error));
      toast.success(`${item.name} is now the default outbound configuration`);
      fetchItems();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to set default");
    }
  };

  const onConfirmDelete = async () => {
    if (!deleteTarget) return;
    try {
      const token = await getAccessToken();
      const res = await deleteTelephonyConfigurationApiV1OrganizationsTelephonyConfigsConfigIdDelete(
        { headers: { Authorization: `Bearer ${token}` }, path: { config_id: deleteTarget.id } },
      );
      if (res.error) throw new Error(detailFromError(res.error));
      toast.success("Configuration deleted");
      setDeleteTarget(null);
      fetchItems();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to delete configuration");
    }
  };

  return (
    <div className="min-h-screen bg-[#08080a] p-6 max-w-[1600px] mx-auto w-full page-enter">
      {/* Page header */}
      <div className="border-b border-[#1d1d22]/50 pb-6 mb-6">
        <div className="flex items-end justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-white">Telephony</h1>
            <p className="text-xs text-zinc-500 mt-1">
              Connect provider accounts to enable outbound calls and receive inbound calls.{" "}
              <a
                href="https://docs.dograh.com/integrations/telephony/overview"
                target="_blank"
                rel="noopener noreferrer"
                className="text-blue-400 hover:underline inline-flex items-center gap-0.5"
              >
                Docs <ExternalLink className="w-3 h-3 inline" />
              </a>
            </p>
          </div>
          <Button className="bg-[#7c3aed] hover:bg-[#8b5cf6] text-white font-bold text-xs px-5 py-2.5 rounded-xl transition-all shadow-lg cursor-pointer" onClick={() => setCreateOpen(true)}>
            <Plus className="h-3.5 w-3.5 mr-1.5 inline" />
            Add Configuration
          </Button>
        </div>
      </div>

      <div className="space-y-4">
        {/* Warning banner */}
        {telnyxMissingWebhookPublicKeyCount > 0 && (
          <div className="flex items-start gap-3 rounded-xl border border-amber-500/15 bg-amber-500/10 px-4 py-3">
            <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5 text-amber-400" />
            <div className="text-xs">
              <p className="font-semibold text-amber-400">Webhook public key not configured</p>
              <p className="text-zinc-400 mt-0.5">
                {telnyxMissingWebhookPublicKeyCount === 1
                  ? "1 Telnyx configuration is"
                  : `${telnyxMissingWebhookPublicKeyCount} Telnyx configurations are`}{" "}
                missing a webhook public key. Copy your public key from Mission Control Portal → Keys &amp; Credentials → Public Key.
              </p>
            </div>
          </div>
        )}

        {/* Loading */}
        {loading ? (
          <div className="space-y-3">
            {[...Array(3)].map((_, i) => (
              <div key={i} className="h-20 rounded-2xl bg-[#111113] border border-[#1d1d22] shimmer" style={{ animationDelay: `${i * 0.08}s` }} />
            ))}
          </div>
        ) : items.length === 0 ? (
          <div className="bg-[#111113] border border-[#1d1d22] rounded-2xl p-12 text-center">
            <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-[#7c3aed]/10 border border-[#7c3aed]/20">
              <Phone className="h-6 w-6 text-[#8b5cf6]" />
            </div>
            <h3 className="text-sm font-semibold text-white mb-1">No telephony configurations</h3>
            <p className="text-xs text-zinc-400 mb-5 max-w-xs mx-auto">
              Add a provider account to enable outbound calls and receive inbound calls.
            </p>
            <Button className="bg-[#7c3aed] hover:bg-[#8b5cf6] text-white font-bold text-xs px-5 py-2.5 rounded-xl transition-all shadow-lg cursor-pointer" onClick={() => setCreateOpen(true)}>
              <Plus className="h-3.5 w-3.5 mr-1.5 inline" />
              Add Configuration
            </Button>
          </div>
        ) : (
          <div className="space-y-2">
            {items.map((item) => (
              <div key={item.id} className="bg-[#111113] border border-[#1d1d22] rounded-2xl hover:border-zinc-700 transition-all">
                <div className="flex items-center justify-between gap-4 px-5 py-4">
                  {/* Provider icon area */}
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-zinc-800/40 border border-zinc-700/50">
                    <Phone className="h-4.5 w-4.5 text-zinc-400" />
                  </div>

                  {/* Info */}
                  <Link
                    href={`/telephony-configurations/${item.id}`}
                    className="flex-1 min-w-0"
                  >
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-sm font-semibold text-zinc-200 hover:text-white transition-colors truncate">{item.name}</span>
                      <span className="bg-[#1c1c1f] text-zinc-400 border border-zinc-700/50 text-[9px] font-bold px-1.5 py-0.5 rounded uppercase">
                        {PROVIDER_LABELS[item.provider] ?? item.provider}
                      </span>
                      {item.is_default_outbound && (
                        <span className="bg-blue-500/15 text-blue-400 text-[9px] font-semibold px-2 py-0.5 rounded-full flex items-center gap-0.5">
                          <Star className="h-2.5 w-2.5 fill-current" />
                          Default
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-3 mt-1">
                      <span className="text-xs text-zinc-400">
                        {item.phone_number_count} {item.phone_number_count === 1 ? "number" : "numbers"}
                      </span>
                      <button
                        type="button"
                        onClick={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          navigator.clipboard
                            .writeText(String(item.id))
                            .then(() => toast.success("Configuration ID copied"))
                            .catch(() => toast.error("Failed to copy ID"));
                        }}
                        className="inline-flex items-center gap-1 rounded font-mono text-[10px] text-zinc-500 hover:text-zinc-300 transition-colors"
                      >
                        ID: {item.id}
                        <Copy className="h-2.5 w-2.5" />
                      </button>
                    </div>
                  </Link>

                  {/* Actions */}
                  <div className="flex items-center gap-1.5 shrink-0">
                    {!item.is_default_outbound && (
                      <Button
                        variant="ghost"
                        className="p-1.5 rounded-lg border border-zinc-700/50 text-zinc-500 hover:text-white transition-colors cursor-pointer bg-transparent"
                        onClick={() => onSetDefault(item)}
                        title="Set as default outbound"
                      >
                        <Star className="h-3.5 w-3.5" />
                      </Button>
                    )}
                    <Button
                      variant="ghost"
                      className="p-1.5 rounded-lg border border-zinc-700/50 text-zinc-500 hover:text-white transition-colors cursor-pointer bg-transparent"
                      onClick={() => onEdit(item)}
                      title="Edit"
                    >
                      <Pencil className="h-3.5 w-3.5" />
                    </Button>
                    <Button
                      variant="ghost"
                      className="p-1.5 rounded-lg border border-zinc-700/50 text-zinc-500 hover:text-rose-400 transition-colors cursor-pointer bg-transparent"
                      onClick={() => setDeleteTarget(item)}
                      title="Delete"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                    <Link
                      href={`/telephony-configurations/${item.id}`}
                      className="inline-flex h-8 w-8 items-center justify-center rounded-xl border border-zinc-700/50 text-zinc-500 hover:text-white transition-colors bg-transparent"
                    >
                      <ChevronRight className="h-4 w-4" />
                    </Link>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <ConfigFormDialog open={createOpen} onOpenChange={setCreateOpen} existing={null} onSaved={onSaved} />
      <ConfigFormDialog open={editOpen} onOpenChange={setEditOpen} existing={editTarget} onSaved={onSaved} />

      <AlertDialog open={!!deleteTarget} onOpenChange={(o) => !o && setDeleteTarget(null)}>
        <AlertDialogContent className="bg-[#111113] border border-[#2c2c35] rounded-2xl w-full max-w-lg p-6 relative shadow-2xl space-y-6 text-white">
          <AlertDialogHeader className="space-y-1">
            <AlertDialogTitle className="text-lg font-bold text-white">Delete configuration?</AlertDialogTitle>
            <AlertDialogDescription className="text-xs text-zinc-500 leading-relaxed">
              <strong className="text-zinc-200">{deleteTarget?.name}</strong> and all of its phone numbers will be removed.
              Any campaigns referencing this configuration must be reassigned first.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="flex gap-3 justify-end pt-2 border-t border-[#1d1d22]/50">
            <AlertDialogCancel className="bg-[#121214] border border-[#232328] hover:bg-[#1a1a1f] px-3 py-1.5 rounded-xl text-xs text-zinc-300 font-medium transition-colors">Cancel</AlertDialogCancel>
            <AlertDialogAction className="bg-[#7c3aed] hover:bg-[#8b5cf6] text-white font-bold text-xs px-5 py-2.5 rounded-xl transition-all shadow-lg cursor-pointer" onClick={onConfirmDelete}>Delete</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
