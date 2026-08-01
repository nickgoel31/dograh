"use client";

import { AlertTriangle, ArrowRight, Bot, Building2, MoreHorizontal, Plus, Search, Settings2, Trash2, UserMinus,Users, Shield } from 'lucide-react';
import { useEffect, useState } from "react";
import { toast } from "sonner";

import { client } from "@/client/client.gen";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription,CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useAuth } from '@/lib/auth';

interface Organization {
  id: number;
  name: string;
  slug: string;
  provider_id: string;
  created_at: string;
  is_active: boolean;
  member_count: number;
  admin_count: number;
  client_count: number;
  agent_count: number;
  balance?: number;
  base_balance?: number;
  billing_rate?: number;
  billing_pulse?: number;
  monthly_minutes_limit?: number;
  monthly_minutes_start_year?: number;
  monthly_minutes_start_month?: number;
  monthly_minutes_end_year?: number | null;
  monthly_minutes_end_month?: number | null;
  quota_reset_day?: number | null;
  whatsapp_enabled?: boolean;
  whatsapp_phone_number_id?: string;
  whatsapp_business_account_id?: string;
  whatsapp_webhook_verify_token?: string;
  whatsapp_has_access_token?: boolean;
}


export default function SuperadminPage() {
    const { user, getAccessToken } = useAuth();

    const [organizations, setOrganizations] = useState<Organization[]>([]);
    const [loading, setLoading] = useState(true);
    const [searchQuery, setSearchQuery] = useState("");

    // Create Org State
    const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
    const [newOrgName, setNewOrgName] = useState("");
    const [isCreating, setIsCreating] = useState(false);
    const slugPreview = newOrgName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)+/g, '');

    // Impersonate state
    const [isSwitching, setIsSwitching] = useState(false);

    // Manage Members State
    const [selectedOrgForMembers, setSelectedOrgForMembers] = useState<number | null>(null);
    const [orgMembers, setOrgMembers] = useState<any[]>([]);
    const [loadingMembers, setLoadingMembers] = useState(false);

    // Edit Wallet/Billing State
    const [isEditBillingOpen, setIsEditBillingOpen] = useState(false);
    const [editingOrg, setEditingOrg] = useState<Organization | null>(null);
    const [editBalance, setEditBalance] = useState<number>(0);
    const [editBillingRate, setEditBillingRate] = useState<number>(0);
    const [editBillingPulse, setEditBillingPulse] = useState<number>(60);
    const [editMonthlyMinutesLimit, setEditMonthlyMinutesLimit] = useState<number>(0);
    const [editCycleYear, setEditCycleYear] = useState<number>(new Date().getFullYear());
    const [editCycleMonth, setEditCycleMonth] = useState<number>(new Date().getMonth() + 1);
    const [editCustomMinutesUsed, setEditCustomMinutesUsed] = useState<number | "">("");
    const [editCycleTopupMinutes, setEditCycleTopupMinutes] = useState<number | "">("");
    const [editQuotaResetDay, setEditQuotaResetDay] = useState<number>(1);
    const [editStartYear, setEditStartYear] = useState<number | "">("");
    const [editStartMonth, setEditStartMonth] = useState<number | "">("");
    const [editEndYear, setEditEndYear] = useState<number | "">("");
    const [editEndMonth, setEditEndMonth] = useState<number | "">("");
    const [editWhatsAppEnabled, setEditWhatsAppEnabled] = useState<boolean>(false);
    const [editWhatsAppPhoneNumberId, setEditWhatsAppPhoneNumberId] = useState<string>("");
    const [editWhatsAppAccessToken, setEditWhatsAppAccessToken] = useState<string>("");
    const [editWhatsAppBusinessAccountId, setEditWhatsAppBusinessAccountId] = useState<string>("");
    const [whatsappWebhookVerifyToken, setWhatsappWebhookVerifyToken] = useState<string>("");
    const [whatsappHasAccessToken, setWhatsappHasAccessToken] = useState<boolean>(false);


    const [runs, setRuns] = useState<any[]>([]);
    const [loadingRuns, setLoadingRuns] = useState(false);
    const [hasFetchedRuns, setHasFetchedRuns] = useState(false);
    const [isSavingBilling, setIsSavingBilling] = useState(false);

    useEffect(() => {
        setRuns([]);
        setHasFetchedRuns(false);
    }, [editCycleYear, editCycleMonth, editingOrg]);

    useEffect(() => {
        if (user) {
            fetchOrganizations();
        }
    }, [user]);

    const fetchOrganizations = async () => {
        setLoading(true);
        try {
            const res = await client.request<Organization[]>({
                method: "GET",
                url: `/api/v1/superuser/organizations`,
            });
            if (res.data) {
                setOrganizations(res.data);
            }
        } catch {
            toast.error("Failed to fetch organizations");
        } finally {
            setLoading(false);
        }
    };

    const handleManageMembers = async (orgId: number) => {
        setSelectedOrgForMembers(orgId);
        setLoadingMembers(true);
        try {
            const res = await client.request<any[]>({
                method: "GET",
                url: `/api/v1/superuser/organizations/${orgId}/members`,
            });
            if (res.data) {
                setOrgMembers(res.data);
            }
        } catch {
            toast.error("Failed to fetch organization members");
        } finally {
            setLoadingMembers(false);
        }
    };

    const handleRemoveMember = async (orgId: number, userId: number) => {
        try {
            await client.request({
                method: "POST",
                url: `/api/v1/superuser/organizations/${orgId}/remove-user`,
                body: { user_id: userId }
            });
            toast.success("Member removed");
            fetchOrganizations();
            handleManageMembers(orgId);
        } catch (error: any) {
            toast.error(error.response?.data?.detail || "Failed to remove member");
        }
    };

    const handleCreateOrganization = async (e: React.FormEvent) => {
        e.preventDefault();
        setIsCreating(true);
        try {
            const { error } = await client.request({
                method: "POST",
                url: "/api/v1/superuser/organizations",
                body: { name: newOrgName }
            });
            if (error) {
                toast.error((error as any)?.detail || "Failed to create organization");
                return;
            }
            toast.success("Organization created successfully");
            setNewOrgName("");
            setIsCreateModalOpen(false);
            fetchOrganizations();
        } catch (error: any) {
            toast.error(error.response?.data?.detail || "Failed to create organization");
        } finally {
            setIsCreating(false);
        }
    };

    const handleToggleActive = async (orgId: number, currentActive: boolean) => {
        try {
            await client.request({
                method: "PATCH",
                url: `/api/v1/superuser/organizations/${orgId}`,
                body: { is_active: !currentActive }
            });
            toast.success("Organization status updated");
            fetchOrganizations();
        } catch {
            toast.error("Failed to update organization status");
        }
    };

    const handleSwitchToOrg = async (orgId: number) => {
        setIsSwitching(true);
        try {
            const res = await client.request({
                method: "POST",
                url: "/api/v1/superuser/switch-org",
                body: { org_id: orgId }
            }) as any;

            if (res.data?.access_token) {
                // Store impersonation token in sessionStorage
                sessionStorage.setItem("impersonation_token", res.data.access_token);
                toast.success(`Switched to ${res.data.org_name}`);

                // Hard reload to redirect user to dashboard with the new token
                window.location.href = "/dashboard";
            }
        } catch (error: any) {
            toast.error(error.response?.data?.detail || "Failed to switch organization");
        } finally {
            setIsSwitching(false);
        }
    };

    const fetchRunsForAudit = async () => {
        if (!editingOrg) return;
        setLoadingRuns(true);
        try {
            const res = await client.request<any[]>({
                method: "GET",
                url: `/api/v1/superuser/organizations/${editingOrg.id}/runs`,
                query: {
                    year: editCycleYear,
                    month: editCycleMonth,
                }
            });
            if (res.data) {
                setRuns(res.data);
                setHasFetchedRuns(true);
            }
        } catch {
            toast.error("Failed to fetch runs for audit");
        } finally {
            setLoadingRuns(false);
        }
    };

    const handleDeleteRun = async (runId: number) => {
        if (!confirm("Are you sure you want to delete this run? It will be removed from billing and the monthly minutes will be recalculated.")) {
            return;
        }
        try {
            await client.request({
                method: "DELETE",
                url: `/api/v1/superuser/runs/${runId}`,
            });
            toast.success("Run deleted and billing minutes recalculated");
            fetchRunsForAudit();
            fetchOrganizations();
        } catch {
            toast.error("Failed to delete run");
        }
    };

    const handleSaveBilling = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!editingOrg) return;
        setIsSavingBilling(true);
        try {
            await client.request({
                method: "PATCH",
                url: `/api/v1/superuser/organizations/${editingOrg.id}`,
                body: {
                    balance: editBalance,
                    billing_rate: editBillingRate,
                    billing_pulse: editBillingPulse,
                    monthly_minutes_limit: editMonthlyMinutesLimit,
                    monthly_minutes_start_year: editStartYear !== "" ? Number(editStartYear) : null,
                    monthly_minutes_start_month: editStartMonth !== "" ? Number(editStartMonth) : null,
                    monthly_minutes_end_year: editEndYear !== "" ? Number(editEndYear) : null,
                    monthly_minutes_end_month: editEndMonth !== "" ? Number(editEndMonth) : null,
                    cycle_year: editCycleYear,
                    cycle_month: editCycleMonth,
                    custom_minutes_used: editCustomMinutesUsed === "" ? null : editCustomMinutesUsed,
                    cycle_topup_minutes: editCycleTopupMinutes === "" ? null : editCycleTopupMinutes,
                    whatsapp_enabled: editWhatsAppEnabled,
                    whatsapp_phone_number_id: editWhatsAppPhoneNumberId || null,
                    whatsapp_access_token: editWhatsAppAccessToken || null,
                    whatsapp_business_account_id: editWhatsAppBusinessAccountId || null,
                    quota_reset_day: editQuotaResetDay,
                }
            });
            toast.success("Wallet & Billing configuration updated");
            setIsEditBillingOpen(false);
            fetchOrganizations();
        } catch (error: any) {
            toast.error(error.response?.data?.detail || "Failed to update configuration");
        } finally {
            setIsSavingBilling(false);
        }
    };

    const filteredOrgs = organizations.filter(org =>
        (org.name || "").toLowerCase().includes(searchQuery.toLowerCase()) ||
        (org.slug || "").toLowerCase().includes(searchQuery.toLowerCase())
    );

    // Calculate overall stats
    const totalOrgs = organizations.length;
    const totalAgents = organizations.reduce((sum, org) => sum + org.agent_count, 0);
    const totalMembers = organizations.reduce((sum, org) => sum + org.member_count, 0);

    return (
        <main className="container mx-auto p-6 space-y-6 max-w-7xl fade-in-up">
            <div className="flex flex-col md:flex-row md:items-end justify-between gap-4 mb-6 page-header">
                <div>
                    <h1 className="text-3xl font-extrabold tracking-tight mb-1 flex items-center gap-3">
                        <div className="icon-container">
                            <Shield className="h-6 w-6" />
                        </div>
                        Platform Overview
                    </h1>
                    <p className="text-muted-foreground mt-2">Manage organizations and system-wide data</p>
                </div>

                <div className="flex items-center gap-3">
                    <Dialog open={isCreateModalOpen} onOpenChange={setIsCreateModalOpen}>
                        <DialogTrigger asChild>
                            <Button>
                                <Plus className="w-4 h-4 mr-2" />
                                New Organization
                            </Button>
                        </DialogTrigger>
                        <DialogContent>
                            <form onSubmit={handleCreateOrganization}>
                                <DialogHeader>
                                    <DialogTitle>Create Organization</DialogTitle>
                                    <DialogDescription>
                                        Create a new isolated organization on the platform.
                                    </DialogDescription>
                                </DialogHeader>
                                <div className="py-4 space-y-4">
                                    <div className="space-y-2">
                                        <Label htmlFor="orgName">Organization Name</Label>
                                        <Input
                                            id="orgName"
                                            placeholder="Acme Corp"
                                            value={newOrgName}
                                            onChange={(e) => setNewOrgName(e.target.value)}
                                            required
                                        />
                                        {newOrgName && (
                                            <p className="text-xs text-muted-foreground mt-1">
                                                Slug: <span className="font-mono bg-muted px-1.5 py-0.5 rounded">{slugPreview}</span>
                                            </p>
                                        )}
                                    </div>
                                </div>
                                <DialogFooter>
                                    <Button variant="outline" type="button" onClick={() => setIsCreateModalOpen(false)}>Cancel</Button>
                                    <Button type="submit" disabled={isCreating || !newOrgName.trim()}>
                                        {isCreating ? 'Creating...' : 'Create Organization'}
                                    </Button>
                                </DialogFooter>
                            </form>
                        </DialogContent>
                    </Dialog>
                </div>
            </div>

            {/* Quick Stats */}
            <div className="grid gap-4 md:grid-cols-3 stagger-children">
                <Card className="glass-card fade-in-up">
                    <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                        <CardTitle className="text-sm font-medium">Total Organizations</CardTitle>
                        <Building2 className="h-4 w-4 text-muted-foreground" />
                    </CardHeader>
                    <CardContent>
                        <div className="text-2xl font-bold">{loading ? '-' : totalOrgs}</div>
                    </CardContent>
                </Card>
                <Card className="glass-card fade-in-up">
                    <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                        <CardTitle className="text-sm font-medium">Total Workflows (Agents)</CardTitle>
                        <Bot className="h-4 w-4 text-muted-foreground" />
                    </CardHeader>
                    <CardContent>
                        <div className="text-2xl font-bold">{loading ? '-' : totalAgents}</div>
                    </CardContent>
                </Card>
                <Card className="glass-card fade-in-up">
                    <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                        <CardTitle className="text-sm font-medium">Total Members</CardTitle>
                        <Users className="h-4 w-4 text-muted-foreground" />
                    </CardHeader>
                    <CardContent>
                        <div className="text-2xl font-bold">{loading ? '-' : totalMembers}</div>
                    </CardContent>
                </Card>
            </div>

            {/* Organizations Table */}
            <Card className="glass-card fade-in-up" style={{ animationDelay: '0.3s' }}>
                <CardHeader>
                    <div className="flex items-center justify-between">
                        <div>
                            <CardTitle>Organizations</CardTitle>
                            <CardDescription>
                                Manage all organizations operating on the platform.
                            </CardDescription>
                        </div>
                        <div className="relative w-64">
                            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                            <Input
                                type="search"
                                placeholder="Search organizations..."
                                className="pl-8"
                                value={searchQuery}
                                onChange={(e) => setSearchQuery(e.target.value)}
                            />
                        </div>
                    </div>
                </CardHeader>
                <CardContent>
                    {loading ? (
                        <div className="flex justify-center items-center py-12">
                            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
                        </div>
                    ) : (
                        <div className="rounded-md border">
                            <Table>
                                <TableHeader>
                                    <TableRow>
                                        <TableHead>Name</TableHead>
                                        <TableHead>Members</TableHead>
                                        <TableHead>Agents</TableHead>
                                        <TableHead>Wallet (₹)</TableHead>
                                        <TableHead>Monthly Limit</TableHead>
                                        <TableHead>Billing Rate</TableHead>
                                        <TableHead>Pulse</TableHead>
                                        <TableHead>Status</TableHead>
                                        <TableHead>Created</TableHead>
                                        <TableHead className="text-right">Actions</TableHead>
                                    </TableRow>
                                </TableHeader>
                                <TableBody>
                                    {filteredOrgs.length === 0 ? (
                                        <TableRow>
                                            <TableCell colSpan={10} className="text-center py-8 text-muted-foreground">
                                                No organizations found
                                            </TableCell>
                                        </TableRow>
                                    ) : (
                                        filteredOrgs.map((org) => (
                                            <TableRow key={org.id}>
                                                <TableCell>
                                                    <div className="font-medium">{org.name || "Unnamed Organization"}</div>
                                                    <div className="text-xs text-muted-foreground font-mono">{org.slug || org.provider_id}</div>
                                                </TableCell>
                                                <TableCell>
                                                    <div className="flex items-center gap-2">
                                                        <span>{org.member_count}</span>
                                                        <span className="text-xs text-muted-foreground">
                                                            ({org.admin_count} admin, {org.client_count} client)
                                                        </span>
                                                        {org.admin_count === 0 && org.is_active && (
                                                            <div title="Organization has no admin" className="text-yellow-600">
                                                                <AlertTriangle className="h-4 w-4" />
                                                            </div>
                                                        )}
                                                    </div>
                                                </TableCell>
                                                <TableCell>{org.agent_count}</TableCell>
                                                <TableCell className="font-medium text-emerald-600 dark:text-emerald-400">
                                                    ₹{(org.balance ?? 0).toFixed(2)}
                                                </TableCell>
                                                <TableCell className="font-mono text-xs">
                                                    {org.monthly_minutes_limit ? `${org.monthly_minutes_limit} min` : "No limit"}
                                                </TableCell>
                                                <TableCell>
                                                    ₹{(org.billing_rate ?? 0).toFixed(2)}/min
                                                </TableCell>
                                                <TableCell>
                                                    <Badge variant="outline">
                                                        {org.billing_pulse === 1 ? '1 sec' :
                                                         org.billing_pulse === 15 ? '15 sec' :
                                                         org.billing_pulse === 30 ? '30 sec' :
                                                         '60 sec'}
                                                    </Badge>
                                                </TableCell>
                                                <TableCell>
                                                    <Badge variant={org.is_active ? "default" : "destructive"}>
                                                        {org.is_active ? 'Active' : 'Disabled'}
                                                    </Badge>
                                                </TableCell>
                                                <TableCell className="text-sm text-muted-foreground">
                                                    {new Date(org.created_at).toLocaleDateString()}
                                                </TableCell>
                                                <TableCell className="text-right">
                                                    <DropdownMenu>
                                                        <DropdownMenuTrigger asChild>
                                                            <Button variant="ghost" className="h-8 w-8 p-0">
                                                                <span className="sr-only">Open menu</span>
                                                                <MoreHorizontal className="h-4 w-4" />
                                                            </Button>
                                                        </DropdownMenuTrigger>
                                                        <DropdownMenuContent align="end">
                                                            <DropdownMenuLabel>Actions</DropdownMenuLabel>
                                                            <DropdownMenuItem onClick={() => handleSwitchToOrg(org.id)} disabled={!org.is_active || isSwitching}>
                                                                <ArrowRight className="mr-2 h-4 w-4" />
                                                                Switch to Workspace
                                                            </DropdownMenuItem>
                                                            <DropdownMenuItem onClick={() => handleManageMembers(org.id)}>
                                                                <Users className="mr-2 h-4 w-4" />
                                                                Manage Members
                                                            </DropdownMenuItem>
                                                            <DropdownMenuItem onClick={() => {
                                                                setEditingOrg(org);
                                                                setEditMonthlyMinutesLimit(org.monthly_minutes_limit ?? 0);
                                                                setEditCycleYear(new Date().getFullYear());
                                                                setEditCycleMonth(new Date().getMonth() + 1);
                                                                setEditCustomMinutesUsed("");
                                                                setEditCycleTopupMinutes("");
                                                                setEditBalance(org.base_balance ?? org.balance ?? 0);
                                                                setEditBillingRate(org.billing_rate ?? 0);
                                                                setEditBillingPulse(org.billing_pulse ?? 60);
                                                                setEditStartYear(org.monthly_minutes_start_year ?? "");
                                                                setEditStartMonth(org.monthly_minutes_start_month ?? "");
                                                                setEditEndYear(org.monthly_minutes_end_year ?? "");
                                                                setEditEndMonth(org.monthly_minutes_end_month ?? "");
                                                                setEditQuotaResetDay(org.quota_reset_day ?? 1);
                                                                setEditWhatsAppEnabled(org.whatsapp_enabled ?? false);
                                                                setEditWhatsAppPhoneNumberId(org.whatsapp_phone_number_id ?? "");
                                                                setEditWhatsAppAccessToken("");
                                                                setEditWhatsAppBusinessAccountId(org.whatsapp_business_account_id ?? "");
                                                                setWhatsappWebhookVerifyToken(org.whatsapp_webhook_verify_token ?? "");
                                                                setWhatsappHasAccessToken(org.whatsapp_has_access_token ?? false);
                                                                setIsEditBillingOpen(true);

                                                            }}>
                                                                <Settings2 className="mr-2 h-4 w-4" />
                                                                Wallet & Billing
                                                            </DropdownMenuItem>
                                                            <DropdownMenuSeparator />
                                                            <DropdownMenuItem onClick={() => handleToggleActive(org.id, org.is_active)}>
                                                                {org.is_active ? (
                                                                    <><Trash2 className="mr-2 h-4 w-4 text-red-500" /> Disable Organization</>
                                                                ) : (
                                                                    <><Settings2 className="mr-2 h-4 w-4" /> Enable Organization</>
                                                                )}
                                                            </DropdownMenuItem>
                                                        </DropdownMenuContent>
                                                    </DropdownMenu>
                                                </TableCell>
                                            </TableRow>
                                        ))
                                    )}
                                </TableBody>
                            </Table>
                        </div>
                    )}
                </CardContent>
            </Card>

            {/* Manage Members Side Panel */}
            <Sheet open={selectedOrgForMembers !== null} onOpenChange={(open) => !open && setSelectedOrgForMembers(null)}>
                <SheetContent className="w-[400px] sm:w-[540px]">
                    <SheetHeader>
                        <SheetTitle>Manage Organization Members</SheetTitle>
                        <SheetDescription>
                            View and remove members from this organization.
                        </SheetDescription>
                    </SheetHeader>
                    <div className="py-6">
                        {loadingMembers ? (
                            <div className="flex justify-center items-center py-12">
                                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
                            </div>
                        ) : orgMembers.length === 0 ? (
                            <div className="text-center py-8 text-muted-foreground">
                                No members found in this organization.
                            </div>
                        ) : (
                            <div className="space-y-4">
                                {orgMembers.map(member => (
                                    <div key={member.id} className="flex items-center justify-between p-3 border rounded-md">
                                        <div className="flex flex-col">
                                            <span className="font-medium text-sm">{member.email || "No Email"}</span>
                                            <div className="flex items-center gap-2 mt-1">
                                                <Badge variant="outline" className="text-[10px]">
                                                    {member.role.toUpperCase()}
                                                </Badge>
                                                <span className="text-[10px] text-muted-foreground font-mono">
                                                    ID: {member.id}
                                                </span>
                                            </div>
                                        </div>
                                        <Button
                                            variant="ghost"
                                            size="sm"
                                            onClick={() => handleRemoveMember(selectedOrgForMembers!, member.id)}
                                            className="text-red-500 hover:text-red-600 hover:bg-red-50"
                                        >
                                            <UserMinus className="h-4 w-4" />
                                        </Button>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>
                </SheetContent>
            </Sheet>

            {/* Edit Wallet & Billing Dialog */}
            <Dialog open={isEditBillingOpen} onOpenChange={setIsEditBillingOpen}>
                <DialogContent className="sm:max-w-[500px] max-h-[85vh] overflow-y-auto">
                    <form onSubmit={handleSaveBilling}>
                        <DialogHeader>
                            <DialogTitle>Wallet & Billing Settings</DialogTitle>
                            <DialogDescription>
                                Configure wallet balance and billing parameters for {editingOrg?.name}.
                            </DialogDescription>
                        </DialogHeader>
                        <div className="py-4 space-y-4">
                            <div className="space-y-2">
                                <Label htmlFor="balance">Wallet Balance (₹)</Label>
                                <Input
                                    id="balance"
                                    type="number"
                                    step="0.01"
                                    min="0"
                                    value={editBalance}
                                    onChange={(e) => setEditBalance(parseFloat(e.target.value) || 0)}
                                    required
                                />
                                <div className="space-y-1">
                                    <p className="text-xs text-muted-foreground">
                                        Base balance in DB: ₹{(editingOrg?.base_balance ?? editingOrg?.balance ?? 0).toFixed(2)}
                                    </p>
                                    {(editingOrg?.base_balance === 0 || editingOrg?.base_balance == null) && editingOrg?.balance !== 0 && (
                                        <p className="text-xs font-medium text-emerald-600 dark:text-emerald-400">
                                            Dynamically calculated balance: ₹{(editingOrg?.balance ?? 0).toFixed(2)}
                                        </p>
                                    )}
                                </div>
                            </div>
                            <div className="space-y-2">
                                <Label htmlFor="billingRate">Billing Rate (₹ per minute)</Label>
                                <Input
                                    id="billingRate"
                                    type="number"
                                    step="0.01"
                                    min="0"
                                    value={editBillingRate}
                                    onChange={(e) => setEditBillingRate(parseFloat(e.target.value) || 0)}
                                    required
                                />
                                <p className="text-xs text-muted-foreground">
                                    Rate used to calculate call costs for this organization.
                                </p>
                            </div>
                            <div className="space-y-2">
                                <Label htmlFor="billingPulse">Billing Pulse</Label>
                                <select
                                    id="billingPulse"
                                    value={editBillingPulse}
                                    onChange={(e) => setEditBillingPulse(parseInt(e.target.value) || 60)}
                                    className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
                                >
                                    <option value={1}>1 Second</option>
                                    <option value={15}>15 Seconds</option>
                                    <option value={30}>30 Seconds</option>
                                    <option value={60}>60 Seconds (1 Minute)</option>
                                </select>
                                <p className="text-xs text-muted-foreground">
                                    Calls will be rounded up and charged in increments of this pulse duration.
                                </p>
                            </div>
                            <div className="space-y-2">
                                <Label htmlFor="monthlyMinutesLimit">Monthly Minutes Limit</Label>
                                <Input
                                    id="monthlyMinutesLimit"
                                    type="number"
                                    min="0"
                                    value={editMonthlyMinutesLimit}
                                    onChange={(e) => setEditMonthlyMinutesLimit(parseInt(e.target.value) || 0)}
                                    required
                                />
                                <p className="text-xs text-muted-foreground">
                                    Set monthly committed minutes. Set to 0 to disable minutes-based billing.
                                </p>
                            </div>
                            <div className="space-y-2">
                                <Label htmlFor="quotaResetDay">Billing Cycle Reset Day (1-28)</Label>
                                <Input
                                    id="quotaResetDay"
                                    type="number"
                                    min="1"
                                    max="28"
                                    value={editQuotaResetDay}
                                    onChange={(e) => setEditQuotaResetDay(parseInt(e.target.value) || 1)}
                                    required
                                />
                                <p className="text-xs text-muted-foreground">
                                    The day of the month when the billing cycle resets.
                                </p>
                            </div>
                            <div className="border-t pt-4 space-y-4">
                                <h4 className="text-sm font-semibold text-foreground">Active Contract Period</h4>
                                <p className="text-xs text-muted-foreground">
                                    Set the start and end month/year for the committed minutes contract. Leave empty/None to disable contract period gating.
                                </p>
                                <div className="grid grid-cols-2 gap-2">
                                    <div className="space-y-1">
                                        <Label htmlFor="startYear" className="text-xs">Start Year</Label>
                                        <Input
                                            id="startYear"
                                            type="number"
                                            placeholder="None"
                                            value={editStartYear}
                                            onChange={(e) => setEditStartYear(e.target.value === "" ? "" : parseInt(e.target.value) || "")}
                                        />
                                    </div>
                                    <div className="space-y-1">
                                        <Label htmlFor="startMonth" className="text-xs">Start Month</Label>
                                        <select
                                            id="startMonth"
                                            value={editStartMonth}
                                            onChange={(e) => setEditStartMonth(e.target.value === "" ? "" : parseInt(e.target.value) || "")}
                                            className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                                        >
                                            <option value="">None</option>
                                            {Array.from({ length: 12 }, (_, i) => (
                                                <option key={i + 1} value={i + 1}>
                                                    {new Date(0, i).toLocaleString('default', { month: 'long' })}
                                                </option>
                                            ))}
                                        </select>
                                    </div>
                                </div>
                                <div className="grid grid-cols-2 gap-2">
                                    <div className="space-y-1">
                                        <Label htmlFor="endYear" className="text-xs">End Year</Label>
                                        <Input
                                            id="endYear"
                                            type="number"
                                            placeholder="None"
                                            value={editEndYear}
                                            onChange={(e) => setEditEndYear(e.target.value === "" ? "" : parseInt(e.target.value) || "")}
                                        />
                                    </div>
                                    <div className="space-y-1">
                                        <Label htmlFor="endMonth" className="text-xs">End Month</Label>
                                        <select
                                            id="endMonth"
                                            value={editEndMonth}
                                            onChange={(e) => setEditEndMonth(e.target.value === "" ? "" : parseInt(e.target.value) || "")}
                                            className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                                        >
                                            <option value="">None</option>
                                            {Array.from({ length: 12 }, (_, i) => (
                                                <option key={i + 1} value={i + 1}>
                                                    {new Date(0, i).toLocaleString('default', { month: 'long' })}
                                                </option>
                                            ))}
                                        </select>
                                    </div>
                                </div>
                            </div>
                            <div className="border-t pt-4 space-y-4">
                                <h4 className="text-sm font-semibold text-foreground">Adjust Custom Usage Cycle Minutes</h4>
                                <p className="text-xs text-muted-foreground">
                                    Override or manually set minutes used for a specific cycle.
                                </p>
                                <div className="grid grid-cols-2 gap-2">
                                    <div className="space-y-1">
                                        <Label htmlFor="cycleYear" className="text-xs">Cycle Year</Label>
                                        <Input
                                            id="cycleYear"
                                            type="number"
                                            min="2020"
                                            max="2100"
                                            value={editCycleYear}
                                            onChange={(e) => setEditCycleYear(parseInt(e.target.value) || new Date().getFullYear())}
                                        />
                                    </div>
                                    <div className="space-y-1">
                                        <Label htmlFor="cycleMonth" className="text-xs">Cycle Month</Label>
                                        <select
                                            id="cycleMonth"
                                            value={editCycleMonth}
                                            onChange={(e) => setEditCycleMonth(parseInt(e.target.value) || new Date().getMonth() + 1)}
                                            className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                                        >
                                            {Array.from({ length: 12 }, (_, i) => (
                                                <option key={i + 1} value={i + 1}>
                                                    {new Date(0, i).toLocaleString('default', { month: 'long' })}
                                                </option>
                                            ))}
                                        </select>
                                    </div>
                                </div>
                                <div className="space-y-2 mt-4">
                                    <Label className="text-xs">Custom Minutes Used</Label>
                                    <div className="flex gap-2">
                                        <Input
                                            id="customMinutesUsed"
                                            type="number"
                                            step="0.1"
                                            min="0"
                                            value={editCustomMinutesUsed}
                                            onChange={(e) => setEditCustomMinutesUsed(e.target.value === "" ? "" : parseFloat(e.target.value) || "")}
                                            placeholder="System Calculated"
                                        />
                                        <Button
                                            type="button"
                                            variant="secondary"
                                            size="sm"
                                            onClick={() => setEditCustomMinutesUsed("")}
                                        >
                                            Use System
                                        </Button>
                                    </div>
                                    <p className="text-[10px] text-muted-foreground">
                                        Override system calculated minutes. Leave empty to use system calculation.
                                    </p>
                                </div>
                                <div className="space-y-2 mt-4">
                                    <Label htmlFor="cycleTopupMinutes" className="text-xs">Top Up Minutes</Label>
                                    <Input
                                        id="cycleTopupMinutes"
                                        type="number"
                                        min="0"
                                        step="0.1"
                                        placeholder="Add one-time minutes"
                                        value={editCycleTopupMinutes}
                                        onChange={(e) => setEditCycleTopupMinutes(e.target.value === "" ? "" : parseFloat(e.target.value) || "")}
                                    />
                                    <p className="text-[10px] text-muted-foreground">Adds extra minutes to this cycle that carry forward forever.</p>
                                </div>
                            <div className="border-t pt-4 space-y-4">
                                <h4 className="text-sm font-semibold text-foreground flex items-center justify-between">
                                    <span>WhatsApp Follow-Up Integration</span>
                                    <span className="text-[10px] text-muted-foreground font-normal">SuperAdmin Only</span>
                                </h4>
                                    <div className="flex items-center space-x-2">
                                        <input
                                            id="whatsappEnabled"
                                            type="checkbox"
                                            checked={editWhatsAppEnabled}
                                            onChange={(e) => setEditWhatsAppEnabled(e.target.checked)}
                                            className="h-4 w-4 rounded border-gray-300 text-indigo-600 focus:ring-indigo-500"
                                        />
                                        <Label htmlFor="whatsappEnabled" className="text-xs">Enable WhatsApp Follow-Up Feature</Label>
                                    </div>
                                    {editWhatsAppEnabled && (
                                        <div className="space-y-3 pl-6 border-l-2 border-indigo-100">
                                            <div className="space-y-1">
                                                <Label htmlFor="whatsappPhoneId" className="text-xs">Phone Number ID</Label>
                                                <Input
                                                    id="whatsappPhoneId"
                                                    placeholder="e.g. 106482619080753"
                                                    value={editWhatsAppPhoneNumberId}
                                                    onChange={(e) => setEditWhatsAppPhoneNumberId(e.target.value)}
                                                />
                                            </div>
                                            <div className="space-y-1">
                                                <Label htmlFor="whatsappBusinessId" className="text-xs">Business Account ID</Label>
                                                <Input
                                                    id="whatsappBusinessId"
                                                    placeholder="e.g. 102482319081234"
                                                    value={editWhatsAppBusinessAccountId}
                                                    onChange={(e) => setEditWhatsAppBusinessAccountId(e.target.value)}
                                                />
                                            </div>
                                            <div className="space-y-1">
                                                <Label htmlFor="whatsappToken" className="text-xs flex justify-between">
                                                    <span>Permanent Access Token</span>
                                                    {whatsappHasAccessToken && (
                                                        <span className="text-[10px] text-green-600 font-medium">✓ Token Configured</span>
                                                    )}
                                                </Label>
                                                <Input
                                                    id="whatsappToken"
                                                    type="password"
                                                    placeholder={whatsappHasAccessToken ? "••••••••••••••••" : "Enter Graph API Token"}
                                                    value={editWhatsAppAccessToken}
                                                    onChange={(e) => setEditWhatsAppAccessToken(e.target.value)}
                                                />
                                                <p className="text-[10px] text-muted-foreground">
                                                    Token is stored encrypted. Enter a new token to overwrite.
                                                </p>
                                            </div>
                                            {whatsappWebhookVerifyToken && (
                                                <div className="bg-muted p-2 rounded text-xs space-y-1">
                                                    <div className="font-semibold text-muted-foreground">Webhook Verification Config:</div>
                                                    <div className="font-mono text-[10px] select-all bg-background p-1.5 rounded border break-all">
                                                        URL: {typeof window !== 'undefined' ? window.location.origin : ''}/api/v1/whatsapp/webhook/{editingOrg?.id}
                                                    </div>
                                                    <div className="font-mono text-[10px] select-all bg-background p-1.5 rounded border break-all">
                                                        Verify Token: {whatsappWebhookVerifyToken}
                                                    </div>
                                                </div>
                                            )}
                                        </div>
                                    )}
                                </div>

                                <div className="border-t pt-4 space-y-4">
                                    <h4 className="text-sm font-semibold text-foreground">Audit Agent Runs (Call Logs)</h4>
                                    <p className="text-xs text-muted-foreground">
                                        View or delete individual runs for the selected cycle month and year. Deleting a run automatically recalculates the cycle's used minutes.
                                    </p>
                                    <div className="flex gap-2">
                                        <Button
                                            type="button"
                                            variant="outline"
                                            size="sm"
                                            onClick={fetchRunsForAudit}
                                            disabled={loadingRuns}
                                            className="w-full"
                                        >
                                            {loadingRuns ? "Fetching runs..." : "Fetch runs for selected cycle"}
                                        </Button>
                                    </div>
                                    
                                    {runs.length > 0 && (
                                        <div className="max-h-60 overflow-y-auto space-y-2 border rounded-md p-2 bg-muted/20">
                                            {runs.map((run) => (
                                                <div key={run.id} className="flex items-center justify-between p-2 border rounded bg-background text-xs">
                                                    <div className="flex-1 min-w-0 pr-2">
                                                        <div className="font-medium text-foreground truncate">{run.workflow_name || "Agent"}</div>
                                                        <div className="text-[10px] text-muted-foreground">
                                                            {new Date(run.created_at).toLocaleString()} • {run.duration_seconds}s
                                                        </div>
                                                    </div>
                                                    <Button
                                                        type="button"
                                                        variant="ghost"
                                                        size="sm"
                                                        onClick={() => handleDeleteRun(run.id)}
                                                        className="text-red-500 hover:text-red-600 h-7 w-7 p-0 flex-shrink-0"
                                                    >
                                                        <Trash2 className="h-3.5 w-3.5" />
                                                    </Button>
                                                </div>
                                            ))}
                                        </div>
                                    )}
                                    {runs.length === 0 && hasFetchedRuns && (
                                        <p className="text-xs text-center text-muted-foreground py-2">No runs found for this period.</p>
                                    )}
                                </div>
                            </div>
                        </div>
                        <DialogFooter>
                            <Button variant="outline" type="button" onClick={() => setIsEditBillingOpen(false)}>
                                Cancel
                            </Button>
                            <Button type="submit" disabled={isSavingBilling}>
                                {isSavingBilling ? 'Saving...' : 'Save Changes'}
                            </Button>
                        </DialogFooter>
                    </form>
                </DialogContent>
            </Dialog>
        </main>
    );
}
