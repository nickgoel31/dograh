"use client";

import { ArrowRight, ChevronLeft, ChevronRight, List, Loader2, Shield, UserCheck } from 'lucide-react';
import Link from "next/link";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import { client } from "@/client/client.gen";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
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
}

interface UsersListResponse {
  users: PlatformUser[];
  total_count: number;
  page: number;
  limit: number;
  total_pages: number;
}

export default function SuperadminPage() {
    const [userId, setUserId] = useState("");
    const [error, setError] = useState("");
    const [isLoading, setIsLoading] = useState(false);
    const { user, getAccessToken } = useAuth();

    // User management state
    const [users, setUsers] = useState<PlatformUser[]>([]);
    const [loadingUsers, setLoadingUsers] = useState(true);
    const [page, setPage] = useState(1);
    const [totalPages, setTotalPages] = useState(1);
    const [totalCount, setTotalCount] = useState(0);

    useEffect(() => {
        if (user) {
            fetchUsers(page);
        }
    }, [user, page]);

    const fetchUsers = async (targetPage: number) => {
        setLoadingUsers(true);
        try {
            const res = await client.request<UsersListResponse>({
                method: "GET",
                url: `/api/v1/superuser/users?page=${targetPage}&limit=10`,
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

    const handleImpersonate = async (e: React.FormEvent) => {
        e.preventDefault();
        setError("");
        setIsLoading(true);

        try {
            if (!user) {
                setError("User not authenticated. Please log in and try again.");
                setIsLoading(false);
                return;
            }
            const accessToken = await getAccessToken();
            if (!accessToken) {
                throw new Error('Missing admin access token');
            }

            await impersonateAsSuperadmin({
                accessToken: accessToken,
                providerUserId: userId,
                redirectPath: '/workflow',
                openInNewTab: true,
            });
        } catch (err) {
            setError("Failed to impersonate user. Please try again.");
            console.error("Impersonation error:", err);
        } finally {
            setIsLoading(false);
        }
    };

    const handleQuickImpersonate = async (providerUserId: string) => {
        setError("");
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
            fetchUsers(page);
        } catch {
            toast.error("Failed to update user role");
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
            fetchUsers(page);
        } catch {
            toast.error("Failed to update superuser status");
        }
    };

    return (
        <>
            <main className="container mx-auto p-6 space-y-6 max-w-5xl">
                <div className="text-center">
                    <h1 className="text-3xl font-bold mb-2">Superadmin Dashboard</h1>
                    <p className="text-sm text-muted-foreground">Manage users and view system-wide data</p>
                </div>

                <div className="grid gap-6 md:grid-cols-2">
                        {/* User Impersonation Card */}
                        <Card>
                            <CardHeader>
                                <CardTitle>User Impersonation</CardTitle>
                                <CardDescription>
                                    Impersonate a user account for debugging or support purposes
                                </CardDescription>
                            </CardHeader>
                            <CardContent>
                                <form onSubmit={handleImpersonate} className="space-y-4">
                                    <div className="space-y-2">
                                        <Label htmlFor="userId">Provider User ID</Label>
                                        <Input
                                            id="userId"
                                            value={userId}
                                            onChange={(e) => setUserId(e.target.value)}
                                            placeholder="Enter provider user ID"
                                            required
                                        />
                                    </div>

                                    {error && (
                                        <div className="bg-red-50 border border-red-200 text-red-600 px-4 py-3 rounded-lg text-sm">
                                            {error}
                                        </div>
                                    )}

                                    <Button
                                        type="submit"
                                        disabled={isLoading}
                                        className="w-full"
                                    >
                                        {isLoading ? (
                                            <>
                                                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                                                Processing...
                                            </>
                                        ) : (
                                            'Impersonate User'
                                        )}
                                    </Button>
                                </form>
                            </CardContent>
                        </Card>

                        {/* Workflow Runs Card */}
                        <Card>
                            <CardHeader>
                                <CardTitle>Workflow Runs</CardTitle>
                                <CardDescription>
                                    View and manage all workflow runs across organizations
                                </CardDescription>
                            </CardHeader>
                            <CardContent>
                                <div className="space-y-4">
                                    <p className="text-sm text-muted-foreground">
                                        Access detailed information about all workflow runs, including status,
                                        recordings, transcripts, and usage data.
                                    </p>
                                    <Link href="/superadmin/runs">
                                        <Button className="w-full">
                                            <List className="mr-2 h-4 w-4" />
                                            View All Runs
                                            <ArrowRight className="ml-2 h-4 w-4" />
                                        </Button>
                                    </Link>
                                </div>
                            </CardContent>
                        </Card>
                </div>

                {/* User & Role Management Table */}
                <Card>
                    <CardHeader>
                        <CardTitle>User & Role Management</CardTitle>
                        <CardDescription>
                            View and edit roles or superuser status for all platform users.
                        </CardDescription>
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
                                                <TableHead>Email</TableHead>
                                                <TableHead>Role</TableHead>
                                                <TableHead>Superuser</TableHead>
                                                <TableHead>Created At</TableHead>
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
                                                    <TableCell className="text-xs text-muted-foreground">
                                                        {new Date(u.created_at).toLocaleDateString()}
                                                    </TableCell>
                                                    <TableCell className="text-right">
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
            </main>
        </>
    );
}
