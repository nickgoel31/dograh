"use client";

import {
  ArrowLeft,
  Check,
  Copy,
  Edit2,
  ExternalLink,
  Pencil,
  Plus,
  Star,
  Trash2,
} from "lucide-react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";

import {
  deletePhoneNumberApiV1OrganizationsTelephonyConfigsConfigIdPhoneNumbersPhoneNumberIdDelete,
  getTelephonyConfigurationByIdApiV1OrganizationsTelephonyConfigsConfigIdGet,
  listPhoneNumbersApiV1OrganizationsTelephonyConfigsConfigIdPhoneNumbersGet,
  setDefaultCallerIdApiV1OrganizationsTelephonyConfigsConfigIdPhoneNumbersPhoneNumberIdSetDefaultCallerPost,
  setDefaultOutboundApiV1OrganizationsTelephonyConfigsConfigIdSetDefaultOutboundPost,
} from "@/client/sdk.gen";
import type {
  PhoneNumberResponse,
  TelephonyConfigurationDetail,
} from "@/client/types.gen";
import { ConfigFormDialog } from "@/components/telephony/ConfigFormDialog";
import { PhoneNumberDialog } from "@/components/telephony/PhoneNumberDialog";
import { Skeleton } from "@/components/ui/skeleton";
import { detailFromError } from "@/lib/apiError";
import { useAuth } from "@/lib/auth";

const INBOUND_WEBHOOK_PATH = "/api/v1/telephony/inbound/run";

function getInboundWebhookUrl(): string {
  const backendUrl =
    process.env.NEXT_PUBLIC_BACKEND_URL ||
    (typeof window !== "undefined" ? window.location.origin : "");
  return `${backendUrl}${INBOUND_WEBHOOK_PATH}`;
}

export default function TelephonyConfigurationDetailPage() {
  const router = useRouter();
  const params = useParams<{ configId: string }>();
  const configId = Number(params.configId);

  const { user, getAccessToken, loading: authLoading } = useAuth();
  const [config, setConfig] = useState<TelephonyConfigurationDetail | null>(null);
  const [phoneNumbers, setPhoneNumbers] = useState<PhoneNumberResponse[]>([]);
  const [loading, setLoading] = useState(true);
  const [editConfigOpen, setEditConfigOpen] = useState(false);
  const [copiedWebhook, setCopiedWebhook] = useState(false);

  const [phoneDialogOpen, setPhoneDialogOpen] = useState(false);
  const [phoneEditTarget, setPhoneEditTarget] = useState<PhoneNumberResponse | null>(null);
  const [phoneDeleteTarget, setPhoneDeleteTarget] = useState<PhoneNumberResponse | null>(null);

  const fetchAll = useCallback(async () => {
    if (authLoading || !user || !configId) return;
    setLoading(true);
    try {
      const token = await getAccessToken();
      const [cfgRes, numbersRes] = await Promise.all([
        getTelephonyConfigurationByIdApiV1OrganizationsTelephonyConfigsConfigIdGet({
          headers: { Authorization: `Bearer ${token}` },
          path: { config_id: configId },
        }),
        listPhoneNumbersApiV1OrganizationsTelephonyConfigsConfigIdPhoneNumbersGet({
          headers: { Authorization: `Bearer ${token}` },
          path: { config_id: configId },
        }),
      ]);

      if (cfgRes.error) throw new Error(detailFromError(cfgRes.error));
      if (numbersRes.error) throw new Error(detailFromError(numbersRes.error));

      setConfig(cfgRes.data ?? null);
      setPhoneNumbers(numbersRes.data?.phone_numbers ?? []);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to load configuration");
    } finally {
      setLoading(false);
    }
  }, [authLoading, user, configId, getAccessToken]);

  useEffect(() => {
    fetchAll();
  }, [fetchAll]);

  const onSetDefaultOutbound = async () => {
    if (!config) return;
    try {
      const token = await getAccessToken();
      const res = await setDefaultOutboundApiV1OrganizationsTelephonyConfigsConfigIdSetDefaultOutboundPost(
        {
          headers: { Authorization: `Bearer ${token}` },
          path: { config_id: config.id },
        },
      );
      if (res.error) throw new Error(detailFromError(res.error));
      toast.success("Set as default outbound");
      fetchAll();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to set default");
    }
  };

  const onSetDefaultCaller = async (n: PhoneNumberResponse) => {
    try {
      const token = await getAccessToken();
      const res = await setDefaultCallerIdApiV1OrganizationsTelephonyConfigsConfigIdPhoneNumbersPhoneNumberIdSetDefaultCallerPost(
        {
          headers: { Authorization: `Bearer ${token}` },
          path: { config_id: configId, phone_number_id: n.id },
        },
      );
      if (res.error) throw new Error(detailFromError(res.error));
      toast.success(`${n.address} is now the default caller ID`);
      fetchAll();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to set default caller");
    }
  };

  const onConfirmDeletePhone = async () => {
    if (!phoneDeleteTarget) return;
    try {
      const token = await getAccessToken();
      const res = await deletePhoneNumberApiV1OrganizationsTelephonyConfigsConfigIdPhoneNumbersPhoneNumberIdDelete(
        {
          headers: { Authorization: `Bearer ${token}` },
          path: {
            config_id: configId,
            phone_number_id: phoneDeleteTarget.id,
          },
        },
      );
      if (res.error) throw new Error(detailFromError(res.error));
      toast.success("Phone number deleted");
      setPhoneDeleteTarget(null);
      fetchAll();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to delete phone number");
    }
  };

  const handleCopyWebhook = () => {
    const url = getInboundWebhookUrl();
    navigator.clipboard.writeText(url);
    setCopiedWebhook(true);
    setTimeout(() => setCopiedWebhook(false), 2000);
  };

  if (loading) {
    return (
      <div className="w-full py-16 flex items-center justify-center">
        <div className="space-y-4">
          <Skeleton className="h-12 w-64" />
          <Skeleton className="h-64 w-96" />
        </div>
      </div>
    );
  }

  if (!config) {
    return (
      <div className="p-8 max-w-5xl mx-auto space-y-4">
        <button
          onClick={() => router.push("/telephony-configurations")}
          className="flex items-center gap-1.5 text-xs font-semibold text-gray-500 hover:text-gray-900 dark:hover:text-white transition-colors"
        >
          <ArrowLeft className="w-3.5 h-3.5" /> Back
        </button>
        <p className="text-sm text-gray-400">Configuration not found.</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full text-gray-900 dark:text-white font-sans select-none relative" style={{ backgroundColor: '#161715' }}>
      {/* Top Header */}
      <header className="px-8 pt-6 pb-2 flex items-center justify-between sticky top-0 z-20 border-b border-gray-100 dark:border-[#282b26]" style={{ backgroundColor: '#161715' }}>
        <button
          onClick={() => router.push("/telephony-configurations")}
          className="flex items-center gap-1.5 text-xs font-semibold text-gray-500 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white transition-colors cursor-pointer"
        >
          <ArrowLeft className="w-3.5 h-3.5" />
          <span>All configurations</span>
        </button>
      </header>

      <div className="max-w-5xl w-full mx-auto px-8 pt-6 pb-16 flex flex-col gap-6">
        {/* Top Config Header Card */}
        <div
          className="border border-gray-200/90 dark:border-[#282b26] rounded-2xl p-6 shadow-2xs space-y-6"
          style={{ backgroundColor: '#1C1E1A' }}
        >
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div className="space-y-1">
              <div className="flex items-center gap-2 flex-wrap">
                <h2 className="text-xl font-bold text-gray-900 dark:text-white">
                  {config.name}
                </h2>
                <span className="px-2 py-0.5 bg-gray-100 dark:bg-[#282b26] text-gray-700 dark:text-gray-300 font-mono text-[10px] font-bold rounded uppercase">
                  {config.provider}
                </span>
                {config.is_default_outbound && (
                  <span className="px-2.5 py-0.5 bg-amber-100 dark:bg-amber-900/40 text-amber-800 dark:text-amber-300 text-[11px] font-bold rounded-full flex items-center gap-1">
                    <Star className="w-3 h-3 fill-amber-500 text-amber-500" />
                    Default
                  </span>
                )}
              </div>
              <p className="text-xs text-gray-400 dark:text-gray-500">
                Updated {new Date(config.updated_at).toLocaleString()} • Configuration ID: {config.id}
              </p>
            </div>

            <div className="flex items-center gap-2">
              {!config.is_default_outbound && (
                <button
                  onClick={onSetDefaultOutbound}
                  className="flex items-center gap-1.5 px-4 py-2 bg-gray-100 dark:bg-[#161715] hover:bg-gray-200 dark:hover:bg-[#232621] text-gray-900 dark:text-gray-200 text-xs font-semibold rounded-full transition-all cursor-pointer"
                >
                  <Star className="w-3.5 h-3.5" />
                  <span>Set as default</span>
                </button>
              )}
              <button
                onClick={() => setEditConfigOpen(true)}
                className="flex items-center gap-1.5 px-4 py-2 bg-gray-100 dark:bg-[#161715] hover:bg-gray-200 dark:hover:bg-[#232621] text-gray-900 dark:text-gray-200 text-xs font-semibold rounded-full transition-all cursor-pointer"
              >
                <Edit2 className="w-3.5 h-3.5" />
                <span>Edit credentials</span>
              </button>
            </div>
          </div>

          {/* Credentials Box */}
          <div
            className="border border-gray-200/70 dark:border-[#282b26] rounded-xl p-4 grid grid-cols-1 md:grid-cols-3 gap-4 text-xs"
            style={{ backgroundColor: '#161715' }}
          >
            {Object.entries(config.credentials ?? {}).map(([k, v]) => (
              <div key={k}>
                <span className="text-gray-400 dark:text-gray-500 font-mono text-[11px]">{k}</span>
                <p className="font-mono font-bold text-gray-800 dark:text-gray-200 pt-0.5 truncate">
                  {String(v ?? "")}
                </p>
              </div>
            ))}
          </div>

          {/* Inbound Webhook URL */}
          <div className="space-y-1.5">
            <label className="text-xs font-semibold text-gray-500 dark:text-gray-400">
              Inbound webhook URL
            </label>
            <div
              className="flex items-center justify-between p-3 border border-gray-200 dark:border-[#282b26] rounded-xl"
              style={{ backgroundColor: '#161715' }}
            >
              <span className="font-mono text-xs text-gray-800 dark:text-gray-200 truncate">
                {getInboundWebhookUrl()}
              </span>
              <button
                onClick={handleCopyWebhook}
                className="flex items-center gap-1 text-xs font-semibold text-gray-600 dark:text-gray-400 hover:text-black dark:hover:text-white transition-colors ml-2 flex-shrink-0 cursor-pointer"
              >
                {copiedWebhook ? (
                  <Check className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
                ) : (
                  <Copy className="w-4 h-4" />
                )}
              </button>
            </div>
          </div>
        </div>

        {/* Phone Numbers Section Card */}
        <div
          className="border border-gray-200/90 dark:border-[#282b26] rounded-2xl p-6 shadow-2xs space-y-6"
          style={{ backgroundColor: '#1C1E1A' }}
        >
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div className="space-y-1">
              <h3 className="text-sm font-bold text-gray-900 dark:text-white">
                Phone numbers
              </h3>
              <p className="text-xs text-gray-500 dark:text-gray-400 max-w-xl leading-relaxed">
                Numbers used as caller ID for outbound and accepted for inbound matching. SIP URIs and extensions are supported alongside PSTN numbers.{" "}
                <a
                  href="https://docs.dograh.com/integrations/telephony/inbound"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-amber-700 dark:text-amber-400 hover:underline"
                >
                  Inbound docs
                </a>
              </p>
            </div>

            <button
              onClick={() => {
                setPhoneEditTarget(null);
                setPhoneDialogOpen(true);
              }}
              className="flex items-center gap-1.5 px-4 py-2 bg-black dark:bg-[#bcf0da] hover:bg-gray-800 dark:hover:bg-[#a5e9cd] text-white dark:text-[#082117] text-xs font-bold rounded-full shadow-xs transition-all active:scale-[0.98] w-fit flex-shrink-0 cursor-pointer"
            >
              <Plus className="w-3.5 h-3.5 stroke-[2.5]" />
              <span>Add phone number</span>
            </button>
          </div>

          {/* Phone Numbers Table */}
          {phoneNumbers.length === 0 ? (
            <p className="text-xs text-gray-400 dark:text-gray-500 py-4">
              No phone numbers yet. Add one to start placing or receiving calls on this configuration.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="border-b border-gray-200 dark:border-[#282b26] text-gray-400 dark:text-gray-500 font-semibold uppercase tracking-wider text-[10.5px]">
                    <th className="pb-3 px-2">Address</th>
                    <th className="pb-3 px-2">Type</th>
                    <th className="pb-3 px-2">Label</th>
                    <th className="pb-3 px-2">Status</th>
                    <th className="pb-3 px-2">Inbound workflow</th>
                    <th className="pb-3 px-2 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100 dark:divide-[#282b26]">
                  {phoneNumbers.map((num) => (
                    <tr key={num.id} className="hover:bg-gray-50/60 dark:hover:bg-[#161715]/60 transition-colors">
                      <td className="py-3.5 px-2 font-semibold font-mono text-gray-900 dark:text-white">
                        {num.address}
                      </td>
                      <td className="py-3.5 px-2">
                        <span className="px-2 py-0.5 bg-gray-100 dark:bg-[#282b26] font-bold text-[10px] text-gray-700 dark:text-gray-300 rounded uppercase">
                          {num.address_type}
                        </span>
                      </td>
                      <td className="py-3.5 px-2 text-gray-700 dark:text-gray-300 font-medium">
                        {num.label ?? "-"}
                      </td>
                      <td className="py-3.5 px-2">
                        <div className="flex items-center gap-1.5 flex-wrap">
                          {num.is_active ? (
                            <span className="px-2 py-0.5 bg-emerald-100 dark:bg-emerald-950/50 text-emerald-800 dark:text-emerald-400 font-bold text-[10.5px] rounded-full">
                              Active
                            </span>
                          ) : (
                            <span className="px-2 py-0.5 bg-gray-200 dark:bg-[#282b26] text-gray-700 dark:text-gray-400 font-bold text-[10.5px] rounded-full">
                              Inactive
                            </span>
                          )}
                          {num.is_default_caller_id && (
                            <span className="px-2 py-0.5 bg-amber-100 dark:bg-amber-900/40 text-amber-800 dark:text-amber-300 text-[10.5px] font-bold rounded-full flex items-center gap-1">
                              <Star className="w-2.5 h-2.5 fill-amber-500 text-amber-500" />
                              Default caller
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="py-3.5 px-2 text-gray-400 dark:text-gray-500">
                        {num.inbound_workflow_id ? (
                          <Link
                            href={`/workflow/${num.inbound_workflow_id}`}
                            className="inline-flex items-center gap-1 hover:underline hover:text-amber-700 dark:hover:text-amber-400 transition-colors"
                          >
                            <span>#{num.inbound_workflow_id}</span>
                            {num.inbound_workflow_name && (
                              <span
                                className="truncate max-w-[160px] text-gray-400"
                                title={num.inbound_workflow_name}
                              >
                                ({num.inbound_workflow_name})
                              </span>
                            )}
                          </Link>
                        ) : (
                          "-"
                        )}
                      </td>
                      <td className="py-3.5 px-2 text-right">
                        <div className="flex items-center justify-end gap-2">
                          {!num.is_default_caller_id && num.is_active && (
                            <button
                              onClick={() => onSetDefaultCaller(num)}
                              className="p-1 text-gray-400 hover:text-amber-500 cursor-pointer"
                              title="Set as default caller ID"
                            >
                              <Star className="w-3.5 h-3.5" />
                            </button>
                          )}
                          <button
                            onClick={() => {
                              setPhoneEditTarget(num);
                              setPhoneDialogOpen(true);
                            }}
                            className="p-1 text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 cursor-pointer"
                            title="Edit"
                          >
                            <Pencil className="w-3.5 h-3.5" />
                          </button>
                          <button
                            onClick={() => setPhoneDeleteTarget(num)}
                            className="p-1 text-gray-400 hover:text-red-600 cursor-pointer"
                            title="Delete"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      <ConfigFormDialog
        open={editConfigOpen}
        onOpenChange={setEditConfigOpen}
        existing={config}
        onSaved={fetchAll}
      />

      <PhoneNumberDialog
        open={phoneDialogOpen}
        onOpenChange={setPhoneDialogOpen}
        configId={configId}
        existing={phoneEditTarget}
        onSaved={fetchAll}
      />

      {/* Delete Phone Number Confirmation Modal */}
      {phoneDeleteTarget && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-xs z-50 flex items-center justify-center p-4">
          <div
            className="border border-gray-200 dark:border-[#282b26] rounded-2xl p-6 w-full max-w-lg shadow-2xl space-y-6 text-gray-900 dark:text-white"
            style={{ backgroundColor: '#1C1E1A' }}
          >
            <div className="space-y-1">
              <h3 className="text-base font-bold text-gray-900 dark:text-white">Delete phone number?</h3>
              <p className="text-xs text-gray-500 dark:text-gray-400 leading-relaxed">
                <strong className="text-gray-900 dark:text-white">{phoneDeleteTarget.address}</strong> will no longer accept inbound calls or be
                available as a caller ID for this configuration.
              </p>
            </div>
            <div className="flex items-center justify-end gap-3 pt-2 border-t border-gray-100 dark:border-[#282b26]">
              <button
                onClick={() => setPhoneDeleteTarget(null)}
                className="px-4 py-2 bg-gray-100 dark:bg-[#161715] text-gray-700 dark:text-gray-300 text-xs font-semibold rounded-full cursor-pointer"
              >
                Cancel
              </button>
              <button
                onClick={onConfirmDeletePhone}
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
