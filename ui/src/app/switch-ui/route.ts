import { cookies } from "next/headers";
import { NextRequest, NextResponse } from "next/server";

import { getServerBackendUrl } from "@/lib/apiClient";

const OSS_TOKEN_COOKIE = "dograh_auth_token";

/**
 * "Switch to the new UI": asks the backend for a one-time code for the signed-in
 * user and sends the browser to the new app, which turns it into a session.
 * Needs VOCALIS_URL (server env) to be set; otherwise the link is not offered.
 */
export async function GET(request: NextRequest) {
    const target = process.env.VOCALIS_URL;
    const token = (await cookies()).get(OSS_TOKEN_COOKIE)?.value;
    if (!target) return new Response("The new UI isn't set up.", { status: 404 });
    if (!token) return NextResponse.redirect(new URL("/auth/login", request.url));

    try {
        const res = await fetch(`${getServerBackendUrl()}/api/v1/product/auth/handoff`, {
            method: "POST",
            headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
            body: JSON.stringify({ to: "product" }),
            cache: "no-store",
        });
        if (res.ok) {
            const { code } = await res.json();
            return NextResponse.redirect(`${target.replace(/\/$/, "")}/?handoff=${encodeURIComponent(code)}`);
        }
    } catch {
        /* fall through */
    }
    return NextResponse.redirect(new URL("/", request.url));
}
