"use client";

import {
  ArrowLeft,
  Copy,
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
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
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

  const [phoneDialogOpen, setPhoneDialogOpen] = useState(false);
  const [phoneEditTarget, setPhoneEditTarget] = useState<PhoneNumberResponse | null>(
    null,
  );
  const [phoneDeleteTarget, setPhoneDeleteTarget] = useState<PhoneNumberResponse | null>(
    null,
  );

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

  if (loading) {
    return (
      <div className="container mx-auto px-4 py-8 space-y-3">
        <Skeleton className="h-10 w-1/3" />
        <Skeleton className="h-32 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  if (!config) {
    return (
      <div className="container mx-auto px-4 py-8">
        <Button variant="ghost" onClick={() => router.push("/telephony-configurations")}>
          <ArrowLeft className="h-4 w-4 mr-2" /> Back
        </Button>
        <p className="mt-4 text-muted-foreground">Configuration not found.</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#08080a] p-6 max-w-[1600px] mx-auto w-full page-enter space-y-6">
      <div>
        <Link
          href="/telephony-configurations"
          className="inline-flex items-center text-xs text-zinc-400 hover:text-white transition-colors"
        >
          <ArrowLeft className="h-4 w-4 mr-1" /> All configurations
        </Link>
      </div>

      <Card className="bg-[#111113] border border-[#1d1d22] rounded-2xl p-6 shadow-none">
        <CardHeader className="flex flex-row items-start justify-between gap-4 p-0 pb-6 mb-6 border-b border-[#1d1d22]/50">
          <div className="space-y-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <CardTitle className="truncate text-lg font-bold text-white">{config.name}</CardTitle>
              <span className="bg-[#1c1c1f] text-zinc-400 border border-zinc-700/50 text-[9px] font-bold px-1.5 py-0.5 rounded uppercase">{config.provider}</span>
              {config.is_default_outbound && (
                <span className="bg-blue-500/15 text-blue-400 text-[9px] font-semibold px-2 py-0.5 rounded-full flex items-center gap-0.5">
                  <Star className="h-3 w-3 fill-current" />
                  Default
                </span>
              )}
            </div>
            <CardDescription className="text-xs text-zinc-500">
              Updated {new Date(config.updated_at).toLocaleString()}
            </CardDescription>
            <button
              type="button"
              onClick={() => {
                navigator.clipboard
                  .writeText(String(config.id))
                  .then(() => toast.success("Configuration ID copied"))
                  .catch(() => toast.error("Failed to copy ID"));
              }}
              title="Click to copy"
              className="inline-flex items-center gap-1 self-start rounded font-mono text-[9px] text-zinc-500 hover:text-zinc-300 transition-colors mt-1"
            >
              <span className="truncate">Configuration ID: {config.id}</span>
              <Copy className="h-3 w-3 shrink-0" />
            </button>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {!config.is_default_outbound && (
              <Button className="bg-[#121214] border border-[#232328] hover:bg-[#1a1a1f] px-3 py-1.5 rounded-xl text-xs text-zinc-300 font-medium transition-colors cursor-pointer" onClick={onSetDefaultOutbound}>
                <Star className="h-4 w-4 mr-2" /> Set as default
              </Button>
            )}
            <Button className="bg-[#1c1c1f] hover:bg-[#27272a] text-xs font-semibold py-2 px-4 rounded-xl text-zinc-300 transition-colors border border-zinc-700/50 cursor-pointer" onClick={() => setEditConfigOpen(true)}>
              <Pencil className="h-4 w-4 mr-2" /> Edit credentials
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-4 p-0">
          <div className="bg-[#08080a] border border-[#1d1d22] rounded-xl p-4">
            <dl className="grid grid-cols-2 gap-x-6 gap-y-2 text-xs">
              {Object.entries(config.credentials ?? {}).map(([k, v]) => (
                <div key={k} className="flex justify-between gap-3 border-b border-[#1d1d22]/50 pb-1.5 last:border-0 last:pb-0">
                  <dt className="text-zinc-400 font-medium">{k}</dt>
                  <dd className="font-mono text-right text-white truncate max-w-[60%]">
                    {String(v ?? "")}
                  </dd>
                </div>
              ))}
            </dl>
          </div>
          <div className="space-y-1">
            <p className="text-[10px] text-zinc-500 mt-1 leading-snug">Inbound webhook URL</p>
            <button
              type="button"
              onClick={() => {
                const url = getInboundWebhookUrl();
                navigator.clipboard
                  .writeText(url)
                  .then(() => toast.success("Inbound webhook URL copied"))
                  .catch(() => toast.error("Failed to copy URL"));
              }}
              title="Click to copy inbound webhook URL"
              aria-label="Copy inbound webhook URL"
              className="inline-flex items-center gap-1 self-start rounded font-mono text-xs text-zinc-400 hover:text-white transition-colors"
            >
              <span className="truncate">{getInboundWebhookUrl()}</span>
              <Copy className="h-3 w-3 shrink-0" />
            </button>
          </div>
        </CardContent>
      </Card>

      <Card className="bg-[#111113] border border-[#1d1d22] rounded-2xl p-6 shadow-none">
        <CardHeader className="flex flex-row items-start justify-between gap-4 p-0 pb-6 mb-6 border-b border-[#1d1d22]/50">
          <div className="space-y-1">
            <CardTitle className="text-lg font-bold text-white">Phone numbers</CardTitle>
            <CardDescription className="text-xs text-zinc-500 leading-relaxed">
              Numbers used as caller ID for outbound and accepted for inbound matching.
              SIP URIs and extensions are supported alongside PSTN numbers.{" "}
              <a
                href="https://docs.dograh.com/integrations/telephony/inbound"
                target="_blank"
                rel="noopener noreferrer"
                className="text-blue-400 hover:underline inline-flex items-center gap-0.5"
              >
                Inbound docs <ExternalLink className="h-3 w-3 inline" />
              </a>
            </CardDescription>
          </div>
          <Button
            className="bg-[#7c3aed] hover:bg-[#8b5cf6] text-white font-bold text-xs px-5 py-2.5 rounded-xl transition-all shadow-lg cursor-pointer"
            onClick={() => {
              setPhoneEditTarget(null);
              setPhoneDialogOpen(true);
            }}
          >
            <Plus className="h-4 w-4 mr-2 inline" /> Add phone number
          </Button>
        </CardHeader>
        <CardContent className="p-0">
          {phoneNumbers.length === 0 ? (
            <p className="text-xs text-zinc-400">
              No phone numbers yet. Add one to start placing or receiving calls on this
              configuration.
            </p>
          ) : (
            <Table className="w-full text-left text-xs border-collapse">
              <TableHeader>
                <TableRow className="border-b border-[#1d1d22] text-zinc-500 font-medium">
                  <TableHead className="pb-3 font-medium">Address</TableHead>
                  <TableHead className="pb-3 font-medium">Type</TableHead>
                  <TableHead className="pb-3 font-medium">Label</TableHead>
                  <TableHead className="pb-3 font-medium">Status</TableHead>
                  <TableHead className="pb-3 font-medium">Inbound workflow</TableHead>
                  <TableHead className="pb-3 font-medium text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody className="divide-y divide-[#1d1d22]/50">
                {phoneNumbers.map((n) => (
                  <TableRow key={n.id} className="group hover:bg-white/1 transition-colors">
                    <TableCell className="py-3.5 font-mono text-zinc-300">{n.address}</TableCell>
                    <TableCell className="py-3.5">
                      <span className="bg-[#1c1c1f] text-zinc-400 border border-zinc-700/50 text-[9px] font-bold px-1.5 py-0.5 rounded uppercase">{n.address_type}</span>
                    </TableCell>
                    <TableCell className="py-3.5 text-zinc-400">
                      {n.label ?? "-"}
                    </TableCell>
                    <TableCell className="py-3.5">
                      <div className="flex flex-wrap gap-1">
                        {n.is_active ? (
                          <span className="bg-emerald-500/10 text-emerald-400 border border-emerald-500/15 text-[10px] font-semibold px-2.5 py-0.5 rounded-full">Active</span>
                        ) : (
                          <span className="bg-zinc-800 text-zinc-400 border border-zinc-700/50 text-[10px] font-semibold px-2.5 py-0.5 rounded-full">Inactive</span>
                        )}
                        {n.is_default_caller_id && (
                          <span className="bg-blue-500/15 text-blue-400 text-[9px] font-semibold px-2 py-0.5 rounded-full flex items-center gap-0.5">
                            <Star className="h-3 w-3 fill-current" /> Default caller
                          </span>
                        )}
                      </div>
                    </TableCell>
                    <TableCell className="py-3.5 text-zinc-400">
                      {n.inbound_workflow_id ? (
                        <Link
                          href={`/workflow/${n.inbound_workflow_id}`}
                          className="inline-flex items-center gap-1 hover:underline hover:text-white transition-colors"
                        >
                          <span>#{n.inbound_workflow_id}</span>
                          {n.inbound_workflow_name && (
                            <span
                              className="truncate max-w-[160px] text-zinc-500"
                              title={n.inbound_workflow_name}
                            >
                              {n.inbound_workflow_name.length > 24
                                ? `${n.inbound_workflow_name.slice(0, 24)}…`
                                : n.inbound_workflow_name}
                            </span>
                          )}
                        </Link>
                      ) : (
                        "-"
                      )}
                    </TableCell>
                    <TableCell className="py-3.5 text-right">
                      <div className="flex justify-end gap-1.5">
                        {!n.is_default_caller_id && n.is_active && (
                          <Button
                            variant="ghost"
                            className="p-1.5 rounded-lg border border-zinc-700/50 text-zinc-500 hover:text-white transition-colors cursor-pointer bg-transparent"
                            onClick={() => onSetDefaultCaller(n)}
                            title="Set as default caller ID"
                          >
                            <Star className="h-4 w-4" />
                          </Button>
                        )}
                        <Button
                          variant="ghost"
                          className="p-1.5 rounded-lg border border-zinc-700/50 text-zinc-500 hover:text-white transition-colors cursor-pointer bg-transparent"
                          onClick={() => {
                            setPhoneEditTarget(n);
                            setPhoneDialogOpen(true);
                          }}
                          title="Edit"
                        >
                          <Pencil className="h-4 w-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          className="p-1.5 rounded-lg border border-zinc-700/50 text-zinc-500 hover:text-rose-400 transition-colors cursor-pointer bg-transparent"
                          onClick={() => setPhoneDeleteTarget(n)}
                          title="Delete"
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

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

      <AlertDialog
        open={!!phoneDeleteTarget}
        onOpenChange={(o) => !o && setPhoneDeleteTarget(null)}
      >
        <AlertDialogContent className="bg-[#111113] border border-[#2c2c35] rounded-2xl w-full max-w-lg p-6 relative shadow-2xl space-y-6 text-white">
          <AlertDialogHeader className="space-y-1">
            <AlertDialogTitle className="text-lg font-bold text-white">Delete phone number?</AlertDialogTitle>
            <AlertDialogDescription className="text-xs text-zinc-500 leading-relaxed">
              <strong className="text-zinc-200">{phoneDeleteTarget?.address}</strong> will no longer accept inbound calls or be
              available as a caller ID for this configuration.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="flex gap-3 justify-end pt-2 border-t border-[#1d1d22]/50">
            <AlertDialogCancel className="bg-[#121214] border border-[#232328] hover:bg-[#1a1a1f] px-3 py-1.5 rounded-xl text-xs text-zinc-300 font-medium transition-colors">Cancel</AlertDialogCancel>
            <AlertDialogAction className="bg-[#7c3aed] hover:bg-[#8b5cf6] text-white font-bold text-xs px-5 py-2.5 rounded-xl transition-all shadow-lg cursor-pointer" onClick={onConfirmDeletePhone}>Delete</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
