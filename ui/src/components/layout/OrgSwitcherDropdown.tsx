"use client";

import React, { useEffect, useState, useRef } from "react";
import { Building2, Check, Loader2, RefreshCw, Search, ShieldAlert, Sparkles, X } from "lucide-react";
import { toast } from "sonner";

import { client } from "@/client/client.gen";

interface Organization {
  id: number;
  name: string;
  slug?: string;
  is_active?: boolean;
  total_members?: number;
}

interface OrgSwitcherDropdownProps {
  isOpen: boolean;
  onClose: () => void;
  currentOrgName: string | null;
  currentOrgId: number | null;
  isSuperadmin: boolean;
}

export const OrgSwitcherDropdown: React.FC<OrgSwitcherDropdownProps> = ({
  isOpen,
  onClose,
  currentOrgName,
  currentOrgId,
  isSuperadmin,
}) => {
  const [organizations, setOrganizations] = useState<Organization[]>([]);
  const [loading, setLoading] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [isSwitching, setIsSwitching] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  const isImpersonating =
    typeof window !== "undefined" &&
    !!sessionStorage.getItem("impersonation_token");

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        onClose();
      }
    };
    if (isOpen) {
      document.addEventListener("mousedown", handleClickOutside);
    }
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [isOpen, onClose]);

  useEffect(() => {
    if (isOpen && isSuperadmin) {
      fetchOrganizations();
    }
  }, [isOpen, isSuperadmin]);

  const fetchOrganizations = async () => {
    setLoading(true);
    try {
      const res = await client.request<Organization[]>({
        method: "GET",
        url: "/api/v1/superuser/organizations",
      });
      if (res.data) {
        setOrganizations(res.data);
      }
    } catch {
      toast.error("Failed to load organizations");
    } finally {
      setLoading(false);
    }
  };

  const handleSwitchOrg = async (org: Organization) => {
    if (isSwitching) return;
    setIsSwitching(true);
    try {
      const res = (await client.request({
        method: "POST",
        url: "/api/v1/superuser/switch-org",
        body: { org_id: org.id },
      })) as any;

      if (res.data?.access_token) {
        sessionStorage.setItem("impersonation_token", res.data.access_token);
        toast.success(`Switched workspace to ${res.data.org_name || org.name}`);
        onClose();
        window.location.reload();
      }
    } catch (error: any) {
      toast.error(
        error?.response?.data?.detail || "Failed to switch organization"
      );
    } finally {
      setIsSwitching(false);
    }
  };

  const handleResetImpersonation = () => {
    if (typeof window !== "undefined") {
      sessionStorage.removeItem("impersonation_token");
      toast.success("Reset to primary organization context");
      onClose();
      window.location.reload();
    }
  };

  if (!isOpen) return null;

  const filteredOrgs = organizations.filter(
    (org) =>
      org.name?.toLowerCase().includes(searchQuery.toLowerCase()) ||
      org.slug?.toLowerCase().includes(searchQuery.toLowerCase()) ||
      String(org.id).includes(searchQuery)
  );

  return (
    <div
      ref={dropdownRef}
      className="absolute top-14 left-2 w-[280px] bg-white dark:bg-[#1a1c18] border border-gray-200 dark:border-[#2e312b] rounded-2xl shadow-2xl z-50 overflow-hidden flex flex-col animate-in fade-in zoom-in-95 duration-150"
    >
      {/* Header */}
      <div className="p-3 border-b border-gray-100 dark:border-[#252822] flex items-center justify-between bg-gray-50/50 dark:bg-[#141513]">
        <div className="flex items-center gap-2">
          <Building2 className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
          <span className="text-xs font-semibold text-gray-900 dark:text-white uppercase tracking-wider">
            Switch Organization
          </span>
        </div>
        <button
          onClick={onClose}
          className="p-1 text-gray-400 hover:text-gray-600 dark:hover:text-white rounded-lg transition-colors"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* Impersonation Banner */}
      {isImpersonating && (
        <div className="px-3 py-2 bg-amber-500/10 border-b border-amber-500/20 flex items-center justify-between">
          <div className="flex items-center gap-1.5 min-w-0">
            <ShieldAlert className="w-3.5 h-3.5 text-amber-500 flex-shrink-0" />
            <span className="text-[11px] font-medium text-amber-700 dark:text-amber-300 truncate">
              Superadmin Impersonating
            </span>
          </div>
          <button
            onClick={handleResetImpersonation}
            className="text-[10px] font-bold text-amber-700 dark:text-amber-300 hover:underline px-1.5 py-0.5 rounded bg-amber-500/20 transition-colors"
          >
            Reset
          </button>
        </div>
      )}

      {/* Search Input for Superadmin */}
      {isSuperadmin && (
        <div className="p-2 border-b border-gray-100 dark:border-[#252822]">
          <div className="relative flex items-center">
            <Search className="w-3.5 h-3.5 absolute left-2.5 text-gray-400" />
            <input
              type="text"
              placeholder="Search organizations..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-8 pr-3 py-1.5 text-xs bg-gray-100 dark:bg-[#22251f] border-none rounded-xl text-gray-900 dark:text-white placeholder-gray-400 focus:outline-none focus:ring-1 focus:ring-emerald-500"
            />
          </div>
        </div>
      )}

      {/* Organization List */}
      <div className="max-h-64 overflow-y-auto p-1 space-y-0.5">
        {loading ? (
          <div className="flex items-center justify-center py-6 text-xs text-gray-400 gap-2">
            <Loader2 className="w-4 h-4 animate-spin text-emerald-500" />
            <span>Loading organizations...</span>
          </div>
        ) : filteredOrgs.length > 0 ? (
          filteredOrgs.map((org) => {
            const isSelected =
              org.name === currentOrgName || org.id === currentOrgId;

            return (
              <button
                key={org.id}
                onClick={() => handleSwitchOrg(org)}
                disabled={isSwitching}
                className={`w-full flex items-center justify-between px-3 py-2.5 rounded-xl text-left transition-colors text-xs ${
                  isSelected
                    ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 font-semibold"
                    : "hover:bg-gray-100 dark:hover:bg-white/5 text-gray-700 dark:text-[#c8ccc5]"
                }`}
              >
                <div className="flex flex-col min-w-0 pr-2">
                  <span className="truncate font-medium">{org.name}</span>
                  {org.slug && (
                    <span className="text-[10px] text-gray-400 truncate">
                      ID: {org.id} • {org.slug}
                    </span>
                  )}
                </div>
                {isSelected && (
                  <Check className="w-4 h-4 text-emerald-600 dark:text-emerald-400 flex-shrink-0" />
                )}
              </button>
            );
          })
        ) : isSuperadmin ? (
          <div className="py-6 text-center text-xs text-gray-400">
            No organizations found.
          </div>
        ) : (
          <div className="p-3 text-xs text-gray-700 dark:text-[#c8ccc5]">
            <div className="font-semibold">{currentOrgName || "Your Organization"}</div>
          </div>
        )}
      </div>

      {/* Footer */}
      {isImpersonating && (
        <div className="p-2 border-t border-gray-100 dark:border-[#252822] bg-gray-50/50 dark:bg-[#141513]">
          <button
            onClick={handleResetImpersonation}
            className="w-full flex items-center justify-center gap-1.5 py-1.5 px-3 rounded-xl bg-gray-200/80 dark:bg-white/10 hover:bg-gray-300 dark:hover:bg-white/15 text-xs font-semibold text-gray-800 dark:text-white transition-colors"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            <span>Switch Back to My Org</span>
          </button>
        </div>
      )}
    </div>
  );
};
