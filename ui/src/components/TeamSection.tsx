"use client";

import { Check, Copy, Shield, Trash2, User,UserPlus } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import { client } from "@/client/client.gen";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

interface Member {
  id: number;
  email: string | null;
  role: string;
  is_superuser: boolean;
}

export function TeamSection() {
  const [members, setMembers] = useState<Member[]>([]);
  const [loading, setLoading] = useState(true);
  const [inviting, setInviting] = useState(false);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState("client");
  const [generatedLink, setGeneratedLink] = useState("");
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    fetchMembers();
  }, []);

  async function fetchMembers() {
    try {
      const res = await client.request<unknown>({
        method: "GET",
        url: "/api/v1/organizations/members",
      });
      if (res.data) {
        setMembers(res.data as Member[]);
      }
    } catch {
      toast.error("Failed to fetch organization members");
    } finally {
      setLoading(false);
    }
  }

  async function handleCreateInvite(e: React.FormEvent) {
    e.preventDefault();
    if (!inviteEmail) return;
    setInviting(true);
    try {
      const res = await client.request<unknown>({
        method: "POST",
        url: "/api/v1/organizations/invites",
        body: {
          email: inviteEmail,
          role: inviteRole,
        },
      });
      if (res.data) {
        setGeneratedLink((res.data as { invite_url: string }).invite_url);
        toast.success("Invitation link generated successfully!");
        setInviteEmail("");
      }
    } catch {
      toast.error("Failed to generate invitation link");
    } finally {
      setInviting(false);
    }
  }

  async function handleUpdateRole(memberId: number, newRole: string) {
    try {
      await client.request<unknown>({
        method: "PATCH",
        url: `/api/v1/organizations/members/${memberId}/role`,
        body: { role: newRole },
      });
      toast.success("Member role updated");
      fetchMembers();
    } catch {
      toast.error("Failed to update member role");
    }
  }

  async function handleRemoveMember(memberId: number) {
    if (!confirm("Are you sure you want to remove this member from the organization?")) {
      return;
    }
    try {
      await client.request({
        method: "DELETE",
        url: `/api/v1/organizations/members/${memberId}`,
      });
      toast.success("Member removed from organization");
      fetchMembers();
    } catch {
      toast.error("Failed to remove member");
    }
  }

  const copyToClipboard = () => {
    navigator.clipboard.writeText(generatedLink);
    setCopied(true);
    toast.success("Copied to clipboard!");
    setTimeout(() => setCopied(false), 2000);
  };

  if (loading) {
    return <p className="text-sm text-muted-foreground">Loading team members...</p>;
  }

  return (
    <div className="space-y-8">
      {/* Invite Member Section */}
      <div className="p-5 border rounded-lg bg-muted/10 space-y-4">
        <h3 className="text-sm font-semibold flex items-center gap-2">
          <UserPlus className="h-4 w-4" /> Invite Team Member
        </h3>
        <p className="text-xs text-muted-foreground">
          Invite a user to join your organization. They will receive a link to register and join automatically.
        </p>

        <form onSubmit={handleCreateInvite} className="flex flex-col sm:flex-row gap-3">
          <div className="flex-1 space-y-1">
            <Label htmlFor="invite-email" className="sr-only">Email Address</Label>
            <Input
              id="invite-email"
              type="email"
              placeholder="member@company.com"
              value={inviteEmail}
              onChange={(e) => setInviteEmail(e.target.value)}
              required
              className="w-full"
            />
          </div>
          <div className="w-full sm:w-[150px]">
            <Select value={inviteRole} onValueChange={setInviteRole}>
              <SelectTrigger>
                <SelectValue placeholder="Role" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="client">Client</SelectItem>
                <SelectItem value="admin">Admin</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <Button type="submit" disabled={inviting || !inviteEmail}>
            {inviting ? "Generating..." : "Generate Invite Link"}
          </Button>
        </form>

        {generatedLink && (
          <div className="mt-4 p-3 rounded-md bg-secondary/50 border flex items-center justify-between gap-3">
            <span className="text-xs font-mono break-all overflow-hidden select-all text-secondary-foreground max-w-[80%]">
              {generatedLink}
            </span>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={copyToClipboard}
              className="flex items-center gap-1.5 shrink-0"
            >
              {copied ? <Check className="h-3.5 w-3.5 text-green-500" /> : <Copy className="h-3.5 w-3.5" />}
              {copied ? "Copied" : "Copy Link"}
            </Button>
          </div>
        )}
      </div>

      {/* Members List Section */}
      <div className="space-y-4">
        <h3 className="text-sm font-semibold flex items-center gap-2">
          <User className="h-4 w-4" /> Active Members
        </h3>
        <div className="border rounded-md">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Email</TableHead>
                <TableHead>Role</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {members.map((member) => (
                <TableRow key={member.id}>
                  <TableCell className="font-medium">
                    <div className="flex flex-col">
                      <span>{member.email || "No Email"}</span>
                      {member.is_superuser && (
                        <span className="text-[10px] text-primary font-semibold uppercase">Platform Superuser</span>
                      )}
                    </div>
                  </TableCell>
                  <TableCell>
                    {member.is_superuser ? (
                      <Badge variant="secondary" className="flex items-center gap-1 w-fit">
                        <Shield className="h-3 w-3" />
                        super_admin
                      </Badge>
                    ) : (
                      <Select
                        value={member.role}
                        onValueChange={(val) => handleUpdateRole(member.id, val)}
                      >
                        <SelectTrigger className="w-[120px] h-8 text-xs">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="client">Client</SelectItem>
                          <SelectItem value="admin">Admin</SelectItem>
                        </SelectContent>
                      </Select>
                    )}
                  </TableCell>
                  <TableCell className="text-right">
                    {!member.is_superuser && (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => handleRemoveMember(member.id)}
                        className="h-8 w-8 p-0 text-destructive hover:text-destructive hover:bg-destructive/10"
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
              ))}
              {members.length === 0 && (
                <TableRow>
                  <TableCell colSpan={3} className="text-center py-6 text-muted-foreground">
                    No active members found.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </div>
      </div>
    </div>
  );
}
