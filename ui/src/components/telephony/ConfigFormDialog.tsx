"use client";

import { Copy, ExternalLink } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

import {
  createTelephonyConfigurationApiV1OrganizationsTelephonyConfigsPost,
  getTelephonyProvidersMetadataApiV1OrganizationsTelephonyProvidersMetadataGet,
  updateTelephonyConfigurationApiV1OrganizationsTelephonyConfigsConfigIdPut,
} from "@/client/sdk.gen";
import type {
  TelephonyConfigurationCreateRequest,
  TelephonyConfigurationDetail,
  TelephonyProviderMetadata,
} from "@/client/types.gen";

type TelephonyConfigPayload = TelephonyConfigurationCreateRequest["config"];
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { detailFromError } from "@/lib/apiError";
import { useAuth } from "@/lib/auth";

interface ConfigFormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  // When provided, the dialog is in edit mode.
  existing?: TelephonyConfigurationDetail | null;
  onSaved: () => void;
}

type FieldValues = Record<string, string | number | undefined>;

export function ConfigFormDialog({
  open,
  onOpenChange,
  existing,
  onSaved,
}: ConfigFormDialogProps) {
  const { user, getAccessToken } = useAuth();
  const [providers, setProviders] = useState<TelephonyProviderMetadata[]>([]);
  const [providerName, setProviderName] = useState<string>("");
  const [name, setName] = useState<string>("");
  const [isDefault, setIsDefault] = useState<boolean>(false);
  const [values, setValues] = useState<FieldValues>({});
  const [submitting, setSubmitting] = useState<boolean>(false);

  const isEdit = !!existing;
  const lockedProvider = isEdit;

  const currentProvider = useMemo(
    () => providers.find((p) => p.provider === providerName),
    [providers, providerName],
  );

  // Fetch provider metadata once when the dialog opens.
  useEffect(() => {
    if (!open || !user) return;
    let cancelled = false;
    (async () => {
      const token = await getAccessToken();
      const res = await getTelephonyProvidersMetadataApiV1OrganizationsTelephonyProvidersMetadataGet(
        { headers: { Authorization: `Bearer ${token}` } },
      );
      if (cancelled) return;
      const list = res.data?.providers ?? [];
      setProviders(list);
      if (existing) {
        setProviderName(existing.provider);
        setName(existing.name);
        setIsDefault(existing.is_default_outbound);
        setValues((existing.credentials ?? {}) as FieldValues);
      } else if (list.length > 0 && !providerName) {
        setProviderName(list[0].provider);
        setValues({});
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, existing, user, getAccessToken]);

  // When provider changes during create, clear field values.
  useEffect(() => {
    if (!isEdit) setValues({});
  }, [providerName, isEdit]);

  const updateField = (fieldName: string, value: string | number) => {
    setValues((prev) => ({ ...prev, [fieldName]: value }));
  };

  const handleSubmit = async () => {
    if (!currentProvider) return;
    if (!isEdit && !name.trim()) {
      toast.error("Name is required");
      return;
    }

    setSubmitting(true);
    try {
      const token = await getAccessToken();

      // Build the provider-discriminated config payload from collected values.
      const configPayload = {
        provider: providerName,
        ...values,
      } as unknown as TelephonyConfigPayload;

      if (isEdit && existing) {
        const res = await updateTelephonyConfigurationApiV1OrganizationsTelephonyConfigsConfigIdPut(
          {
            headers: { Authorization: `Bearer ${token}` },
            path: { config_id: existing.id },
            body: { name: name || undefined, config: configPayload },
          },
        );
        if (res.error) throw new Error(detailFromError(res.error, "Failed to save configuration"));
        toast.success("Configuration updated");
      } else {
        const res = await createTelephonyConfigurationApiV1OrganizationsTelephonyConfigsPost(
          {
            headers: { Authorization: `Bearer ${token}` },
            body: {
              name: name.trim(),
              is_default_outbound: isDefault,
              config: configPayload,
            },
          },
        );
        if (res.error) throw new Error(detailFromError(res.error, "Failed to save configuration"));
        toast.success("Configuration created");
      }
      onOpenChange(false);
      onSaved();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to save");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="bg-[#111113] border border-[#2c2c35] rounded-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto p-6 shadow-2xl space-y-6 text-white">
        <DialogHeader className="space-y-1">
          <DialogTitle className="text-lg font-bold text-white">
            {isEdit ? "Edit telephony configuration" : "Add telephony configuration"}
          </DialogTitle>
          <DialogDescription className="text-xs text-zinc-500 leading-relaxed">
            {isEdit
              ? "Update credentials for this configuration. Phone numbers are managed separately."
              : "Connect a telephony provider account. Phone numbers are added after the configuration is created."}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {isEdit && existing && (
            <div className="space-y-1">
              <Label className="text-xs font-bold text-zinc-300 block mb-1.5">Configuration ID</Label>
              <button
                type="button"
                onClick={() => {
                  navigator.clipboard
                    .writeText(String(existing.id))
                    .then(() => toast.success("Configuration ID copied"))
                    .catch(() => toast.error("Failed to copy ID"));
                }}
                title="Click to copy"
                className="group flex w-full items-center gap-2 rounded-xl border border-[#1d1d22] bg-[#08080a] p-3 text-left font-mono text-xs transition-colors hover:bg-white/5"
              >
                <code className="flex-1 truncate text-zinc-300 group-hover:text-white">{existing.id}</code>
                <Copy className="h-3.5 w-3.5 shrink-0 text-zinc-500 group-hover:text-white" />
              </button>
            </div>
          )}

          <div className="space-y-2">
            <Label htmlFor="cfg-name" className="text-xs font-bold text-zinc-300 block mb-1.5">Name</Label>
            <Input
              id="cfg-name"
              placeholder="e.g. Twilio US prod"
              value={name}
              className="bg-[#08080a] border border-[#1d1d22] rounded-xl py-2.5 px-4 text-xs text-white focus:outline-none focus:border-zinc-700 focus:ring-1 focus:ring-zinc-700 transition-all"
              onChange={(e) => setName(e.target.value)}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="cfg-provider" className="text-xs font-bold text-zinc-300 block mb-1.5">Provider</Label>
            <Select
              value={providerName}
              onValueChange={setProviderName}
              disabled={lockedProvider || providers.length === 0}
            >
              <SelectTrigger id="cfg-provider" className="w-full bg-[#08080a] border border-[#1d1d22] rounded-xl py-2.5 px-4 text-xs text-white focus:outline-none focus:border-zinc-700 transition-all">
                <SelectValue placeholder="Select a provider" />
              </SelectTrigger>
              <SelectContent className="bg-[#111113] border border-[#1d1d22] text-white">
                {providers.map((p) => (
                  <SelectItem key={p.provider} value={p.provider}>
                    {p.display_name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {lockedProvider && (
              <p className="text-[10px] text-zinc-500 mt-1 leading-snug">
                Provider cannot be changed after creation.
              </p>
            )}
            {currentProvider?.docs_url && (
              <a
                href={currentProvider.docs_url}
                target="_blank"
                rel="noopener noreferrer"
                className="text-blue-400 hover:underline inline-flex items-center gap-0.5 text-xs mt-1"
              >
                {currentProvider.display_name} docs <ExternalLink className="w-3 h-3 inline" />
              </a>
            )}
          </div>

          {!isEdit && (
            <div className="flex items-center justify-between rounded-xl border border-[#1d1d22] bg-[#08080a] p-4 mb-4">
              <div>
                <Label className="text-xs font-bold text-zinc-300 block mb-1.5">Set as default for outbound calls</Label>
                <p className="text-[10px] text-zinc-500 mt-1 leading-snug">
                  Used by test calls and campaigns when no specific config is selected.
                </p>
              </div>
              <Switch checked={isDefault} onCheckedChange={setIsDefault} />
            </div>
          )}

          {currentProvider && (
            <div className="space-y-3 border-t border-[#1d1d22]/50 pt-4">
              {currentProvider.fields.map((field) => (
                <div className="space-y-1" key={field.name}>
                  <Label htmlFor={`cfg-field-${field.name}`} className="text-xs font-bold text-zinc-300 block mb-1.5">
                    {field.label}
                    {!field.required && (
                      <span className="ml-1 text-[10px] font-normal text-zinc-500">
                        (optional)
                      </span>
                    )}
                  </Label>
                  <FieldInput
                    field={field}
                    value={values[field.name]}
                    onChange={(v) => updateField(field.name, v)}
                    isEdit={isEdit}
                  />
                  {field.description && (
                    <p className="text-[10px] text-zinc-500 mt-1 leading-snug">{field.description}</p>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        <DialogFooter className="flex gap-3 justify-end pt-2 border-t border-[#1d1d22]/50">
          <Button className="bg-[#121214] border border-[#232328] hover:bg-[#1a1a1f] px-3 py-1.5 rounded-xl text-xs text-zinc-300 font-medium transition-colors cursor-pointer" onClick={() => onOpenChange(false)} disabled={submitting}>
            Cancel
          </Button>
          <Button className="bg-[#7c3aed] hover:bg-[#8b5cf6] text-white font-bold text-xs px-5 py-2.5 rounded-xl transition-all shadow-lg cursor-pointer" onClick={handleSubmit} disabled={submitting || !currentProvider}>
            {submitting ? "Saving..." : isEdit ? "Save changes" : "Create"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

interface FieldInputProps {
  field: TelephonyProviderMetadata["fields"][number];
  value: string | number | undefined;
  onChange: (v: string | number) => void;
  isEdit: boolean;
}

// Skip from_numbers in the metadata-driven form — phone numbers are managed
// via the dedicated phone-numbers endpoints and a different UI.
function FieldInput({ field, value, onChange, isEdit }: FieldInputProps) {
  if (field.name === "from_numbers") {
    return (
      <p className="text-xs text-zinc-500">
        Phone numbers are managed separately on the configuration page.
      </p>
    );
  }

  const placeholder =
    field.placeholder ??
    (field.sensitive && isEdit ? "Leave masked to keep existing" : "");

  if (field.type === "textarea") {
    return (
      <Textarea
        id={`cfg-field-${field.name}`}
        placeholder={placeholder}
        value={(value as string) ?? ""}
        onChange={(e) => onChange(e.target.value)}
        rows={6}
        className="bg-[#08080a] border border-[#1d1d22] rounded-xl p-2.5 text-[10px] text-zinc-400 leading-relaxed resize-none focus:outline-none focus:border-zinc-700 font-mono"
      />
    );
  }
  if (field.type === "number") {
    return (
      <Input
        id={`cfg-field-${field.name}`}
        type="number"
        placeholder={placeholder}
        value={value as number | string | undefined ?? ""}
        className="bg-[#08080a] border border-[#1d1d22] rounded-xl py-2.5 px-4 text-xs text-white focus:outline-none focus:border-zinc-700 focus:ring-1 focus:ring-zinc-700 transition-all"
        onChange={(e) => onChange(e.target.value === "" ? "" : Number(e.target.value))}
      />
    );
  }
  return (
    <Input
      id={`cfg-field-${field.name}`}
      type={field.type === "password" || field.sensitive ? "password" : "text"}
      placeholder={placeholder}
      value={(value as string) ?? ""}
      className="bg-[#08080a] border border-[#1d1d22] rounded-xl py-2.5 px-4 text-xs text-white focus:outline-none focus:border-zinc-700 focus:ring-1 focus:ring-zinc-700 transition-all"
      onChange={(e) => onChange(e.target.value)}
      autoComplete={field.sensitive ? "current-password" : undefined}
    />
  );
}
