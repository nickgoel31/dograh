"use client";

import { Copy, ExternalLink, X } from "lucide-react";
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
import { detailFromError } from "@/lib/apiError";
import { useAuth } from "@/lib/auth";

type TelephonyConfigPayload = TelephonyConfigurationCreateRequest["config"];

interface ConfigFormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
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
  }, [open, existing, user, getAccessToken]);

  useEffect(() => {
    if (!isEdit) setValues({});
  }, [providerName, isEdit]);

  const updateField = (fieldName: string, value: string | number) => {
    setValues((prev) => ({ ...prev, [fieldName]: value }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!currentProvider) return;
    if (!isEdit && !name.trim()) {
      toast.error("Name is required");
      return;
    }

    setSubmitting(true);
    try {
      const token = await getAccessToken();

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

  if (!open) return null;

  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-xs z-50 flex items-center justify-center p-4">
      <div
        className="border border-gray-200 dark:border-[#282b26] rounded-2xl p-6 w-full max-w-lg shadow-2xl space-y-5 max-h-[90vh] overflow-y-auto text-gray-900 dark:text-white"
        style={{ backgroundColor: '#1C1E1A' }}
      >
        <div className="flex items-center justify-between pb-2 border-b border-gray-100 dark:border-[#282b26]">
          <div className="space-y-0.5">
            <h3 className="text-base font-bold text-gray-900 dark:text-white">
              {isEdit ? "Edit telephony configuration" : "Add telephony configuration"}
            </h3>
            <p className="text-xs text-gray-500 dark:text-gray-400">
              {isEdit
                ? "Update credentials for this configuration. Phone numbers are managed separately."
                : "Connect a telephony provider account. Phone numbers are added after the configuration is created."}
            </p>
          </div>
          <button
            onClick={() => onOpenChange(false)}
            className="p-1 text-gray-400 hover:text-gray-900 dark:hover:text-white cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          {isEdit && existing && (
            <div className="space-y-1">
              <label className="text-xs font-bold text-gray-900 dark:text-white block">Configuration ID</label>
              <button
                type="button"
                onClick={() => {
                  navigator.clipboard
                    .writeText(String(existing.id))
                    .then(() => toast.success("Configuration ID copied"))
                    .catch(() => toast.error("Failed to copy ID"));
                }}
                className="flex w-full items-center justify-between p-3 border border-gray-200 dark:border-[#282b26] rounded-xl font-mono text-xs cursor-pointer hover:bg-gray-100 dark:hover:bg-[#232621]"
                style={{ backgroundColor: '#161715' }}
              >
                <code className="truncate text-gray-800 dark:text-gray-200">{existing.id}</code>
                <Copy className="w-3.5 h-3.5 text-gray-400" />
              </button>
            </div>
          )}

          {/* Name */}
          <div className="space-y-1">
            <label className="text-xs font-bold text-gray-900 dark:text-white block">Name</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Twilio US prod"
              required
              autoFocus
              className="w-full px-3.5 py-2.5 border border-gray-200 dark:border-[#282b26] rounded-xl text-xs text-gray-900 dark:text-white font-normal focus:outline-hidden"
              style={{ backgroundColor: '#161715' }}
            />
          </div>

          {/* Provider */}
          <div className="space-y-1">
            <label className="text-xs font-bold text-gray-900 dark:text-white block">Provider</label>
            <select
              value={providerName}
              onChange={(e) => setProviderName(e.target.value)}
              disabled={lockedProvider || providers.length === 0}
              className="w-full px-3.5 py-2.5 border border-gray-200 dark:border-[#282b26] rounded-xl text-xs text-gray-900 dark:text-white font-medium cursor-pointer"
              style={{ backgroundColor: '#161715' }}
            >
              {providers.map((p) => (
                <option key={p.provider} value={p.provider} className="bg-white dark:bg-[#1c1e1a] text-gray-900 dark:text-white">
                  {p.display_name}
                </option>
              ))}
            </select>
            {lockedProvider && (
              <p className="text-[10px] text-gray-400 dark:text-gray-500 pt-0.5">
                Provider cannot be changed after creation.
              </p>
            )}
            {currentProvider?.docs_url && (
              <a
                href={currentProvider.docs_url}
                target="_blank"
                rel="noopener noreferrer"
                className="text-[11px] text-amber-700 dark:text-amber-400 hover:underline inline-flex items-center gap-0.5 pt-1"
              >
                <span>{currentProvider.display_name} docs</span>
                <ExternalLink className="w-3 h-3" />
              </a>
            )}
          </div>

          {/* Default Outbound Toggle */}
          {!isEdit && (
            <div
              className="p-4 border border-gray-200 dark:border-[#282b26] rounded-xl flex items-center justify-between"
              style={{ backgroundColor: '#161715' }}
            >
              <div className="space-y-0.5">
                <h4 className="text-xs font-bold text-gray-900 dark:text-white">
                  Set as default for outbound calls
                </h4>
                <p className="text-[11px] text-gray-400 dark:text-gray-500">
                  Used by test calls and campaigns when no specific config is selected.
                </p>
              </div>

              <button
                type="button"
                onClick={() => setIsDefault(!isDefault)}
                className={`relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ${
                  isDefault ? "bg-black dark:bg-[#bcf0da]" : "bg-gray-300 dark:bg-[#282b26]"
                }`}
              >
                <span
                  className={`inline-block h-5 w-5 transform rounded-full bg-white dark:bg-[#082117] shadow-md transition duration-200 ${
                    isDefault ? "translate-x-5" : "translate-x-0"
                  }`}
                />
              </button>
            </div>
          )}

          {/* Provider Dynamic Fields */}
          {currentProvider && (
            <div className="space-y-3 border-t border-gray-100 dark:border-[#282b26] pt-3">
              {currentProvider.fields.map((field) => (
                <div className="space-y-1" key={field.name}>
                  <label className="text-xs font-bold text-gray-900 dark:text-white block">
                    {field.label}
                    {!field.required && (
                      <span className="ml-1 text-[10px] font-normal text-gray-400">
                        (optional)
                      </span>
                    )}
                  </label>
                  <FieldInput
                    field={field}
                    value={values[field.name]}
                    onChange={(v) => updateField(field.name, v)}
                    isEdit={isEdit}
                  />
                  {field.description && (
                    <p className="text-[10px] text-gray-400 dark:text-gray-500 leading-snug">{field.description}</p>
                  )}
                </div>
              ))}
            </div>
          )}

          {/* Action Buttons */}
          <div className="pt-2 border-t border-gray-100 dark:border-[#282b26] flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={() => onOpenChange(false)}
              disabled={submitting}
              className="px-4 py-2 rounded-full text-xs font-semibold text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-[#232621] cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitting || !currentProvider}
              className="px-5 py-2.5 rounded-full text-xs font-bold bg-black dark:bg-[#bcf0da] text-white dark:text-[#082117] hover:bg-gray-800 dark:hover:bg-[#a5e9cd] shadow-xs cursor-pointer"
            >
              {submitting ? "Saving..." : isEdit ? "Save changes" : "Add Configuration"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

interface FieldInputProps {
  field: TelephonyProviderMetadata["fields"][number];
  value: string | number | undefined;
  onChange: (v: string | number) => void;
  isEdit: boolean;
}

function FieldInput({ field, value, onChange, isEdit }: FieldInputProps) {
  if (field.name === "from_numbers") {
    return (
      <p className="text-xs text-gray-400 dark:text-gray-500">
        Phone numbers are managed separately on the configuration page.
      </p>
    );
  }

  const placeholder =
    field.placeholder ??
    (field.sensitive && isEdit ? "Leave masked to keep existing" : "");

  if (field.type === "textarea") {
    return (
      <textarea
        placeholder={placeholder}
        value={(value as string) ?? ""}
        onChange={(e) => onChange(e.target.value)}
        rows={4}
        className="w-full p-2.5 border border-gray-200 dark:border-[#282b26] rounded-xl text-xs text-gray-900 dark:text-white font-mono focus:outline-hidden resize-none"
        style={{ backgroundColor: '#161715' }}
      />
    );
  }

  return (
    <input
      type={field.type === "number" ? "number" : field.type === "password" || field.sensitive ? "password" : "text"}
      placeholder={placeholder}
      value={(value as string | number | undefined) ?? ""}
      onChange={(e) => onChange(field.type === "number" ? (e.target.value === "" ? "" : Number(e.target.value)) : e.target.value)}
      className="w-full px-3.5 py-2.5 border border-gray-200 dark:border-[#282b26] rounded-xl text-xs text-gray-900 dark:text-white font-normal focus:outline-hidden"
      style={{ backgroundColor: '#161715' }}
    />
  );
}
