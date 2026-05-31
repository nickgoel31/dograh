"use client";

import { AlertTriangle, ArrowRight, Bot, Building2, MoreHorizontal, Plus, Search, Settings2, Trash2, UserMinus,Users } from 'lucide-react';
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

    const filteredOrgs = organizations.filter(org =>
        (org.name || "").toLowerCase().includes(searchQuery.toLowerCase()) ||
        (org.slug || "").toLowerCase().includes(searchQuery.toLowerCase())
    );

    // Calculate overall stats
    const totalOrgs = organizations.length;
    const totalAgents = organizations.reduce((sum, org) => sum + org.agent_count, 0);
    const totalMembers = organizations.reduce((sum, org) => sum + org.member_count, 0);

    return (
        <main className="container mx-auto p-6 space-y-6 max-w-7xl">
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-6">
                <div>
                    <h1 className="text-3xl font-bold mb-2">Platform Overview</h1>
                    <p className="text-sm text-muted-foreground">Manage organizations and system-wide data</p>
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
            <div className="grid gap-4 md:grid-cols-3">
                <Card>
                    <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                        <CardTitle className="text-sm font-medium">Total Organizations</CardTitle>
                        <Building2 className="h-4 w-4 text-muted-foreground" />
                    </CardHeader>
                    <CardContent>
                        <div className="text-2xl font-bold">{loading ? '-' : totalOrgs}</div>
                    </CardContent>
                </Card>
                <Card>
                    <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                        <CardTitle className="text-sm font-medium">Total Workflows (Agents)</CardTitle>
                        <Bot className="h-4 w-4 text-muted-foreground" />
                    </CardHeader>
                    <CardContent>
                        <div className="text-2xl font-bold">{loading ? '-' : totalAgents}</div>
                    </CardContent>
                </Card>
                <Card>
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
            <Card>
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
                                        <TableHead>Status</TableHead>
                                        <TableHead>Created</TableHead>
                                        <TableHead className="text-right">Actions</TableHead>
                                    </TableRow>
                                </TableHeader>
                                <TableBody>
                                    {filteredOrgs.length === 0 ? (
                                        <TableRow>
                                            <TableCell colSpan={6} className="text-center py-8 text-muted-foreground">
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
        </main>
    );
}
