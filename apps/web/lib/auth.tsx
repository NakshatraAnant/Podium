"use client";

import type { AuthTokens } from "@podium/shared-types";
import { useRouter } from "next/navigation";
import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { api } from "./api";

type CurrentUser = AuthTokens["user"];

interface AuthContextValue {
  user: CurrentUser | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<void>;
  logout: () => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<CurrentUser | null>(null);
  const [loading, setLoading] = useState(true);
  const router = useRouter();

  useEffect(() => {
    // Phase H: the access token lives in an httpOnly cookie this code can't
    // read, so there's no client-side way to tell "logged in" from "not"
    // without asking the server — just call /users/me and let a 401 answer
    // the question.
    api
      .get<{
        id: string;
        name: string;
        email: string;
        roles: string[];
        cityAccess: CurrentUser["cityAccess"];
        mustChangePassword: boolean;
      }>("/users/me")
      .then((me) => setUser(me))
      .catch(() => setUser(null))
      .finally(() => setLoading(false));
  }, []);

  const login = useCallback(
    async (email: string, password: string) => {
      // The response still carries accessToken/refreshToken in the body for
      // any non-browser caller, but the browser doesn't need them — the
      // API's Set-Cookie header on this same response already planted the
      // httpOnly session cookie.
      const res = await api.post<AuthTokens>("/auth/login", { email, password });
      setUser(res.user);
      router.push("/dashboard");
    },
    [router],
  );

  const logout = useCallback(() => {
    // Only the server can clear an httpOnly cookie (JS can't touch it), and
    // logout must also revoke the refresh token server-side — so this is a
    // real request now, not just a local state reset. Fire-and-forget: the
    // UI moves on immediately either way.
    api.post("/auth/logout").catch(() => undefined);
    setUser(null);
    router.push("/login");
  }, [router]);

  return <AuthContext.Provider value={{ user, loading, login, logout }}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
