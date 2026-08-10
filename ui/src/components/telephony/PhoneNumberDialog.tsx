"use client";

import { X } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import {
  createPhoneNumberApiV1OrganizationsTelephonyConfigsConfigIdPhoneNumbersPost,
  getWorkflowsSummaryApiV1WorkflowSummaryGet,
  updatePhoneNumberApiV1OrganizationsTelephonyConfigsConfigIdPhoneNumbersPhoneNumberIdPut,
} from "@/client/sdk.gen";
import type { PhoneNumberResponse } from "@/client/types.gen";
import { detailFromError } from "@/lib/apiError";
import { useAuth } from "@/lib/auth";

interface PhoneNumberDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  configId: number;
  existing?: PhoneNumberResponse | null;
  onSaved: () => void;
}

const NO_WORKFLOW = "__none__";

const ADDRESS_FORMAT_STRIP_RE = /[\s\-()]/g;
const ADDRESS_E164_RE = /^\+\d{8,15}$/;
const ADDRESS_BARE_DIGITS_RE = /^\d{8,15}$/;

function validateAddress(rawAddress: string, countryCode: string): string | null {
  const trimmed = rawAddress.trim();
  if (!trimmed) return "Address is required";
  if (/^sips?:/i.test(trimmed)) return null;
  const stripped = trimmed.replace(ADDRESS_FORMAT_STRIP_RE, "");
  if (ADDRESS_E164_RE.test(stripped)) return null;
  if (ADDRESS_BARE_DIGITS_RE.test(stripped) && !countryCode.trim()) {
    return "PSTN addresses without a leading '+' need a Country (ISO-2) hint, or include the country code in the address (e.g. +14155551234).";
  }
  return null;
}

export function PhoneNumberDialog({
  open,
  onOpenChange,
  configId,
  existing,
  onSaved,
}: PhoneNumberDialogProps) {
  const { user, getAccessToken } = useAuth();
  const isEdit = !!existing;

  const [address, setAddress] = useState("");
  const [countryCode, setCountryCode] = useState("");
  const [label, setLabel] = useState("");
  const [isActive, setIsActive] = useState(true);
  const [isDefaultCallerId, setIsDefaultCallerId] = useState(false);
  const [inboundWorkflowId, setInboundWorkflowId] = useState<string>(NO_WORKFLOW);
  const [workflows, setWorkflows] = useState<{ id: number; name: string }[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [addressTouched, setAddressTouched] = useState(false);

  useEffect(() => {
    if (!open) return;
    setAddress(existing?.address ?? "");
    setCountryCode(existing?.country_code ?? "");
    setLabel(existing?.label ?? "");
    setIsActive(existing?.is_active ?? true);
    setIsDefaultCallerId(existing?.is_default_caller_id ?? false);
    setInboundWorkflowId(
      existing?.inbound_workflow_id ? String(existing.inbound_workflow_id) : NO_WORKFLOW,
    );
    setAddressTouched(false);
  }, [open, existing]);

  const addressError = isEdit ? null : validateAddress(address, countryCode);

  useEffect(() => {
    if (!open || !user) return;
    let cancelled = false;
    (async () => {
      const token = await getAccessToken();
      const res = await getWorkflowsSummaryApiV1WorkflowSummaryGet({
        headers: { Authorization: `Bearer ${token}` },
        query: { status: "active" },
      });
      if (cancelled) return;
      const items = res.data ?? [];
      setWorkflows(items.map((w) => ({ id: w.id, name: w.name })));
    })();
    return () => {
      cancelled = true;
    };
  }, [open, user, getAccessToken]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isEdit) {
      const err = validateAddress(address, countryCode);
      if (err) {
        setAddressTouched(true);
        toast.error(err);
        return;
      }
    }
    setSubmitting(true);
    try {
      const token = await getAccessToken();
      const inboundId =
        inboundWorkflowId === NO_WORKFLOW ? null : Number(inboundWorkflowId);

      let providerSync: PhoneNumberResponse["provider_sync"] | undefined;
      if (isEdit && existing) {
        const res = await updatePhoneNumberApiV1OrganizationsTelephonyConfigsConfigIdPhoneNumbersPhoneNumberIdPut(
          {
            headers: { Authorization: `Bearer ${token}` },
            path: { config_id: configId, phone_number_id: existing.id },
            body: {
              label: label || undefined,
              is_active: isActive,
              country_code: countryCode || undefined,
              inbound_workflow_id: inboundId ?? undefined,
              clear_inbound_workflow: inboundId === null,
            },
          },
        );
        if (res.error) throw new Error(detailFromError(res.error, "Failed to save phone number"));
        providerSync = res.data?.provider_sync;
        toast.success("Phone number updated");
      } else {
        const res = await createPhoneNumberApiV1OrganizationsTelephonyConfigsConfigIdPhoneNumbersPost(
          {
            headers: { Authorization: `Bearer ${token}` },
            path: { config_id: configId },
            body: {
              address: address.trim(),
              country_code: countryCode || undefined,
              label: label || undefined,
              is_active: isActive,
              is_default_caller_id: isDefaultCallerId,
              inbound_workflow_id: inboundId ?? undefined,
            },
          },
        );
        if (res.error) throw new Error(detailFromError(res.error, "Failed to save phone number"));
        providerSync = res.data?.provider_sync;
        toast.success("Phone number added");
      }
      if (providerSync && !providerSync.ok) {
        toast.warning(
          providerSync.message ??
            "Saved, but failed to sync inbound webhook to the provider.",
        );
      }
      onOpenChange(false);
      onSaved();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to save phone number");
    } finally {
      setSubmitting(false);
    }
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-xs z-50 flex items-center justify-center p-4">
      <div
        className="border border-gray-200 dark:border-[#282b26] rounded-2xl p-6 w-full max-w-md shadow-2xl space-y-5 text-gray-900 dark:text-white"
        style={{ backgroundColor: '#1C1E1A' }}
      >
        <div className="flex items-center justify-between pb-2 border-b border-gray-100 dark:border-[#282b26]">
          <h3 className="text-base font-bold text-gray-900 dark:text-white">
            {isEdit ? "Edit phone number" : "Add phone number"}
          </h3>
          <button
            onClick={() => onOpenChange(false)}
            className="p-1 text-gray-400 hover:text-gray-900 dark:hover:text-white cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Address */}
          <div className="space-y-1">
            <label className="text-xs font-bold text-gray-900 dark:text-white block">Phone Address</label>
            <input
              type="text"
              placeholder="e.g. +1 800-555-0199 or sip:101@host"
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              onBlur={() => setAddressTouched(true)}
              disabled={isEdit}
              required={!isEdit}
              autoFocus={!isEdit}
              className="w-full px-3.5 py-2.5 border border-gray-200 dark:border-[#282b26] rounded-xl text-xs font-mono text-gray-900 dark:text-white focus:outline-hidden"
              style={{ backgroundColor: '#161715' }}
            />
            {!isEdit && addressTouched && addressError && (
              <p className="text-[11px] text-red-500 font-semibold mt-0.5">{addressError}</p>
            )}
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <label className="text-xs font-bold text-gray-900 dark:text-white block">Country (ISO-2)</label>
              <input
                type="text"
                placeholder="US"
                maxLength={2}
                value={countryCode}
                onChange={(e) => setCountryCode(e.target.value.toUpperCase())}
                className="w-full px-3.5 py-2.5 border border-gray-200 dark:border-[#282b26] rounded-xl text-xs text-gray-900 dark:text-white uppercase focus:outline-hidden"
                style={{ backgroundColor: '#161715' }}
              />
            </div>
            <div className="space-y-1">
              <label className="text-xs font-bold text-gray-900 dark:text-white block">Label</label>
              <input
                type="text"
                placeholder="e.g. US Support Line"
                value={label}
                onChange={(e) => setLabel(e.target.value)}
                className="w-full px-3.5 py-2.5 border border-gray-200 dark:border-[#282b26] rounded-xl text-xs text-gray-900 dark:text-white focus:outline-hidden"
                style={{ backgroundColor: '#161715' }}
              />
            </div>
          </div>

          {/* Inbound workflow */}
          <div className="space-y-1">
            <label className="text-xs font-bold text-gray-900 dark:text-white block">Inbound workflow</label>
            <select
              value={inboundWorkflowId}
              onChange={(e) => setInboundWorkflowId(e.target.value)}
              className="w-full px-3.5 py-2.5 border border-gray-200 dark:border-[#282b26] rounded-xl text-xs text-gray-900 dark:text-white font-medium focus:outline-hidden cursor-pointer"
              style={{ backgroundColor: '#161715' }}
            >
              <option value={NO_WORKFLOW} className="bg-white dark:bg-[#1c1e1a] text-gray-900 dark:text-white">(none)</option>
              {workflows.map((w) => (
                <option key={w.id} value={String(w.id)} className="bg-white dark:bg-[#1c1e1a] text-gray-900 dark:text-white">
                  #{w.id} - {w.name}
                </option>
              ))}
            </select>
          </div>

          {/* Active Switch */}
          <div
            className="p-3 border border-gray-200 dark:border-[#282b26] rounded-xl flex items-center justify-between"
            style={{ backgroundColor: '#161715' }}
          >
            <label className="text-xs font-bold text-gray-900 dark:text-white">Active</label>
            <button
              type="button"
              onClick={() => setIsActive(!isActive)}
              className={`relative inline-flex h-5 w-9 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ${
                isActive ? "bg-black dark:bg-[#bcf0da]" : "bg-gray-300 dark:bg-[#282b26]"
              }`}
            >
              <span
                className={`inline-block h-4 w-4 transform rounded-full bg-white dark:bg-[#082117] shadow-md transition duration-200 ${
                  isActive ? "translate-x-4" : "translate-x-0"
                }`}
              />
            </button>
          </div>

          {/* Submit Buttons */}
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
              disabled={submitting || (!isEdit && !!addressError)}
              className="px-5 py-2.5 rounded-full text-xs font-bold bg-black dark:bg-[#bcf0da] text-white dark:text-[#082117] hover:bg-gray-800 dark:hover:bg-[#a5e9cd] shadow-xs cursor-pointer"
            >
              {submitting ? "Saving..." : isEdit ? "Save changes" : "Save Phone Number"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
