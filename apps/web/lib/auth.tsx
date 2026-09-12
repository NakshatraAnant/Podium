"use client";

import type { AuthTokens } from "@podium/shared-types";
import { useRouter } from "next/navigation";
import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { api, clearTokens, getAccessToken, setTokens } from "./api";

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
    const token = getAccessToken();
    if (!token) {
      setLoading(false);
      return;
    }
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
      .catch(() => clearTokens())
      .finally(() => setLoading(false));
  }, []);

  const login = useCallback(
    async (email: string, password: string) => {
      const res = await api.post<AuthTokens>("/auth/login", { email, password });
      setTokens(res.accessToken, res.refreshToken);
      setUser(res.user);
      router.push("/dashboard");
    },
    [router],
  );

  const logout = useCallback(() => {
    clearTokens();
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
