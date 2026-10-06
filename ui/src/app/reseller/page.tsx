"use client";

import { Building2, Copy, Plus, RefreshCw, Users } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";

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
import {
  type ModelProfileSummary,
  resellerApi,
  type ResellerClientView,
  type ResellerOverview,
} from "@/lib/reseller";
import { formatMinutes, formatMoney } from "@/lib/wallet";

const SELECT_CLS =
  "h-9 rounded-md border border-input bg-background px-2 text-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring";

type Dialogs =
  | { kind: "create" }
  | { kind: "edit"; client: ResellerClientView }
  | { kind: "minutes"; client: ResellerClientView }
  | { kind: "invite"; client: ResellerClientView }
  | null;

export default function ResellerPage() {
  const { isReseller, isSuperadmin, loading: roleLoading } = useCurrentUserRole();
  const [overview, setOverview] = useState<ResellerOverview | null>(null);
  const [profiles, setProfiles] = useState<ModelProfileSummary[]>([]);
  const [days, setDays] = useState(30);
  const [loading, setLoading] = useState(true);
  const [dialog, setDialog] = useState<Dialogs>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [o, p] = await Promise.all([
        resellerApi<ResellerOverview>("GET", `/overview?days=${days}`),
        resellerApi<ModelProfileSummary[]>("GET", "/model-profiles"),
      ]);
      setOverview(o);
      setProfiles(p);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to load reseller data");
    } finally {
      setLoading(false);
    }
  }, [days]);

  useEffect(() => {
    if (!roleLoading && (isReseller || isSuperadmin)) load();
    else if (!roleLoading) setLoading(false);
  }, [roleLoading, isReseller, isSuperadmin, load]);

  if (roleLoading) return null;
  if (!isReseller) {
    return (
      <div className="p-10 text-sm text-muted-foreground">
        This workspace is not set up as a reseller account. Ask the platform owner to enable it.
      </div>
    );
  }

  const w = overview?.organization.wallet;
  const currency = w?.currency ?? "INR";

  const changeProfile = async (client: ResellerClientView, profileId: string) => {
    try {
      await resellerApi("PUT", `/clients/${client.id}/model-profile`, {
        profile_id: profileId === "" ? null : Number(profileId),
      });
      toast.success(`Updated models for ${client.name}`);
      load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to update");
    }
  };

  return (
    <div className="flex h-full flex-col bg-background text-foreground">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-8 pb-3 pt-6">
        <div className="space-y-0.5">
          <div className="flex items-center gap-2">
            <Building2 className="h-4 w-4 text-emerald-400" />
            <h1 className="text-base font-semibold tracking-tight">Reseller portal</h1>
          </div>
          <p className="text-xs text-muted-foreground">
            Create clients, set their prices and limits, pick their voice quality and watch your margin.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <select value={days} onChange={(e) => setDays(Number(e.target.value))} className={SELECT_CLS}>
            <option value={7}>Last 7 days</option>
            <option value={30}>Last 30 days</option>
            <option value={90}>Last 90 days</option>
          </select>
          <Button variant="outline" size="icon" onClick={load} disabled={loading} title="Refresh">
            <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
          </Button>
          <Button onClick={() => setDialog({ kind: "create" })}>
            <Plus className="mr-1 h-4 w-4" /> New client
          </Button>
        </div>
      </header>

      <main className="flex-1 space-y-6 overflow-y-auto px-8 py-6">
        {w && (w.out_of_balance || w.low_balance) && (
          <div className="rounded-xl border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm text-amber-300">
            {w.out_of_balance
              ? "Your wallet is empty: your clients' calls are blocked until you top up with the platform."
              : "Your wallet is running low. Top up so your clients' calls are not interrupted."}
          </div>
        )}

        <section className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <Stat label="Your wallet" value={w ? formatMoney(w.balance, currency) : "-"}
            hint={overview?.organization.wholesale_rate != null
              ? `Wholesale ${formatMoney(overview.organization.wholesale_rate, currency)}/min` : undefined} />
          <Stat label="Clients" value={String(overview?.clients.length ?? 0)}
            hint={overview?.organization.max_child_orgs != null ? `Limit ${overview.organization.max_child_orgs}` : undefined} />
          <Stat label={`Minutes (${days}d)`} value={(overview?.totals.minutes ?? 0).toFixed(1)}
            hint={`${overview?.totals.calls ?? 0} calls`} />
          <Stat label="Est. margin" value={formatMoney(overview?.totals.estimated_margin ?? 0, currency)}
            hint={`Cost ${formatMoney(overview?.totals.wholesale_cost ?? 0, currency)} at list rates`} />
        </section>

        <section className="rounded-xl border border-border bg-card">
          <div className="flex items-center gap-2 border-b border-border px-5 py-3">
            <Users className="h-4 w-4 text-muted-foreground" />
            <h2 className="text-sm font-semibold">Clients</h2>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-xs text-muted-foreground">
                <tr>
                  <th className="px-5 py-2.5 font-medium">Client</th>
                  <th className="px-3 py-2.5 font-medium">Voice quality</th>
                  <th className="px-3 py-2.5 text-right font-medium">Rate / min</th>
                  <th className="px-3 py-2.5 text-right font-medium">Left</th>
                  <th className="px-3 py-2.5 text-right font-medium">Used</th>
                  <th className="px-3 py-2.5 text-right font-medium">Cost</th>
                  <th className="px-5 py-2.5 text-right font-medium">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {(overview?.clients ?? []).map((c) => (
                  <tr key={c.id} className="hover:bg-muted/30">
                    <td className="px-5 py-3">
                      <p className="font-medium">{c.name}</p>
                      {!c.is_active && <p className="text-xs text-red-400">Suspended</p>}
                    </td>
                    <td className="px-3 py-3">
                      <select value={c.model_profile_id ?? ""} onChange={(e) => changeProfile(c, e.target.value)} className={SELECT_CLS}>
                        <option value="">Default</option>
                        {profiles.map((p) => (
                          <option key={p.id} value={p.id}>{p.display_name}</option>
                        ))}
                      </select>
                    </td>
                    <td className="px-3 py-3 text-right tabular-nums">{formatMoney(c.billing_rate, currency)}</td>
                    <td className="px-3 py-3 text-right tabular-nums">{c.wallet ? formatMinutes(c.wallet.minutes_remaining) : "-"}</td>
                    <td className="px-3 py-3 text-right tabular-nums">{(c.stats?.minutes ?? 0).toFixed(1)} min</td>
                    <td className="px-3 py-3 text-right tabular-nums">{formatMoney(c.stats?.wholesale_cost ?? 0, currency)}</td>
                    <td className="space-x-1 whitespace-nowrap px-5 py-3 text-right">
                      <Button size="sm" variant="secondary" onClick={() => setDialog({ kind: "minutes", client: c })}>Add minutes</Button>
                      <Button size="sm" variant="outline" onClick={() => setDialog({ kind: "edit", client: c })}>Edit</Button>
                      <Button size="sm" variant="ghost" onClick={() => setDialog({ kind: "invite", client: c })}>Invite</Button>
                    </td>
                  </tr>
                ))}
                {!loading && (overview?.clients.length ?? 0) === 0 && (
                  <tr>
                    <td colSpan={7} className="px-5 py-10 text-center text-sm text-muted-foreground">
                      No clients yet. Create your first one to get started.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>
      </main>

      <CreateDialog open={dialog?.kind === "create"} profiles={profiles} currency={currency}
        onClose={() => setDialog(null)} onDone={load} />
      {dialog?.kind === "edit" && (
        <EditDialog client={dialog.client} currency={currency} onClose={() => setDialog(null)} onDone={load} />
      )}
      {dialog?.kind === "minutes" && (
        <MinutesDialog client={dialog.client} onClose={() => setDialog(null)} onDone={load} />
      )}
      {dialog?.kind === "invite" && (
        <InviteDialog client={dialog.client} onClose={() => setDialog(null)} />
      )}
    </div>
  );
}

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-1 text-2xl font-semibold tabular-nums">{value}</p>
      {hint && <p className="mt-1 text-[11px] text-muted-foreground">{hint}</p>}
    </div>
  );
}

function num(v: string): number {
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : 0;
}

function CreateDialog({
  open, profiles, currency, onClose, onDone,
}: { open: boolean; profiles: ModelProfileSummary[]; currency: string; onClose: () => void; onDone: () => void }) {
  const [name, setName] = useState("");
  const [rate, setRate] = useState("0");
  const [allowance, setAllowance] = useState("0");
  const [initial, setInitial] = useState("0");
  const [profile, setProfile] = useState("");
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [invite, setInvite] = useState<string | null>(null);

  const submit = async () => {
    setBusy(true);
    try {
      const res = await resellerApi<{ invite: { invite_url: string } | null }>("POST", "/clients", {
        name,
        billing_rate: num(rate),
        monthly_minutes_limit: num(allowance),
        initial_minutes: num(initial),
        model_profile_id: profile === "" ? null : Number(profile),
        admin_email: email || null,
      });
      toast.success("Client created");
      onDone();
      if (res.invite) setInvite(res.invite.invite_url);
      else close();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to create client");
    } finally {
      setBusy(false);
    }
  };
  const close = () => {
    setName(""); setRate("0"); setAllowance("0"); setInitial("0"); setProfile(""); setEmail(""); setInvite(null);
    onClose();
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && close()}>
      <DialogContent className="sm:max-w-[460px]">
        <DialogHeader>
          <DialogTitle>{invite ? "Client created" : "New client"}</DialogTitle>
          <DialogDescription>
            {invite ? "Send this link to your client's admin so they can create their login." : "A separate workspace for one of your customers."}
          </DialogDescription>
        </DialogHeader>
        {invite ? (
          <CopyField value={invite} />
        ) : (
          <div className="space-y-3 py-2">
            <Field label="Client name"><Input value={name} onChange={(e) => setName(e.target.value)} /></Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label={`Overage rate (${currency}/min)`}><Input type="number" min="0" step="0.01" value={rate} onChange={(e) => setRate(e.target.value)} /></Field>
              <Field label="Monthly minutes"><Input type="number" min="0" value={allowance} onChange={(e) => setAllowance(e.target.value)} /></Field>
            </div>
            <Field label="Starting bonus minutes"><Input type="number" min="0" value={initial} onChange={(e) => setInitial(e.target.value)} /></Field>
            <Field label="Voice quality">
              <select value={profile} onChange={(e) => setProfile(e.target.value)} className={`${SELECT_CLS} w-full`}>
                <option value="">Default</option>
                {profiles.map((p) => <option key={p.id} value={p.id}>{p.display_name}{p.tier ? ` (${p.tier})` : ""}</option>)}
              </select>
            </Field>
            <Field label="Client admin email (optional)"><Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} /></Field>
          </div>
        )}
        <DialogFooter>
          {invite ? <Button onClick={close}>Done</Button> : (
            <>
              <Button variant="outline" onClick={close}>Cancel</Button>
              <Button onClick={submit} disabled={busy || name.trim().length < 2}>Create</Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function EditDialog({
  client, currency, onClose, onDone,
}: { client: ResellerClientView; currency: string; onClose: () => void; onDone: () => void }) {
  const [name, setName] = useState(client.name ?? "");
  const [rate, setRate] = useState(String(client.billing_rate));
  const [pulse, setPulse] = useState(String(client.billing_pulse));
  const [allowance, setAllowance] = useState(String(client.monthly_minutes_limit));
  const [carry, setCarry] = useState(client.monthly_carry_forward);
  const [overdraft, setOverdraft] = useState(client.allow_overdraft);
  const [active, setActive] = useState(client.is_active);
  const [busy, setBusy] = useState(false);

  const save = async () => {
    setBusy(true);
    try {
      await resellerApi("PATCH", `/clients/${client.id}`, {
        name,
        billing_rate: num(rate),
        billing_pulse: Number(pulse),
        monthly_minutes_limit: num(allowance),
        monthly_carry_forward: carry,
        allow_overdraft: overdraft,
        is_active: active,
      });
      toast.success("Client updated");
      onDone();
      onClose();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to update");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-[460px]">
        <DialogHeader>
          <DialogTitle>Edit {client.name}</DialogTitle>
          <DialogDescription>Changes apply from the next call. Monthly minutes apply from the next reset.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3 py-2">
          <Field label="Name"><Input value={name} onChange={(e) => setName(e.target.value)} /></Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label={`Overage rate (${currency}/min)`}><Input type="number" min="0" step="0.01" value={rate} onChange={(e) => setRate(e.target.value)} /></Field>
            <Field label="Billing pulse">
              <select value={pulse} onChange={(e) => setPulse(e.target.value)} className={`${SELECT_CLS} w-full`}>
                <option value="1">1 second</option><option value="15">15 seconds</option>
                <option value="30">30 seconds</option><option value="60">60 seconds</option>
              </select>
            </Field>
          </div>
          <Field label="Monthly minutes"><Input type="number" min="0" value={allowance} onChange={(e) => setAllowance(e.target.value)} /></Field>
          <Check checked={carry} onChange={setCarry} label="Unused monthly minutes roll over" />
          <Check checked={overdraft} onChange={setOverdraft} label="Never block calls (allow overdraft)" />
          <Check checked={active} onChange={setActive} label="Workspace active (untick to suspend)" />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={save} disabled={busy}>Save</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function MinutesDialog({ client, onClose, onDone }: { client: ResellerClientView; onClose: () => void; onDone: () => void }) {
  const [minutes, setMinutes] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);

  const run = async (action: "grant-minutes" | "deduct-minutes") => {
    setBusy(true);
    try {
      await resellerApi("POST", `/clients/${client.id}/wallet/${action}`, {
        minutes: num(minutes),
        description: note || undefined,
      });
      toast.success(action === "grant-minutes" ? "Minutes added" : "Minutes removed");
      onDone();
      onClose();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-[420px]">
        <DialogHeader>
          <DialogTitle>Minutes for {client.name}</DialogTitle>
          <DialogDescription>
            Currently {client.wallet ? formatMinutes(client.wallet.minutes_remaining) : "-"} left. You are only charged when the client actually uses them.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3 py-2">
          <Field label="Minutes"><Input type="number" min="0" step="0.1" value={minutes} onChange={(e) => setMinutes(e.target.value)} /></Field>
          <Field label="Note (optional)"><Input value={note} onChange={(e) => setNote(e.target.value)} /></Field>
        </div>
        <DialogFooter>
          <Button variant="outline" disabled={busy || num(minutes) <= 0} onClick={() => run("deduct-minutes")}>Remove</Button>
          <Button disabled={busy || num(minutes) <= 0} onClick={() => run("grant-minutes")}>Add</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function InviteDialog({ client, onClose }: { client: ResellerClientView; onClose: () => void }) {
  const [email, setEmail] = useState("");
  const [role, setRole] = useState("admin");
  const [url, setUrl] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const create = async () => {
    setBusy(true);
    try {
      const res = await resellerApi<{ invite_url: string }>("POST", `/clients/${client.id}/invite`, { email, role });
      setUrl(res.invite_url);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to create invite");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-[460px]">
        <DialogHeader>
          <DialogTitle>Invite someone to {client.name}</DialogTitle>
          <DialogDescription>The link is valid for 7 days and only works for the email below.</DialogDescription>
        </DialogHeader>
        {url ? (
          <CopyField value={url} />
        ) : (
          <div className="space-y-3 py-2">
            <Field label="Email"><Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} /></Field>
            <Field label="Role">
              <select value={role} onChange={(e) => setRole(e.target.value)} className={`${SELECT_CLS} w-full`}>
                <option value="admin">Admin - can configure the workspace</option>
                <option value="client">Client - limited access</option>
              </select>
            </Field>
          </div>
        )}
        <DialogFooter>
          {url ? <Button onClick={onClose}>Done</Button> : (
            <>
              <Button variant="outline" onClick={onClose}>Cancel</Button>
              <Button onClick={create} disabled={busy || !email}>Create link</Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <Label className="text-xs">{label}</Label>
      {children}
    </div>
  );
}

function Check({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <label className="flex items-center gap-2 text-sm">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} className="h-4 w-4" />
      {label}
    </label>
  );
}

function CopyField({ value }: { value: string }) {
  return (
    <div className="flex items-center gap-2 py-2">
      <Input readOnly value={value} onFocus={(e) => e.currentTarget.select()} />
      <Button
        variant="outline"
        size="icon"
        onClick={() => {
          navigator.clipboard.writeText(value);
          toast.success("Copied");
        }}
      >
        <Copy className="h-4 w-4" />
      </Button>
    </div>
  );
}
