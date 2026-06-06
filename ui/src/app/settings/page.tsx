"use client";

import { ExternalLink, Settings } from "lucide-react";

import { BillingConfigSection } from "@/components/BillingConfigSection";
import { MCPSection } from "@/components/MCPSection";
import { TeamSection } from "@/components/TeamSection";
import { TelemetrySection } from "@/components/TelemetrySection";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { useCurrentUserRole } from "@/hooks/useCurrentUserRole";

export default function SettingsPage() {
  const { role, isSuperadmin, loading } = useCurrentUserRole();

  const showTeamSection = !loading && (role === "admin" || role === "super_admin" || isSuperadmin);

  return (
    <div className="flex justify-center py-12 px-4 fade-in-up">
      <div className="w-full max-w-2xl space-y-6">
        <div className="flex justify-between items-end mb-8 page-header">
            <div>
                <h1 className="text-3xl font-extrabold tracking-tight mb-1 flex items-center gap-3">
                    <div className="icon-container">
                        <Settings className="h-6 w-6" />
                    </div>
                    Platform Settings
                </h1>
                <p className="text-muted-foreground mt-2">
                    Manage your platform configuration and integrations.
                </p>
            </div>
        </div>

        {showTeamSection && (
          <Card className="glass-card fade-in-up" style={{ animationDelay: '0.1s' }}>
            <CardHeader>
              <CardTitle>Team Members</CardTitle>
              <CardDescription>
                Manage team members, roles, and invite new members to join your workspace.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <TeamSection />
            </CardContent>
          </Card>
        )}

        <Card className="glass-card fade-in-up" style={{ animationDelay: '0.2s' }}>
          <CardHeader>
            <CardTitle>MCP Server</CardTitle>
            <CardDescription>
              Let AI agents access your Dograh workspace and documentation via
              the Model Context Protocol.{" "}
              <a
                href="https://docs.dograh.com/integrations/mcp"
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-0.5 underline text-primary hover:text-primary/80 transition-colors"
              >
                Learn more <ExternalLink className="h-3 w-3" />
              </a>
            </CardDescription>
          </CardHeader>
          <CardContent>
            <MCPSection />
          </CardContent>
        </Card>

        <Card className="glass-card fade-in-up" style={{ animationDelay: '0.3s' }}>
          <CardHeader>
            <CardTitle>Telemetry</CardTitle>
            <CardDescription>
              Configure Langfuse tracing for your voice agent calls.{" "}
              <a
                href="https://docs.dograh.com/configurations/tracing"
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-0.5 underline text-primary hover:text-primary/80 transition-colors"
              >
                Learn more <ExternalLink className="h-3 w-3" />
              </a>
            </CardDescription>
          </CardHeader>
          <CardContent>
            <TelemetrySection />
          </CardContent>
        </Card>

        <Card className="glass-card fade-in-up" style={{ animationDelay: '0.4s' }}>
          <CardHeader>
            <CardTitle>Billing Configuration</CardTitle>
            <CardDescription>
              Configure the tier thresholds and call pricing for your organization.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <BillingConfigSection />
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
