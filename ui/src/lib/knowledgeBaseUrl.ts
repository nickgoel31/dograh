import { client } from "@/client/client.gen";
import type { DocumentResponseSchema } from "@/client/types.gen";
import { detailFromError } from "@/lib/apiError";

/** Knowledge base document including the URL-source fields. */
export type KnowledgeDocument = DocumentResponseSchema & {
  refresh_interval_hours?: number | null;
  last_refreshed_at?: string | null;
  last_refresh_error?: string | null;
};

export const REFRESH_OPTIONS: { value: string; label: string }[] = [
  { value: "", label: "Manual only" },
  { value: "1", label: "Every hour" },
  { value: "6", label: "Every 6 hours" },
  { value: "12", label: "Every 12 hours" },
  { value: "24", label: "Daily" },
  { value: "168", label: "Weekly" },
];

async function call<T>(
  method: "POST" | "PATCH",
  path: string,
  body?: unknown,
): Promise<T> {
  const res = await client.request<T>({
    method,
    url: `/api/v1/knowledge-base${path}`,
    ...(body !== undefined ? { body: body as Record<string, unknown> } : {}),
  });
  if (res.error) throw new Error(detailFromError(res.error, "Request failed"));
  return res.data as T;
}

export const addUrlSource = (params: {
  url: string;
  retrieval_mode: "chunked" | "full_document";
  refresh_interval_hours: number | null;
}) => call<KnowledgeDocument>("POST", "/process-url", params);

export const refreshUrlSource = (documentUuid: string) =>
  call<{ detail: string }>("POST", `/documents/${documentUuid}/refresh`);

export const setRefreshInterval = (documentUuid: string, hours: number | null) =>
  call<KnowledgeDocument>("PATCH", `/documents/${documentUuid}/refresh-settings`, {
    refresh_interval_hours: hours,
  });
