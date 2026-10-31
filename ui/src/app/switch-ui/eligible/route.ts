import { cookies } from "next/headers";
import { NextResponse } from "next/server";

import { getServerBackendUrl } from "@/lib/apiClient";

const OSS_TOKEN_COOKIE = "dograh_auth_token";

/**
 * Whether to show "Switch to the new UI" to this person. The backend decides which
 * organizations are switched on; anyone else never sees the link.
 */
export async function GET() {
    const token = (await cookies()).get(OSS_TOKEN_COOKIE)?.value;
    if (!process.env.VOCALIS_URL || !token) return NextResponse.json({ eligible: false });
    try {
        const res = await fetch(`${getServerBackendUrl()}/api/v1/product/auth/handoff/eligible`, {
            headers: { Authorization: `Bearer ${token}` },
            cache: "no-store",
        });
        if (res.ok) return NextResponse.json(await res.json());
    } catch {
        /* fall through: when in doubt, hide it */
    }
    return NextResponse.json({ eligible: false });
}
