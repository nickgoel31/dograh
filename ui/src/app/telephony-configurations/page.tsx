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
import { useRouter } from "next/navigation";
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
import { Skeleton } from "@/components/ui/skeleton";
import { useTelephonyConfigWarnings } from "@/context/TelephonyConfigWarningsContext";
import { detailFromError } from "@/lib/apiError";
import { useAuth } from "@/lib/auth";

const PROVIDER_LABELS: Record<string, string> = {
  twilio: "Twilio",
  telnyx: "Telnyx",
  vobiz: "Vobiz",
  plivo: "Plivo",
  asterisk: "Asterisk ARI",
};

export default function TelephonyConfigurationsPage() {
  const router = useRouter();
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
    <div className="flex flex-col h-full text-gray-900 dark:text-white font-sans select-none relative" style={{ backgroundColor: '#161715' }}>
      {/* Sticky Top Header matching demo styling */}
      <header className="px-8 pt-6 pb-3 flex items-center justify-between sticky top-0 z-20 border-b border-gray-100 dark:border-[#282b26]" style={{ backgroundColor: '#161715' }}>
        <div className="space-y-0.5">
          <h1 className="text-base font-semibold text-gray-900 dark:text-white tracking-tight">
            Telephony
          </h1>
          <p className="text-xs text-gray-500 dark:text-gray-400 flex items-center gap-1">
            <span>Connect provider accounts to enable outbound calls and receive inbound calls.</span>
            <a
              href="https://docs.dograh.com/integrations/telephony/overview"
              target="_blank"
              rel="noopener noreferrer"
              className="text-amber-700 dark:text-amber-400 hover:underline flex items-center gap-0.5 font-medium"
            >
              <span>Docs</span>
              <ExternalLink className="w-3 h-3" />
            </a>
          </p>
        </div>

        <button
          onClick={() => setCreateOpen(true)}
          className="flex items-center gap-1.5 px-4 py-2 bg-black dark:bg-[#bcf0da] hover:bg-gray-800 dark:hover:bg-[#a5e9cd] text-white dark:text-[#082117] text-xs font-bold rounded-full shadow-xs transition-all active:scale-[0.98] cursor-pointer"
        >
          <Plus className="w-3.5 h-3.5 stroke-[2.5]" />
          <span>Add Configuration</span>
        </button>
      </header>

      {/* Main Workspace List */}
      <div className="max-w-5xl w-full mx-auto px-8 pt-6 pb-16 flex flex-col gap-4">
        {/* Warning banner */}
        {telnyxMissingWebhookPublicKeyCount > 0 && (
          <div className="flex items-start gap-3 rounded-xl border border-amber-500/20 bg-amber-500/10 px-4 py-3 text-xs">
            <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5 text-amber-400" />
            <div>
              <p className="font-semibold text-amber-400">Webhook public key not configured</p>
              <p className="text-gray-400 dark:text-gray-300 mt-0.5">
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
              <div key={i} className="h-20 rounded-2xl border border-gray-200 dark:border-[#282b26] shimmer" style={{ backgroundColor: '#1C1E1A', animationDelay: `${i * 0.08}s` }} />
            ))}
          </div>
        ) : items.length === 0 ? (
          <div className="border border-gray-200/90 dark:border-[#282b26] rounded-2xl p-12 text-center" style={{ backgroundColor: '#1C1E1A' }}>
            <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-amber-100 dark:bg-amber-900/30 text-amber-800 dark:text-amber-400">
              <Phone className="h-6 w-6" />
            </div>
            <h3 className="text-sm font-semibold text-gray-900 dark:text-white mb-1">No telephony configurations</h3>
            <p className="text-xs text-gray-400 dark:text-gray-500 mb-5 max-w-xs mx-auto">
              Add a provider account to enable outbound calls and receive inbound calls.
            </p>
            <button
              onClick={() => setCreateOpen(true)}
              className="px-5 py-2.5 bg-black dark:bg-[#bcf0da] hover:bg-gray-800 dark:hover:bg-[#a5e9cd] text-white dark:text-[#082117] text-xs font-bold rounded-full shadow-xs transition-all cursor-pointer"
            >
              <Plus className="h-3.5 w-3.5 mr-1.5 inline stroke-[2.5]" />
              Add Configuration
            </button>
          </div>
        ) : (
          <div className="space-y-3">
            {items.map((item) => (
              <div
                key={item.id}
                onClick={() => router.push(`/telephony-configurations/${item.id}`)}
                className="p-5 border border-gray-200/90 dark:border-[#282b26] rounded-2xl flex items-center justify-between transition-all cursor-pointer shadow-2xs group hover:border-gray-300 dark:hover:border-[#383c35]"
                style={{ backgroundColor: '#1C1E1A' }}
              >
                <div className="flex items-center gap-4">
                  <div className="w-10 h-10 rounded-xl bg-gray-100 dark:bg-[#161715] flex items-center justify-center text-gray-700 dark:text-gray-300 group-hover:bg-amber-100 dark:group-hover:bg-amber-900/40 group-hover:text-amber-800 dark:group-hover:text-amber-300 transition-colors">
                    <Phone className="w-5 h-5" />
                  </div>

                  <div className="space-y-0.5">
                    <div className="flex items-center gap-2 flex-wrap">
                      <h3 className="text-sm font-bold text-gray-900 dark:text-white group-hover:text-amber-800 dark:group-hover:text-amber-400 transition-colors">
                        {item.name}
                      </h3>
                      <span className="px-2 py-0.5 bg-gray-100 dark:bg-[#282b26] font-mono text-[10px] font-bold text-gray-700 dark:text-gray-300 rounded uppercase">
                        {PROVIDER_LABELS[item.provider] ?? item.provider}
                      </span>
                      {item.is_default_outbound && (
                        <span className="px-2.5 py-0.5 bg-amber-100 dark:bg-amber-900/40 text-amber-800 dark:text-amber-300 text-[11px] font-bold rounded-full flex items-center gap-1">
                          <Star className="w-3 h-3 fill-amber-500 text-amber-500" />
                          Default
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-gray-400 dark:text-gray-500">
                      {item.phone_number_count} {item.phone_number_count === 1 ? "number" : "numbers"} • ID: {item.id}
                    </p>
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  {!item.is_default_outbound && (
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        onSetDefault(item);
                      }}
                      className="p-2 rounded-lg text-gray-400 hover:text-amber-500 dark:hover:text-amber-400 cursor-pointer"
                      title="Set as default outbound"
                    >
                      <Star className="w-4 h-4" />
                    </button>
                  )}
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      onEdit(item);
                    }}
                    className="p-2 rounded-lg text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 cursor-pointer"
                    title="Edit credentials"
                  >
                    <Pencil className="w-4 h-4" />
                  </button>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      setDeleteTarget(item);
                    }}
                    className="p-2 rounded-lg text-gray-400 hover:text-red-600 cursor-pointer"
                    title="Delete"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                  <ChevronRight className="w-5 h-5 text-gray-400 group-hover:text-gray-700 dark:group-hover:text-gray-200 group-hover:translate-x-0.5 transition-all" />
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <ConfigFormDialog open={createOpen} onOpenChange={setCreateOpen} existing={null} onSaved={onSaved} />
      <ConfigFormDialog open={editOpen} onOpenChange={setEditOpen} existing={editTarget} onSaved={onSaved} />

      {/* Delete Confirmation Modal */}
      {deleteTarget && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-xs z-50 flex items-center justify-center p-4">
          <div
            className="border border-gray-200 dark:border-[#282b26] rounded-2xl p-6 w-full max-w-lg shadow-2xl space-y-6 text-gray-900 dark:text-white"
            style={{ backgroundColor: '#1C1E1A' }}
          >
            <div className="space-y-1">
              <h3 className="text-base font-bold text-gray-900 dark:text-white">Delete configuration?</h3>
              <p className="text-xs text-gray-500 dark:text-gray-400 leading-relaxed">
                <strong className="text-gray-900 dark:text-white">{deleteTarget.name}</strong> and all of its phone numbers will be removed.
                Any campaigns referencing this configuration must be reassigned first.
              </p>
            </div>
            <div className="flex items-center justify-end gap-3 pt-2 border-t border-gray-100 dark:border-[#282b26]">
              <button
                onClick={() => setDeleteTarget(null)}
                className="px-4 py-2 bg-gray-100 dark:bg-[#161715] text-gray-700 dark:text-gray-300 text-xs font-semibold rounded-full cursor-pointer"
              >
                Cancel
              </button>
              <button
                onClick={onConfirmDelete}
                className="px-5 py-2.5 bg-red-600 hover:bg-red-500 text-white text-xs font-bold rounded-full shadow-xs cursor-pointer"
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
