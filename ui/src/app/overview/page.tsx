"use client";

import {
  BookOpen,
  Bug,
  ExternalLink,
  Megaphone,
  MicVocal,
  Phone,
  Rocket,
  Settings2,
  TrendingUp,
  Workflow,
  Zap,
} from 'lucide-react';
import Link from 'next/link';

import { GitHubStarBadge } from '@/components/layout/GitHubStarBadge';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/lib/auth';

const QUICK_ACTIONS = [
  {
    title: "Voice Agents",
    description: "Build and deploy AI voice agents with our visual workflow editor.",
    icon: Workflow,
    href: "/workflow",
    cta: "Open Agents",
    accent: "oklch(0.70 0.22 280)",  // violet
  },
  {
    title: "Campaigns",
    description: "Run bulk outbound calls at scale using your agents.",
    icon: Megaphone,
    href: "/campaigns",
    cta: "Open Campaigns",
    accent: "oklch(0.65 0.20 195)",  // cyan
  },
  {
    title: "Models",
    description: "Configure LLM, TTS, and STT providers powering your agents.",
    icon: Settings2,
    href: "/model-configurations",
    cta: "Configure",
    accent: "oklch(0.72 0.18 155)",  // green
  },
  {
    title: "Telephony",
    description: "Connect phone numbers and manage your telephony providers.",
    icon: Phone,
    href: "/telephony-configurations",
    cta: "Set up",
    accent: "oklch(0.78 0.19 75)",  // amber
  },
];

const RESOURCE_LINKS = [
  {
    label: "Documentation",
    href: "https://docs.dograh.com",
    icon: BookOpen,
  },
  {
    label: "Report an Issue",
    href: "https://github.com/dograh-hq/dograh/issues",
    icon: Bug,
  },
];

export default function OverviewPage() {
  const { user, provider } = useAuth();
  const isOSSMode = provider !== 'stack';
  const firstName = user?.displayName?.split(' ')[0] || 'there';

  return (
    <div className="min-h-screen px-6 py-8 page-enter">
      <div className="max-w-5xl mx-auto space-y-8">

        {/* ── Welcome banner ── */}
        <div className="relative rounded-xl border border-border neural-card overflow-hidden">
          {/* Accent glow */}
          <div className="pointer-events-none absolute -top-24 -right-24 h-64 w-64 rounded-full bg-primary/10 blur-3xl" />
          <div className="pointer-events-none absolute -bottom-16 -left-16 h-48 w-48 rounded-full bg-cyan-500/8 blur-3xl" />

          <div className="relative px-6 py-7">
            <div className="flex items-start justify-between flex-wrap gap-4">
              <div>
                <div className="flex items-center gap-2 mb-2">
                  <MicVocal className="h-4 w-4 text-primary" />
                  <span className="text-xs font-semibold uppercase tracking-widest text-primary">Voice AI Platform</span>
                </div>
                <h1 className="text-3xl font-bold tracking-tight text-foreground">
                  {isOSSMode
                    ? "Welcome to Swarvo AI"
                    : <>Hey, <span className="text-primary">{firstName}</span> 👋</>
                  }
                </h1>
                <p className="mt-2 text-sm text-muted-foreground max-w-lg">
                  {isOSSMode
                    ? "The open-source voice AI platform. Build, deploy, and scale conversational voice agents."
                    : "Build powerful AI voice agents, run bulk campaigns, and monitor every interaction."
                  }
                </p>
                {isOSSMode && (
                  <div className="mt-4">
                    <GitHubStarBadge label="Star us on GitHub" showCount source="overview_page" />
                  </div>
                )}
              </div>

              <div className="flex items-center gap-2 flex-wrap">
                <Button asChild size="sm">
                  <Link href="/workflow">
                    <Rocket className="h-3.5 w-3.5 mr-1.5" />
                    Get Started
                  </Link>
                </Button>
                <Button asChild variant="outline" size="sm" className="border-border/60">
                  <Link href="/usage">
                    <TrendingUp className="h-3.5 w-3.5 mr-1.5" />
                    View Runs
                  </Link>
                </Button>
              </div>
            </div>
          </div>
        </div>

        {/* ── Quick actions grid ── */}
        <div>
          <h2 className="text-xs font-semibold uppercase tracking-widest text-muted-foreground mb-3 flex items-center gap-2">
            <Zap className="h-3.5 w-3.5" />
            Quick Actions
          </h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 stagger-children">
            {QUICK_ACTIONS.map(({ title, description, icon: Icon, href, cta, accent }) => (
              <Link
                key={title}
                href={href}
                className="group neural-card relative flex flex-col gap-3 rounded-xl p-4 no-underline transition-transform hover:-translate-y-0.5"
              >
                {/* Subtle icon-color corner glow */}
                <div
                  className="pointer-events-none absolute top-0 right-0 h-20 w-20 rounded-xl opacity-30 blur-2xl transition-opacity group-hover:opacity-50"
                  style={{ background: accent }}
                />
                <div
                  className="relative flex h-9 w-9 items-center justify-center rounded-lg border"
                  style={{
                    background: `color-mix(in oklch, ${accent} 12%, transparent)`,
                    borderColor: `color-mix(in oklch, ${accent} 25%, transparent)`,
                    color: accent,
                  }}
                >
                  <Icon className="h-4 w-4" />
                </div>
                <div className="flex-1">
                  <p className="text-sm font-semibold text-foreground">{title}</p>
                  <p className="mt-0.5 text-xs text-muted-foreground leading-relaxed">{description}</p>
                </div>
                <div
                  className="text-xs font-medium flex items-center gap-1 transition-colors"
                  style={{ color: accent }}
                >
                  {cta}
                  <ExternalLink className="h-3 w-3 opacity-60 group-hover:opacity-100 transition-opacity" />
                </div>
              </Link>
            ))}
          </div>
        </div>

        {/* ── Resources ── */}
        <div className="neural-card rounded-xl px-5 py-4">
          <div className="flex items-center justify-between flex-wrap gap-3">
            <div>
              <p className="text-sm font-semibold text-foreground flex items-center gap-2">
                <BookOpen className="h-4 w-4 text-muted-foreground" />
                Resources
              </p>
              <p className="text-xs text-muted-foreground mt-0.5">Docs, guides, and support</p>
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              {RESOURCE_LINKS.map(({ label, href, icon: Icon }) => (
                <Button key={label} asChild variant="outline" size="sm" className="border-border/60 text-xs h-8">
                  <a href={href} target="_blank" rel="noopener noreferrer">
                    <Icon className="h-3.5 w-3.5 mr-1.5" />
                    {label}
                  </a>
                </Button>
              ))}
            </div>
          </div>
        </div>

      </div>
    </div>
  );
}
