import "./globals.css";

import type { Metadata } from "next";
import { Fira_Code, Instrument_Serif, Hanken_Grotesk } from "next/font/google";
import { Suspense } from "react";

import AppLayout from "@/components/layout/AppLayout";
import PostHogIdentify from "@/components/PostHogIdentify";
import { SentryErrorBoundary } from "@/components/SentryErrorBoundary";
import SpinLoader from "@/components/SpinLoader";
import { Toaster } from "@/components/ui/sonner";
import { AppConfigProvider } from "@/context/AppConfigContext";
import { OnboardingProvider } from "@/context/OnboardingContext";
import { TelephonyConfigWarningsProvider } from "@/context/TelephonyConfigWarningsContext";
import { UserConfigProvider } from "@/context/UserConfigContext";
import { AuthProvider } from "@/lib/auth";


const sansFont = Hanken_Grotesk({
  variable: "--font-sans",
  subsets: ["latin"],
  display: "swap",
});

const monoFont = Fira_Code({
  variable: "--font-mono",
  subsets: ["latin"],
  display: "swap",
});

const serifFont = Instrument_Serif({
  weight: "400",
  style: "italic",
  variable: "--font-serif",
  subsets: ["latin"],
  display: "swap",
});

export const metadata: Metadata = {
  title: "Swarvo AI",
  description: "Open Source Voice Assistant Workflow Builder",
};

export default function RootLayout({
  children
  }: {
    children: React.ReactNode
  }) {

  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        {/* Inline script to prevent flash of light theme - runs before React hydrates */}
        <script
          dangerouslySetInnerHTML={{
            __html: `
              (function() {
                try {
                  var theme = localStorage.getItem('theme');
                  if (theme === 'dark' || (!theme && window.matchMedia('(prefers-color-scheme: dark)').matches)) {
                    document.documentElement.classList.add('dark');
                  } else {
                    document.documentElement.classList.remove('dark');
                  }
                } catch (e) {}
              })();
            `,
          }}
        />
        <link href="https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined:wght,FILL@100..700,0..1&display=swap" rel="stylesheet" />
      </head>
      <body
        className={`${sansFont.variable} ${monoFont.variable} ${serifFont.variable} antialiased`}>
        <SentryErrorBoundary>
          <AuthProvider>
            <AppConfigProvider>
              <Suspense fallback={<SpinLoader />}>
                <UserConfigProvider>
                  <TelephonyConfigWarningsProvider>
                    <OnboardingProvider>
                      <PostHogIdentify />
                      <AppLayout>
                        {children}
                      </AppLayout>
                      <Toaster />
                    </OnboardingProvider>
                  </TelephonyConfigWarningsProvider>
                </UserConfigProvider>
              </Suspense>
            </AppConfigProvider>
          </AuthProvider>
        </SentryErrorBoundary>
      </body>
    </html>
  );
}
