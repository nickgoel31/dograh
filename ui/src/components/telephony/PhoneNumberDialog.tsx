"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";

import {
  createPhoneNumberApiV1OrganizationsTelephonyConfigsConfigIdPhoneNumbersPost,
  getWorkflowsSummaryApiV1WorkflowSummaryGet,
  updatePhoneNumberApiV1OrganizationsTelephonyConfigsConfigIdPhoneNumbersPhoneNumberIdPut,
} from "@/client/sdk.gen";
import type { PhoneNumberResponse } from "@/client/types.gen";
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

// Mirrors api/schemas/telephony_phone_number.py::_validate_address_shape and
// api/utils/telephony_address.py — keep in sync. Returns an error message
// when the address would normalize to a broken canonical form, or null when
// the input is acceptable.
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

  // Reset form when the dialog opens.
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

  // Only validate the address on create — edits keep the immutable address.
  const addressError = isEdit ? null : validateAddress(address, countryCode);

  // Load workflows for the inbound dropdown.
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

  const handleSubmit = async () => {
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

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="bg-[#111113] border border-[#2c2c35] rounded-2xl w-full max-w-lg p-6 relative shadow-2xl space-y-6 text-white">
        <DialogHeader className="space-y-1">
          <DialogTitle className="text-lg font-bold text-white">
            {isEdit ? "Edit phone number" : "Add phone number"}
          </DialogTitle>
          <DialogDescription className="text-xs text-zinc-500 leading-relaxed">
            PSTN numbers (E.164), SIP URIs (sip:user@host), and SIP extensions are all supported.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-1">
            <Label htmlFor="pn-address" className="text-xs font-bold text-zinc-300 block mb-1.5">Address</Label>
            <Input
              id="pn-address"
              placeholder="+19781899185, sip:101@asterisk.local, or 101"
              value={address}
              className="bg-[#08080a] border border-[#1d1d22] rounded-xl py-2.5 px-4 text-xs text-white focus:outline-none focus:border-zinc-700 focus:ring-1 focus:ring-zinc-700 transition-all"
              onChange={(e) => setAddress(e.target.value)}
              onBlur={() => setAddressTouched(true)}
              disabled={isEdit}
              aria-invalid={addressTouched && !!addressError}
            />
            {!isEdit && addressTouched && addressError && (
              <p className="text-xs text-red-400 font-semibold">{addressError}</p>
            )}
            {isEdit && (
              <p className="text-[10px] text-zinc-500 mt-1 leading-snug">
                Address cannot be changed. Delete this number and create a new one to change it.
              </p>
            )}
            {isEdit && (
              <p className="text-[10px] text-zinc-500 mt-1 leading-snug">
                Stored as <code>{existing?.address_normalized}</code> ({existing?.address_type})
              </p>
            )}
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label htmlFor="pn-country" className="text-xs font-bold text-zinc-300 block mb-1.5">Country (ISO-2)</Label>
              <Input
                id="pn-country"
                placeholder="US"
                maxLength={2}
                value={countryCode}
                className="bg-[#08080a] border border-[#1d1d22] rounded-xl py-2.5 px-4 text-xs text-white focus:outline-none focus:border-zinc-700 focus:ring-1 focus:ring-zinc-700 transition-all"
                onChange={(e) => setCountryCode(e.target.value.toUpperCase())}
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="pn-label" className="text-xs font-bold text-zinc-300 block mb-1.5">Label</Label>
              <Input
                id="pn-label"
                placeholder="e.g. Boston caller ID"
                value={label}
                className="bg-[#08080a] border border-[#1d1d22] rounded-xl py-2.5 px-4 text-xs text-white focus:outline-none focus:border-zinc-700 focus:ring-1 focus:ring-zinc-700 transition-all"
                onChange={(e) => setLabel(e.target.value)}
              />
            </div>
          </div>

          <div className="space-y-1">
            <Label htmlFor="pn-workflow" className="text-xs font-bold text-zinc-300 block mb-1.5">Inbound workflow</Label>
            <Select value={inboundWorkflowId} onValueChange={setInboundWorkflowId}>
              <SelectTrigger id="pn-workflow" className="w-full bg-[#08080a] border border-[#1d1d22] rounded-xl py-2.5 px-4 text-xs text-white focus:outline-none focus:border-zinc-700 transition-all">
                <SelectValue placeholder="(none)" />
              </SelectTrigger>
              <SelectContent className="bg-[#111113] border border-[#1d1d22] text-white">
                <SelectItem value={NO_WORKFLOW}>(none)</SelectItem>
                {workflows.map((w) => (
                  <SelectItem key={w.id} value={String(w.id)}>
                    #{w.id} - {w.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-[10px] text-zinc-500 mt-1 leading-snug">
              Used when per-number inbound routing is enabled. Today, inbound calls still route by the workflow_id in the webhook URL.
            </p>
          </div>

          <div className="flex items-center justify-between rounded-xl border border-[#1d1d22] bg-[#08080a] p-4">
            <Label className="text-xs font-bold text-zinc-300 block mb-1.5">Active</Label>
            <Switch checked={isActive} onCheckedChange={setIsActive} />
          </div>

          {!isEdit && (
            <div className="flex items-center justify-between rounded-xl border border-[#1d1d22] bg-[#08080a] p-4">
              <div>
                <Label className="text-xs font-bold text-zinc-300 block mb-1.5">Default caller ID for this configuration</Label>
                <p className="text-[10px] text-zinc-500 mt-1 leading-snug">
                  Used as the from-number for test calls when set.
                </p>
              </div>
              <Switch
                checked={isDefaultCallerId}
                onCheckedChange={setIsDefaultCallerId}
              />
            </div>
          )}
        </div>

        <DialogFooter className="flex gap-3 justify-end pt-2 border-t border-[#1d1d22]/50">
          <Button className="bg-[#121214] border border-[#232328] hover:bg-[#1a1a1f] px-3 py-1.5 rounded-xl text-xs text-zinc-300 font-medium transition-colors cursor-pointer" onClick={() => onOpenChange(false)} disabled={submitting}>
            Cancel
          </Button>
          <Button
            className="bg-[#7c3aed] hover:bg-[#8b5cf6] text-white font-bold text-xs px-5 py-2.5 rounded-xl transition-all shadow-lg cursor-pointer"
            onClick={handleSubmit}
            disabled={submitting || (!isEdit && !!addressError)}
          >
            {submitting ? "Saving..." : isEdit ? "Save changes" : "Add"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
