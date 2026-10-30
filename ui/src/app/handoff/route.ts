import { NextRequest, NextResponse } from "next/server";

import { getServerBackendUrl } from "@/lib/apiClient";

const OSS_TOKEN_COOKIE = "dograh_auth_token";
const OSS_USER_COOKIE = "dograh_auth_user";

/**
 * Landing point when someone switches over from the new UI. Exchanges the
 * one-time code for a normal session, then opens the dashboard.
 *   /handoff?code=<one-time code>
 */
export async function GET(request: NextRequest) {
    const code = new URL(request.url).searchParams.get("code");
    const toLogin = () => NextResponse.redirect(new URL("/auth/login", request.url));
    if (!code) return toLogin();

    let data: { token?: string; user?: unknown } | null = null;
    try {
        const res = await fetch(`${getServerBackendUrl()}/api/v1/product/auth/handoff/redeem`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ code, to: "classic" }),
            cache: "no-store",
        });
        if (res.ok) data = await res.json();
    } catch {
        /* fall through to the login page */
    }
    if (!data?.token) return toLogin();

    const response = NextResponse.redirect(new URL("/", request.url));
    const opts = {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: "lax" as const,
        maxAge: 60 * 60 * 24 * 30,
        path: "/",
    };
    response.cookies.set(OSS_TOKEN_COOKIE, data.token, opts);
    response.cookies.set(OSS_USER_COOKIE, JSON.stringify(data.user), opts);
    return response;
}
