"use client";

import Link from "next/link";
import Image from "next/image";
import React, { useState } from "react";
import { toast } from "sonner";
import { CheckCircle2 } from "lucide-react";

import { signupApiV1AuthSignupPost } from "@/client/sdk.gen";

export default function SignupPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (password.length < 8) {
      toast.error("Password must be at least 8 characters");
      return;
    }

    if (password !== confirmPassword) {
      toast.error("Passwords do not match");
      return;
    }

    setLoading(true);

    try {
      const res = await signupApiV1AuthSignupPost({
        body: { email, password },
      });

      if (res.error || !res.data) {
        const detail = (res.error as { detail?: string })?.detail;
        toast.error(detail || "Signup failed");
        return;
      }

      // Set httpOnly cookies via server route
      await fetch("/api/auth/session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: res.data.token, user: res.data.user }),
      });

      window.location.href = "/after-sign-in";
    } catch {
      toast.error("An error occurred. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-white dark:bg-[#161715] flex flex-col md:flex-row w-screen h-screen font-sans select-none overflow-hidden">
      {/* Left Half: Organic Dark Green Artwork Panel */}
      <div className="hidden md:block w-1/2 h-full relative overflow-hidden bg-[#152e1f]">
        <div className="absolute inset-0 bg-gradient-to-br from-[#1b4329] via-[#0d2a1b] to-[#081810]" />
        
        {/* Abstract Fluid Glow Layers */}
        <div className="absolute -top-24 -left-24 w-[120%] h-[120%] opacity-80 mix-blend-screen pointer-events-none">
          <div className="absolute top-1/4 left-1/4 w-96 h-96 bg-[#4ade80]/20 rounded-full blur-3xl animate-pulse" />
          <div className="absolute top-1/3 left-1/2 w-80 h-80 bg-[#38bdf8]/20 rounded-full blur-3xl" />
          <div className="absolute bottom-1/4 left-1/3 w-[30rem] h-[30rem] bg-[#15803d]/30 rounded-full blur-3xl" />
        </div>

        {/* Pixel Grid Motif */}
        <div className="absolute inset-0 opacity-40 bg-[radial-gradient(#4ade80_1px,transparent_1px)] [background-size:16px_16px]" />

        <div className="relative h-full flex flex-col justify-between p-12 text-white z-10">
          <div className="flex items-center gap-3">
            <Image src="/logo.webp" alt="Swarvo AI Logo" width={32} height={32} className="w-8 h-8 object-contain invert" />
            <span className="text-xl font-serif tracking-tight font-normal text-white">Swarvo AI</span>
          </div>

          <div className="space-y-3 max-w-md">
            <h2 className="text-3xl font-serif font-normal text-white leading-tight">
              Enterprise Voice & Conversational AI Workflows
            </h2>
            <p className="text-xs text-emerald-100/70 font-normal leading-relaxed">
              Build, test, and deploy ultra-low latency conversational AI voice agents across telephony and omnichannel web applications.
            </p>
          </div>

          <div className="text-[11px] text-emerald-200/50 font-medium">
            © {new Date().getFullYear()} Swarvo AI Inc. All rights reserved.
          </div>
        </div>
      </div>

      {/* Right Half: Minimal Sign Up Form */}
      <div className="flex-1 h-full bg-white dark:bg-[#161715] flex flex-col justify-between p-8 md:p-16 overflow-y-auto">
        <div className="w-full flex justify-end" />

        <div className="max-w-sm w-full mx-auto space-y-8 my-auto">
          {/* Header */}
          <div className="text-center space-y-3">
            <div className="w-12 h-12 rounded-2xl border border-gray-200 dark:border-[#2e312b] bg-gray-50 dark:bg-[#1f221c] flex items-center justify-center mx-auto shadow-2xs p-2">
              <Image src="/logo.webp" alt="Swarvo AI" width={32} height={32} className="w-8 h-8 object-contain dark:invert" />
            </div>
            <h1 className="text-2xl font-normal text-gray-900 dark:text-[#f2f4f0] font-serif tracking-tight">
              Create an account
            </h1>
          </div>

          {/* Form */}
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-1">
              <input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="e.g., name@company.com"
                className="w-full px-4 py-3 bg-white dark:bg-[#1a1c18] border border-gray-300 dark:border-[#2e312b] rounded-xl text-xs text-gray-900 dark:text-[#f2f4f0] placeholder-gray-400 dark:placeholder-gray-500 focus:outline-hidden focus:ring-2 focus:ring-black/10 dark:focus:ring-white/10 transition-all font-normal"
              />
            </div>

            <div className="space-y-1">
              <input
                type="password"
                required
                minLength={8}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Password (at least 8 characters)"
                className="w-full px-4 py-3 bg-white dark:bg-[#1a1c18] border border-gray-300 dark:border-[#2e312b] rounded-xl text-xs text-gray-900 dark:text-[#f2f4f0] placeholder-gray-400 dark:placeholder-gray-500 focus:outline-hidden focus:ring-2 focus:ring-black/10 dark:focus:ring-white/10 transition-all font-normal"
              />
            </div>

            <div className="space-y-1">
              <input
                type="password"
                required
                minLength={8}
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                placeholder="Confirm password"
                className="w-full px-4 py-3 bg-white dark:bg-[#1a1c18] border border-gray-300 dark:border-[#2e312b] rounded-xl text-xs text-gray-900 dark:text-[#f2f4f0] placeholder-gray-400 dark:placeholder-gray-500 focus:outline-hidden focus:ring-2 focus:ring-black/10 dark:focus:ring-white/10 transition-all font-normal"
              />
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full py-3 bg-gray-600 hover:bg-gray-700 dark:bg-gray-500 dark:hover:bg-gray-400 text-white dark:text-gray-950 text-xs font-semibold rounded-full shadow-xs transition-all active:scale-[0.99] flex items-center justify-center gap-2 cursor-pointer mt-2 disabled:opacity-50"
            >
              {loading ? (
                <CheckCircle2 className="w-4 h-4 animate-spin" />
              ) : (
                <span>Create account</span>
              )}
            </button>
          </form>

          {/* Already Have An Account Link */}
          <div className="text-center text-xs text-gray-500 dark:text-gray-400">
            Already have an account?{" "}
            <Link href="/auth/login" className="text-gray-900 dark:text-[#f2f4f0] font-semibold hover:underline">
              Log in
            </Link>
          </div>
        </div>

        {/* Footer */}
        <div className="text-center text-[11px] text-gray-400 dark:text-gray-500">
          By continuing you agree to our{" "}
          <a href="#" className="underline hover:text-gray-600 dark:hover:text-gray-300">
            terms of service
          </a>{" "}
          and{" "}
          <a href="#" className="underline hover:text-gray-600 dark:hover:text-gray-300">
            privacy policy
          </a>
        </div>
      </div>
    </div>
  );
}
