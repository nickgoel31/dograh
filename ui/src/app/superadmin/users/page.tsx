"use client";

import { ChevronLeft, ChevronRight, Loader2, Shield, UserCheck } from 'lucide-react';
import { useEffect, useState } from "react";
import { toast } from "sonner";

import { client } from "@/client/client.gen";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useAuth } from '@/lib/auth';
import { impersonateAsSuperadmin } from "@/lib/utils";

interface PlatformUser {
  id: number;
  email: string | null;
  role: string;
  is_superuser: boolean;
  created_at: string;
  selected_organization_id: number | null;
  provider_id: string | null;
  org_name: string | null;
}

interface UsersListResponse {
  users: PlatformUser[];
  total_count: number;
  page: number;
  limit: number;
  total_pages: number;
}

export default function SuperadminUsersPage() {
    const { user, getAccessToken } = useAuth();

    // User management state
    const [users, setUsers] = useState<PlatformUser[]>([]);
    const [loadingUsers, setLoadingUsers] = useState(true);
    const [page, setPage] = useState(1);
    const [totalPages, setTotalPages] = useState(1);
    const [totalCount, setTotalCount] = useState(0);

    const [organizations, setOrganizations] = useState<any[]>([]);
    const [selectedOrgFilter, setSelectedOrgFilter] = useState<string>("all");

    // Assign User State
    const [assignUserModalOpen, setAssignUserModalOpen] = useState<{userId: number | null, open: boolean}>({userId: null, open: false});
    const [assignOrgId, setAssignOrgId] = useState<string>("");
    const [assignRole, setAssignRole] = useState<string>("client");

    useEffect(() => {
        if (user) {
            fetchOrgs();
        }
    }, [user]);

    useEffect(() => {
        if (user) {
            fetchUsers(page, selectedOrgFilter);
        }
    }, [user, page, selectedOrgFilter]);

    const fetchOrgs = async () => {
        try {
            const res = await client.request<any[]>({
                method: "GET",
                url: `/api/v1/superuser/organizations`,
            });
            if (res.data) setOrganizations(res.data);
        } catch {
            // ignore
        }
    };

    const fetchUsers = async (targetPage: number, orgIdFilter: string) => {
        setLoadingUsers(true);
        try {
            let url = `/api/v1/superuser/users?page=${targetPage}&limit=10`;
            if (orgIdFilter && orgIdFilter !== "all") {
                url += `&org_id=${orgIdFilter}`;
            }
            const res = await client.request<UsersListResponse>({
                method: "GET",
                url: url,
            });
            if (res.data) {
                setUsers(res.data.users);
                setTotalPages(res.data.total_pages);
                setTotalCount(res.data.total_count);
            }
        } catch {
            toast.error("Failed to fetch platform users");
        } finally {
            setLoadingUsers(false);
        }
    };

    const handleQuickImpersonate = async (providerUserId: string) => {
        try {
            if (!user) {
                toast.error("User not authenticated");
                return;
            }
            const accessToken = await getAccessToken();
            if (!accessToken) {
                toast.error("Missing admin access token");
                return;
            }
            toast.info("Starting impersonation session...");
            await impersonateAsSuperadmin({
                accessToken: accessToken,
                providerUserId: providerUserId,
                redirectPath: '/workflow',
                openInNewTab: true,
            });
        } catch (err) {
            toast.error("Failed to impersonate user");
            console.error(err);
        }
    };

    const handleUpdateUserRole = async (targetUserId: number, newRole: string) => {
        try {
            await client.request<PlatformUser>({
                method: "PATCH",
                url: `/api/v1/superuser/users/${targetUserId}/role`,
                body: { role: newRole },
            });
            toast.success("User role updated successfully");
            fetchUsers(page, selectedOrgFilter);
        } catch {
            toast.error("Failed to update user role");
        }
    };

    const handleAssignUser = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!assignUserModalOpen.userId || !assignOrgId) return;
        try {
            await client.request({
                method: "POST",
                url: `/api/v1/superuser/organizations/${assignOrgId}/assign-user`,
                body: { user_id: assignUserModalOpen.userId, role: assignRole }
            });
            toast.success("User assigned to organization");
            setAssignUserModalOpen({userId: null, open: false});
            fetchUsers(page, selectedOrgFilter);
        } catch (error: any) {
            toast.error(error.response?.data?.detail || "Failed to assign user");
        }
    };

    const handleToggleSuperuser = async (targetUserId: number, currentStatus: boolean) => {
        try {
            await client.request<PlatformUser>({
                method: "PATCH",
                url: `/api/v1/superuser/users/${targetUserId}/role`,
                body: { is_superuser: !currentStatus },
            });
            toast.success("Superuser status updated");
            fetchUsers(page, selectedOrgFilter);
        } catch {
            toast.error("Failed to update superuser status");
        }
    };

    return (
        <main className="container mx-auto p-6 space-y-6 max-w-5xl">
            <div className="text-left mb-6">
                <h1 className="text-3xl font-bold mb-2">Users Directory</h1>
                <p className="text-sm text-muted-foreground">Manage users, roles, and impersonation across the platform.</p>
            </div>

            <Card>
                <CardHeader>
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                        <div>
                            <CardTitle>User & Role Management</CardTitle>
                            <CardDescription>
                                View and edit roles or superuser status for all platform users.
                            </CardDescription>
                        </div>
                        <div className="flex items-center">
                            <Select value={selectedOrgFilter} onValueChange={(val) => { setPage(1); setSelectedOrgFilter(val); }}>
                                <SelectTrigger className="w-[200px] sm:w-[250px]">
                                    <SelectValue placeholder="Filter by Organization" />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="all">All Users</SelectItem>
                                    <SelectItem value="0" className="text-muted-foreground font-semibold">Unassigned Users</SelectItem>
                                    {organizations.map(org => (
                                        <SelectItem key={org.id} value={org.id.toString()}>{org.name}</SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </div>
                    </div>
                </CardHeader>
                <CardContent className="space-y-4">
                    {loadingUsers ? (
                        <div className="flex justify-center items-center py-12">
                            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                        </div>
                    ) : (
                        <>
                            <div className="border rounded-md">
                                <Table>
                                    <TableHeader>
                                        <TableRow>
                                            <TableHead>User</TableHead>
                                            <TableHead>Organization</TableHead>
                                            <TableHead>Role</TableHead>
                                            <TableHead>Superuser</TableHead>
                                            <TableHead className="text-right">Actions</TableHead>
                                        </TableRow>
                                    </TableHeader>
                                    <TableBody>
                                        {users.map((u) => (
                                            <TableRow key={u.id}>
                                                <TableCell className="font-medium">
                                                    <div className="flex flex-col">
                                                        <span>{u.email || "No Email"}</span>
                                                        <span className="text-[10px] text-muted-foreground font-mono">
                                                            ID: {u.id}
                                                        </span>
                                                    </div>
                                                </TableCell>
                                                <TableCell>
                                                    {u.org_name ? (
                                                        <span className="inline-flex items-center rounded-full bg-blue-50 px-2 py-1 text-xs font-medium text-blue-700 ring-1 ring-inset ring-blue-700/10">
                                                            {u.org_name}
                                                        </span>
                                                    ) : (
                                                        <span className="inline-flex items-center rounded-full bg-gray-50 px-2 py-1 text-xs font-medium text-gray-600 ring-1 ring-inset ring-gray-500/10">
                                                            Unassigned
                                                        </span>
                                                    )}
                                                </TableCell>
                                                <TableCell>
                                                    <Select
                                                        value={u.role}
                                                        onValueChange={(val) => handleUpdateUserRole(u.id, val)}
                                                    >
                                                        <SelectTrigger className="w-[130px] h-8 text-xs">
                                                            <SelectValue />
                                                        </SelectTrigger>
                                                        <SelectContent>
                                                            <SelectItem value="client">Client</SelectItem>
                                                            <SelectItem value="admin">Admin</SelectItem>
                                                            <SelectItem value="super_admin">Super Admin</SelectItem>
                                                        </SelectContent>
                                                    </Select>
                                                </TableCell>
                                                <TableCell>
                                                    <div className="flex items-center gap-2">
                                                        <Switch
                                                            checked={u.is_superuser}
                                                            onCheckedChange={() => handleToggleSuperuser(u.id, u.is_superuser)}
                                                        />
                                                        {u.is_superuser && (
                                                            <Shield className="h-3.5 w-3.5 text-primary" />
                                                        )}
                                                    </div>
                                                </TableCell>
                                                <TableCell className="text-right">
                                                    <Button
                                                        variant="outline"
                                                        size="sm"
                                                        onClick={() => { setAssignOrgId(""); setAssignRole("client"); setAssignUserModalOpen({userId: u.id, open: true}); }}
                                                        className="h-8 text-xs mr-2"
                                                    >
                                                        Assign
                                                    </Button>
                                                    {u.provider_id && (
                                                        <Button
                                                            variant="outline"
                                                            size="sm"
                                                            onClick={() => handleQuickImpersonate(u.provider_id!)}
                                                            className="h-8 text-xs"
                                                        >
                                                            <UserCheck className="mr-1.5 h-3.5 w-3.5" />
                                                            Impersonate
                                                        </Button>
                                                    )}
                                                </TableCell>
                                            </TableRow>
                                        ))}
                                    </TableBody>
                                </Table>
                            </div>

                            <div className="flex items-center justify-between mt-4">
                                <span className="text-xs text-muted-foreground">
                                    Showing {users.length} of {totalCount} users
                                </span>
                                <div className="flex items-center gap-2">
                                    <Button
                                        variant="outline"
                                        size="sm"
                                        onClick={() => setPage((p) => Math.max(1, p - 1))}
                                        disabled={page === 1}
                                        className="h-8"
                                    >
                                        <ChevronLeft className="h-4 w-4 mr-1" />
                                        Prev
                                    </Button>
                                    <span className="text-xs font-medium">
                                        Page {page} of {totalPages}
                                    </span>
                                    <Button
                                        variant="outline"
                                        size="sm"
                                        onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                                        disabled={page === totalPages}
                                        className="h-8"
                                    >
                                        Next
                                        <ChevronRight className="h-4 w-4 ml-1" />
                                    </Button>
                                </div>
                            </div>
                        </>
                    )}
                </CardContent>
            </Card>

            <Dialog open={assignUserModalOpen.open} onOpenChange={(open) => !open && setAssignUserModalOpen({userId: null, open: false})}>
                <DialogContent>
                    <form onSubmit={handleAssignUser}>
                        <DialogHeader>
                            <DialogTitle>Assign to Organization</DialogTitle>
                            <DialogDescription>
                                Map this user to an organization. This will update their current assignment.
                            </DialogDescription>
                        </DialogHeader>
                        <div className="py-4 space-y-4">
                            <div className="space-y-2">
                                <label className="text-sm font-medium">Organization</label>
                                <Select value={assignOrgId} onValueChange={setAssignOrgId} required>
                                    <SelectTrigger>
                                        <SelectValue placeholder="Select an organization" />
                                    </SelectTrigger>
                                    <SelectContent>
                                        {organizations.filter(o => o.is_active).map(org => (
                                            <SelectItem key={org.id} value={org.id.toString()}>{org.name}</SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
                            </div>
                            <div className="space-y-2">
                                <label className="text-sm font-medium">Role</label>
                                <Select value={assignRole} onValueChange={setAssignRole} required>
                                    <SelectTrigger>
                                        <SelectValue />
                                    </SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value="client">Client</SelectItem>
                                        <SelectItem value="admin">Admin</SelectItem>
                                    </SelectContent>
                                </Select>
                            </div>
                        </div>
                        <DialogFooter>
                            <Button variant="outline" type="button" onClick={() => setAssignUserModalOpen({userId: null, open: false})}>Cancel</Button>
                            <Button type="submit" disabled={!assignOrgId}>Assign User</Button>
                        </DialogFooter>
                    </form>
                </DialogContent>
            </Dialog>
        </main>
    );
}
