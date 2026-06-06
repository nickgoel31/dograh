"use client";

import React, { useState, useEffect, useCallback } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { toast } from "sonner";
import {
  ChevronLeft,
  ChevronRight,
  RotateCw,
  Eye,
  Search,
  MessageSquare,
  AlertCircle,
  ExternalLink,
  Settings,
  RefreshCw,
  CheckCircle2,
  Clock,
  Send,
  HelpCircle
} from "lucide-react";

import { useUserConfig } from "@/context/UserConfigContext";
import { useCurrentUserRole } from "@/hooks/useCurrentUserRole";
import {
  listWhatsappLogsApiV1WhatsappLogsGet,
  retryWhatsappMessageApiV1WhatsappLogsMessageIdRetryPost
} from "@/client/sdk.gen";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";

// Interface for WhatsApp log entries
interface WhatsAppLog {
  id: number;
  direction: string;
  message_type: string;
  whatsapp_message_id: string | null;
  recipient_phone: string;
  template_name: string | null;
  template_language: string | null;
  message_body: string | null;
  status: string;
  error_message: string | null;
  created_at: string;
  updated_at: string;
  workflow_run_id: number | null;
  workflow_id: number | null;
}

export default function WhatsAppLogsPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { userConfig, loading: userConfigLoading } = useUserConfig();
  const { isSuperadmin } = useCurrentUserRole();

  // Page state
  const [logs, setLogs] = useState<WhatsAppLog[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [retryingId, setRetryingId] = useState<number | null>(null);

  // Filters from URL
  const [currentPage, setCurrentPage] = useState(() => {
    const p = searchParams.get("page");
    return p ? parseInt(p, 10) : 1;
  });
  const [statusFilter, setStatusFilter] = useState(() => {
    return searchParams.get("status") || "all";
  });
  const [searchPhone, setSearchPhone] = useState(() => {
    return searchParams.get("phone") || "";
  });

  // Local input search buffer (to avoid fetching on every key stroke)
  const [searchBuffer, setSearchBuffer] = useState(searchPhone);

  // Detail modal state
  const [selectedLog, setSelectedLog] = useState<WhatsAppLog | null>(null);
  const [isDetailOpen, setIsDetailOpen] = useState(false);

  // Fetch logs function
  const fetchLogs = useCallback(async (page: number, status: string, phone: string) => {
    setLoading(true);
    try {
      const response = await listWhatsappLogsApiV1WhatsappLogsGet({
        query: {
          page,
          limit: 15,
          status: status === "all" ? undefined : status,
          recipient_phone: phone ? phone.trim() : undefined,
        },
      });

      if (response.data) {
        const data = response.data as { total: number; logs: WhatsAppLog[] };
        setLogs(data.logs || []);
        setTotal(data.total || 0);
      }
    } catch (err: any) {
      console.error("Failed to fetch WhatsApp logs:", err);
      toast.error(err?.detail || "Could not retrieve WhatsApp logs");
    } finally {
      setLoading(false);
    }
  }, []);

  // Update query params and fetch
  const handleFilterChange = (updates: { page?: number; status?: string; phone?: string }) => {
    const nextParams = new URLSearchParams(searchParams.toString());
    
    let nextPage = updates.page !== undefined ? updates.page : 1;
    let nextStatus = updates.status !== undefined ? updates.status : statusFilter;
    let nextPhone = updates.phone !== undefined ? updates.phone : searchPhone;

    if (updates.page !== undefined) {
      nextParams.set("page", nextPage.toString());
      setCurrentPage(nextPage);
    } else {
      nextParams.set("page", "1");
      setCurrentPage(1);
      nextPage = 1;
    }

    if (updates.status !== undefined) {
      if (nextStatus === "all") {
        nextParams.delete("status");
      } else {
        nextParams.set("status", nextStatus);
      }
      setStatusFilter(nextStatus);
    }

    if (updates.phone !== undefined) {
      if (!nextPhone) {
        nextParams.delete("phone");
      } else {
        nextParams.set("phone", nextPhone);
      }
      setSearchPhone(nextPhone);
    }

    router.push(`/whatsapp?${nextParams.toString()}`);
    fetchLogs(nextPage, nextStatus, nextPhone);
  };

  // Perform search on buffer submission
  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    handleFilterChange({ phone: searchBuffer });
  };

  // Clear all filters
  const handleClearFilters = () => {
    setSearchBuffer("");
    setStatusFilter("all");
    setCurrentPage(1);
    router.push("/whatsapp");
    fetchLogs(1, "all", "");
  };

  // Fetch initial logs when config is ready and enabled
  useEffect(() => {
    if (!userConfigLoading && userConfig?.whatsapp_enabled) {
      fetchLogs(currentPage, statusFilter, searchPhone);
    }
  }, [userConfigLoading, userConfig?.whatsapp_enabled, fetchLogs, currentPage, statusFilter, searchPhone]);

  // Handle message retry
  const handleRetry = async (logId: number) => {
    setRetryingId(logId);
    try {
      const response = await retryWhatsappMessageApiV1WhatsappLogsMessageIdRetryPost({
        path: { message_id: logId },
      });
      if (response.data) {
        toast.success("WhatsApp message resent successfully");
        fetchLogs(currentPage, statusFilter, searchPhone);
        if (selectedLog && selectedLog.id === logId) {
          setIsDetailOpen(false);
          setSelectedLog(null);
        }
      }
    } catch (err: any) {
      console.error("Failed to retry WhatsApp message:", err);
      toast.error(err?.detail || "Failed to retry message");
    } finally {
      setRetryingId(null);
    }
  };

  // Calculate statistics from the currently fetched list (approximation for dashboard feel)
  const stats = {
    total: total,
    sent: logs.filter(l => ["sent", "delivered", "read"].includes(l.status)).length,
    delivered: logs.filter(l => ["delivered", "read"].includes(l.status)).length,
    failed: logs.filter(l => l.status === "failed").length,
  };

  // Format date helper
  const formatDate = (dateStr: string) => {
    try {
      const date = new Date(dateStr);
      return date.toLocaleString("en-US", {
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "numeric",
        hour12: true,
      });
    } catch {
      return dateStr;
    }
  };

  // Status badge selector
  const getStatusBadge = (status: string) => {
    switch (status.toLowerCase()) {
      case "delivered":
      case "read":
        return (
          <Badge className="bg-emerald-500/10 text-emerald-500 hover:bg-emerald-500/20 border-emerald-500/20 flex items-center gap-1 w-fit">
            <CheckCircle2 className="h-3.5 w-3.5" />
            <span>Delivered</span>
          </Badge>
        );
      case "sent":
        return (
          <Badge className="bg-indigo-500/10 text-indigo-500 hover:bg-indigo-500/20 border-indigo-500/20 flex items-center gap-1 w-fit">
            <Send className="h-3.5 w-3.5" />
            <span>Sent</span>
          </Badge>
        );
      case "pending":
        return (
          <Badge className="bg-amber-500/10 text-amber-500 hover:bg-amber-500/20 border-amber-500/20 flex items-center gap-1 w-fit">
            <Clock className="h-3.5 w-3.5 animate-pulse" />
            <span>Pending</span>
          </Badge>
        );
      case "failed":
      default:
        return (
          <Badge className="bg-rose-500/10 text-rose-500 hover:bg-rose-500/20 border-rose-500/20 flex items-center gap-1 w-fit">
            <AlertCircle className="h-3.5 w-3.5" />
            <span>Failed</span>
          </Badge>
        );
    }
  };

  const totalPages = Math.ceil(total / 15);

  // 1. Loading state for organization configuration
  if (userConfigLoading) {
    return (
      <div className="container mx-auto p-6 space-y-6">
        <div className="flex justify-between items-start">
          <div className="space-y-2 w-1/3">
            <div className="h-8 bg-muted animate-pulse rounded-md"></div>
            <div className="h-4 bg-muted animate-pulse rounded w-3/4"></div>
          </div>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
          {[...Array(4)].map((_, i) => (
            <Card key={i} className="animate-pulse">
              <CardHeader className="h-24"></CardHeader>
            </Card>
          ))}
        </div>
        <Card className="animate-pulse">
          <CardHeader className="h-16 border-b"></CardHeader>
          <CardContent className="h-96"></CardContent>
        </Card>
      </div>
    );
  }

  // 2. Disabled view if WhatsApp follow-up is not active for this organization
  if (!userConfig?.whatsapp_enabled) {
    return (
      <div className="container mx-auto p-6 flex items-center justify-center min-h-[80vh]">
        <Card className="max-w-md w-full border border-border/80 bg-background/50 shadow-2xl relative overflow-hidden backdrop-blur-md">
          {/* Subtle gradient glowing effect */}
          <div className="absolute top-[-20%] left-[-20%] w-[300px] h-[300px] rounded-full bg-primary/10 blur-[80px] pointer-events-none" />
          <CardHeader className="text-center pt-8">
            <div className="mx-auto w-12 h-12 rounded-full bg-muted flex items-center justify-center mb-4 border border-border">
              <MessageSquare className="h-6 w-6 text-muted-foreground" />
            </div>
            <CardTitle className="text-2xl font-bold tracking-tight">WhatsApp Follow-Up</CardTitle>
            <CardDescription className="text-sm text-muted-foreground mt-2">
              Automated follow-up messages linked to call triggers.
            </CardDescription>
          </CardHeader>
          <CardContent className="text-center pb-8 px-6 space-y-6">
            <p className="text-sm text-muted-foreground leading-relaxed">
              This feature is currently disabled for your organization.
              Follow-ups let you automatically send WhatsApp template messages (like summaries, bookings, and receipts) right after a voice call completes.
            </p>
            {isSuperadmin ? (
              <div className="space-y-4 pt-2">
                <div className="p-3 rounded-lg bg-amber-500/10 border border-amber-500/25 text-amber-600 dark:text-amber-400 text-xs text-left flex gap-2">
                  <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
                  <span>You are a SuperAdmin. You can enable this feature for this organization in the SuperAdmin dashboard.</span>
                </div>
                <Button 
                  onClick={() => router.push("/superadmin")} 
                  className="w-full flex items-center justify-center gap-2"
                >
                  <Settings className="h-4 w-4" />
                  Open SuperAdmin Console
                </Button>
              </div>
            ) : (
              <div className="p-4 rounded-lg bg-muted/50 border border-border/60 text-xs text-muted-foreground">
                Please ask your system administrator or SuperAdmin to enable WhatsApp Follow-Up credentials for your organization.
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    );
  }

  // 3. Enabled view - Logs Dashboard
  return (
    <div className="container mx-auto p-6 space-y-6 relative">
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <div>
          <h1 className="text-3xl font-extrabold tracking-tight bg-gradient-to-r from-foreground via-foreground/95 to-muted-foreground bg-clip-text">
            WhatsApp Follow-Up Logs
          </h1>
          <p className="text-muted-foreground mt-1 text-sm">
            Monitor and retry automated templates triggered post-call.
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => fetchLogs(currentPage, statusFilter, searchPhone)}
          disabled={loading}
          className="flex items-center gap-2 border-border/60 hover:bg-muted/50"
        >
          <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
          Refresh Logs
        </Button>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <Card className="bg-background/40 border-border/50 shadow-sm">
          <CardHeader className="py-4 flex flex-row items-center justify-between pb-2 space-y-0">
            <CardTitle className="text-sm font-medium text-muted-foreground">Total Processed</CardTitle>
            <MessageSquare className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent className="py-2">
            <div className="text-2xl font-bold">{stats.total}</div>
            <p className="text-xs text-muted-foreground mt-1">Dispatched message history</p>
          </CardContent>
        </Card>

        <Card className="bg-background/40 border-border/50 shadow-sm">
          <CardHeader className="py-4 flex flex-row items-center justify-between pb-2 space-y-0">
            <CardTitle className="text-sm font-medium text-muted-foreground">Success Rate</CardTitle>
            <CheckCircle2 className="h-4 w-4 text-emerald-500" />
          </CardHeader>
          <CardContent className="py-2">
            <div className="text-2xl font-bold">
              {stats.total > 0 ? `${Math.round(((stats.total - stats.failed) / stats.total) * 100)}%` : "0%"}
            </div>
            <p className="text-xs text-muted-foreground mt-1">Deliveries vs. failures</p>
          </CardContent>
        </Card>

        <Card className="bg-background/40 border-border/50 shadow-sm">
          <CardHeader className="py-4 flex flex-row items-center justify-between pb-2 space-y-0">
            <CardTitle className="text-sm font-medium text-muted-foreground">Active Failures</CardTitle>
            <AlertCircle className="h-4 w-4 text-rose-500" />
          </CardHeader>
          <CardContent className="py-2">
            <div className="text-2xl font-bold text-rose-500">{stats.failed}</div>
            <p className="text-xs text-muted-foreground mt-1">Requires admin attention</p>
          </CardContent>
        </Card>

        <Card className="bg-background/40 border-border/50 shadow-sm">
          <CardHeader className="py-4 flex flex-row items-center justify-between pb-2 space-y-0">
            <CardTitle className="text-sm font-medium text-muted-foreground">Meta Integrations</CardTitle>
            <Settings className="h-4 w-4 text-primary" />
          </CardHeader>
          <CardContent className="py-2">
            <div className="text-sm font-semibold truncate text-emerald-500 flex items-center gap-1.5 mt-0.5">
              <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse inline-block" />
              Active / Enabled
            </div>
            <p className="text-xs text-muted-foreground mt-1.5">Meta API Config Status</p>
          </CardContent>
        </Card>
      </div>

      {/* Filter and Search Bar */}
      <div className="flex flex-col lg:flex-row justify-between items-stretch lg:items-center gap-4 bg-background/50 border border-border/60 p-4 rounded-xl shadow-sm">
        {/* Search */}
        <form onSubmit={handleSearchSubmit} className="flex items-center gap-2 w-full lg:max-w-md">
          <div className="relative w-full">
            <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              type="text"
              placeholder="Search by phone number..."
              value={searchBuffer}
              onChange={(e) => setSearchBuffer(e.target.value)}
              className="pl-9 bg-background/80 border-border/60"
            />
          </div>
          <Button type="submit" variant="secondary" size="sm">Search</Button>
        </form>

        {/* Status Pills */}
        <div className="flex flex-wrap items-center gap-2">
          {["all", "pending", "sent", "delivered", "failed"].map((status) => (
            <button
              key={status}
              onClick={() => handleFilterChange({ status })}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold border transition-all ${
                statusFilter === status
                  ? "bg-primary text-primary-foreground border-primary shadow-sm"
                  : "bg-background/80 text-muted-foreground border-border/60 hover:bg-muted/40 hover:text-foreground"
              }`}
            >
              {status.charAt(0).toUpperCase() + status.slice(1)}
            </button>
          ))}

          {(statusFilter !== "all" || searchPhone) && (
            <Button
              variant="ghost"
              size="sm"
              onClick={handleClearFilters}
              className="text-muted-foreground hover:text-foreground text-xs font-medium h-8 px-2 ml-1"
            >
              Clear Filters
            </Button>
          )}
        </div>
      </div>

      {/* Table Card */}
      <Card className="border-border/50 bg-background/40">
        <CardContent className="p-0">
          {loading ? (
            <div className="py-20 space-y-4 flex flex-col items-center justify-center text-muted-foreground">
              <RefreshCw className="h-8 w-8 animate-spin text-primary" />
              <span className="text-sm font-medium">Loading logs...</span>
            </div>
          ) : logs.length > 0 ? (
            <>
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow className="hover:bg-transparent border-border/60 bg-muted/20">
                      <TableHead className="font-semibold text-xs py-3.5">Date</TableHead>
                      <TableHead className="font-semibold text-xs py-3.5">Recipient</TableHead>
                      <TableHead className="font-semibold text-xs py-3.5">Template Name</TableHead>
                      <TableHead className="font-semibold text-xs py-3.5">Workflow Run</TableHead>
                      <TableHead className="font-semibold text-xs py-3.5">Status</TableHead>
                      <TableHead className="font-semibold text-xs py-3.5 text-right pr-6">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {logs.map((log) => (
                      <TableRow
                        key={log.id}
                        className="hover:bg-muted/20 border-border/40 transition-colors"
                      >
                        <TableCell className="text-xs text-muted-foreground whitespace-nowrap font-medium">
                          {formatDate(log.created_at)}
                        </TableCell>
                        <TableCell className="text-xs font-semibold font-mono">
                          {log.recipient_phone}
                        </TableCell>
                        <TableCell className="text-xs">
                          {log.template_name ? (
                            <span className="font-medium">
                              {log.template_name}
                              {log.template_language && (
                                <span className="text-muted-foreground text-[10px] ml-1 bg-muted px-1.5 py-0.5 rounded">
                                  {log.template_language}
                                </span>
                              )}
                            </span>
                          ) : (
                            <span className="text-muted-foreground">-</span>
                          )}
                        </TableCell>
                        <TableCell className="text-xs">
                          {log.workflow_run_id ? (
                            log.workflow_id ? (
                              <button
                                onClick={() => router.push(`/workflow/${log.workflow_id}/run/${log.workflow_run_id}`)}
                                className="inline-flex items-center gap-1 text-primary hover:underline font-mono text-xs"
                              >
                                #{log.workflow_run_id}
                                <ExternalLink className="h-3 w-3" />
                              </button>
                            ) : (
                              <span className="font-mono text-xs text-muted-foreground">#{log.workflow_run_id}</span>
                            )
                          ) : (
                            <span className="text-muted-foreground">-</span>
                          )}
                        </TableCell>
                        <TableCell>{getStatusBadge(log.status)}</TableCell>
                        <TableCell className="text-right pr-6">
                          <div className="flex justify-end gap-2">
                            <Button
                              variant="outline"
                              size="icon"
                              className="h-8 w-8 text-muted-foreground border-border/65 hover:text-foreground"
                              title="View message details"
                              onClick={() => {
                                setSelectedLog(log);
                                setIsDetailOpen(true);
                              }}
                            >
                              <Eye className="h-4 w-4" />
                            </Button>

                            {log.status === "failed" && log.direction === "outbound" && (
                              <Button
                                variant="outline"
                                size="icon"
                                className="h-8 w-8 text-rose-600 border-rose-500/20 hover:bg-rose-500/10 hover:text-rose-700"
                                title="Retry message send"
                                onClick={() => handleRetry(log.id)}
                                disabled={retryingId === log.id}
                              >
                                <RotateCw className={`h-4 w-4 ${retryingId === log.id ? "animate-spin" : ""}`} />
                              </Button>
                            )}
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>

              {/* Pagination controls */}
              {totalPages > 1 && (
                <div className="flex items-center justify-between border-t border-border/50 px-6 py-4">
                  <p className="text-xs text-muted-foreground">
                    Showing Page <span className="font-semibold text-foreground">{currentPage}</span> of{" "}
                    <span className="font-semibold text-foreground">{totalPages}</span> ({total} total logs)
                  </p>
                  <div className="flex gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => handleFilterChange({ page: currentPage - 1 })}
                      disabled={currentPage === 1}
                      className="h-8 text-xs flex items-center gap-1.5"
                    >
                      <ChevronLeft className="h-3.5 w-3.5" />
                      Previous
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => handleFilterChange({ page: currentPage + 1 })}
                      disabled={currentPage === totalPages}
                      className="h-8 text-xs flex items-center gap-1.5"
                    >
                      Next
                      <ChevronRight className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </div>
              )}
            </>
          ) : (
            <div className="py-20 text-center space-y-3">
              <MessageSquare className="mx-auto h-12 w-12 text-muted-foreground/40" />
              <p className="text-sm font-semibold">No logs found</p>
              <p className="text-xs text-muted-foreground max-w-xs mx-auto">
                No logs matching your search criteria. Try modifying your filter pills or search terms.
              </p>
              {(statusFilter !== "all" || searchPhone) && (
                <Button variant="outline" size="sm" onClick={handleClearFilters} className="mt-2">
                  Clear Filters
                </Button>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Details Dialog */}
      <Dialog open={isDetailOpen} onOpenChange={setIsDetailOpen}>
        <DialogContent className="max-w-xl bg-background border border-border shadow-2xl">
          <DialogHeader className="space-y-1">
            <DialogTitle className="text-lg font-bold flex items-center gap-2">
              <MessageSquare className="h-5 w-5 text-primary" />
              <span>WhatsApp Message Log Details</span>
            </DialogTitle>
            <DialogDescription className="text-xs">
              Full log metadata and message context for Log ID #{selectedLog?.id}
            </DialogDescription>
          </DialogHeader>

          {selectedLog && (
            <div className="space-y-4 pt-2 text-sm">
              <div className="grid grid-cols-2 gap-4 bg-muted/40 p-3.5 rounded-xl border border-border/50 font-mono text-xs">
                <div>
                  <span className="text-muted-foreground block text-[10px] font-semibold uppercase tracking-wider">Log ID</span>
                  <span className="font-semibold text-foreground">#{selectedLog.id}</span>
                </div>
                <div>
                  <span className="text-muted-foreground block text-[10px] font-semibold uppercase tracking-wider">Status</span>
                  <div className="mt-0.5">{getStatusBadge(selectedLog.status)}</div>
                </div>
                <div>
                  <span className="text-muted-foreground block text-[10px] font-semibold uppercase tracking-wider">Meta Message ID</span>
                  <span className="font-semibold text-foreground break-all">{selectedLog.whatsapp_message_id || "-"}</span>
                </div>
                <div>
                  <span className="text-muted-foreground block text-[10px] font-semibold uppercase tracking-wider">Recipient Phone</span>
                  <span className="font-semibold text-foreground">{selectedLog.recipient_phone}</span>
                </div>
                <div>
                  <span className="text-muted-foreground block text-[10px] font-semibold uppercase tracking-wider">Created At</span>
                  <span className="text-foreground">{new Date(selectedLog.created_at).toLocaleString()}</span>
                </div>
                <div>
                  <span className="text-muted-foreground block text-[10px] font-semibold uppercase tracking-wider">Last Updated</span>
                  <span className="text-foreground">{new Date(selectedLog.updated_at).toLocaleString()}</span>
                </div>
              </div>

              {/* Message Payload / Body */}
              <div className="space-y-1.5">
                <h4 className="font-semibold text-xs text-muted-foreground uppercase tracking-wider">Message Content / Body</h4>
                <div className="bg-background border border-border/80 p-3.5 rounded-lg text-xs leading-relaxed max-h-40 overflow-y-auto whitespace-pre-wrap font-sans">
                  {selectedLog.message_body || "No message body text recorded."}
                </div>
              </div>

              {/* Error Message */}
              {selectedLog.status === "failed" && selectedLog.error_message && (
                <div className="space-y-1.5">
                  <h4 className="font-semibold text-xs text-rose-500 uppercase tracking-wider flex items-center gap-1">
                    <AlertCircle className="h-3.5 w-3.5" />
                    <span>Error Details</span>
                  </h4>
                  <div className="bg-rose-500/5 border border-rose-500/20 p-3 rounded-lg text-xs font-mono text-rose-600 dark:text-rose-400 whitespace-pre-wrap max-h-32 overflow-y-auto">
                    {selectedLog.error_message}
                  </div>
                </div>
              )}

              {/* Actions Footer */}
              <div className="flex justify-end gap-2.5 pt-3 border-t border-border/60">
                <Button variant="ghost" size="sm" onClick={() => setIsDetailOpen(false)}>
                  Close
                </Button>
                {selectedLog.status === "failed" && selectedLog.direction === "outbound" && (
                  <Button
                    size="sm"
                    className="flex items-center gap-1.5 bg-rose-600 hover:bg-rose-700 text-white"
                    onClick={() => handleRetry(selectedLog.id)}
                    disabled={retryingId === selectedLog.id}
                  >
                    <RotateCw className={`h-4 w-4 ${retryingId === selectedLog.id ? "animate-spin" : ""}`} />
                    Retry Message Send
                  </Button>
                )}
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
