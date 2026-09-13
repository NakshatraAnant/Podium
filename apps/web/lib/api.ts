"use client";

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public details?: unknown,
  ) {
    super(message);
  }
}

/**
 * Thin fetch wrapper. Phase H: auth rides in an httpOnly cookie the API sets
 * on login/refresh/accept-invite — the browser attaches it automatically to
 * every same-origin request, so there is no token for this code to read or
 * send by hand (and no way to: an httpOnly cookie is invisible to JS, which
 * is the whole point — an injected script can no longer steal a live
 * session the way it could out of localStorage). All requests go through
 * the Next.js rewrite at /api/* -> the NestJS API, so the cookie is same-
 * origin from the browser's perspective and fetch's default credentials
 * mode ("same-origin") already includes it with no extra option needed.
 */
export async function apiFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(`/api${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...init.headers,
    },
  });

  if (res.status === 204) return undefined as T;

  const body = await res.json().catch(() => undefined);
  if (!res.ok) {
    const err = body?.error;
    throw new ApiError(res.status, err?.code ?? "UNKNOWN", err?.message ?? res.statusText, err?.details);
  }
  return body as T;
}

/**
 * Downloads a binary response (currently: invoice PDFs) and hands the
 * browser a file. The httpOnly session cookie is sent automatically, same
 * as any other same-origin fetch — nothing to attach by hand.
 */
export async function apiDownload(path: string, fallbackFilename: string): Promise<void> {
  const res = await fetch(`/api${path}`);
  if (!res.ok) {
    const body = await res.json().catch(() => undefined);
    throw new ApiError(res.status, body?.error?.code ?? "UNKNOWN", body?.error?.message ?? res.statusText);
  }

  // Prefer the server's own filename — it knows the real invoice number.
  const disposition = res.headers.get("content-disposition") ?? "";
  const match = /filename="([^"]+)"/.exec(disposition);
  const filename = match?.[1] ?? fallbackFilename;

  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

/**
 * Multipart upload — deliberately NOT apiFetch(), which forces
 * `Content-Type: application/json` unconditionally. FormData needs the
 * browser to set its own `multipart/form-data; boundary=...` header itself;
 * forcing JSON there would silently corrupt every upload.
 */
export async function apiUpload<T>(path: string, formData: FormData, method: "POST" = "POST"): Promise<T> {
  const res = await fetch(`/api${path}`, { method, body: formData });
  const body = await res.json().catch(() => undefined);
  if (!res.ok) {
    const err = body?.error;
    throw new ApiError(res.status, err?.code ?? "UNKNOWN", err?.message ?? res.statusText, err?.details);
  }
  return body as T;
}

export const api = {
  get: <T>(path: string) => apiFetch<T>(path),
  post: <T>(path: string, data?: unknown) => apiFetch<T>(path, { method: "POST", body: data ? JSON.stringify(data) : undefined }),
  patch: <T>(path: string, data?: unknown) => apiFetch<T>(path, { method: "PATCH", body: data ? JSON.stringify(data) : undefined }),
  delete: <T>(path: string) => apiFetch<T>(path, { method: "DELETE" }),
};
