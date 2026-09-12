"use client";

const ACCESS_TOKEN_KEY = "podium.accessToken";
const REFRESH_TOKEN_KEY = "podium.refreshToken";

export function getAccessToken(): string | null {
  if (typeof window === "undefined") return null;
  return window.localStorage.getItem(ACCESS_TOKEN_KEY);
}

export function setTokens(accessToken: string, refreshToken: string) {
  window.localStorage.setItem(ACCESS_TOKEN_KEY, accessToken);
  window.localStorage.setItem(REFRESH_TOKEN_KEY, refreshToken);
}

export function clearTokens() {
  window.localStorage.removeItem(ACCESS_TOKEN_KEY);
  window.localStorage.removeItem(REFRESH_TOKEN_KEY);
}

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
 * Thin fetch wrapper. Tokens live in localStorage for this build (a
 * pragmatic dev-time choice — see docs/STATUS.md for why this isn't
 * httpOnly-cookie session auth yet). All requests go through the Next.js
 * rewrite at /api/* -> the NestJS API, so there's no CORS to manage.
 */
export async function apiFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
  const token = getAccessToken();
  const res = await fetch(`/api${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
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
 * browser a file.
 *
 * Deliberately NOT a plain `<a href>`: the API authenticates from the
 * Authorization header, and the alternative — putting the access token in
 * the URL as a query parameter — would leak a live credential into browser
 * history, the Referer header and any intermediary's access logs. So the
 * fetch carries the header, and the resulting blob is handed to a synthetic
 * anchor that is revoked immediately afterwards.
 */
export async function apiDownload(path: string, fallbackFilename: string): Promise<void> {
  const token = getAccessToken();
  const res = await fetch(`/api${path}`, {
    headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}) },
  });
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

export const api = {
  get: <T>(path: string) => apiFetch<T>(path),
  post: <T>(path: string, data?: unknown) => apiFetch<T>(path, { method: "POST", body: data ? JSON.stringify(data) : undefined }),
  patch: <T>(path: string, data?: unknown) => apiFetch<T>(path, { method: "PATCH", body: data ? JSON.stringify(data) : undefined }),
};
