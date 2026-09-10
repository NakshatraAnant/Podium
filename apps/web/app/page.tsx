"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { getAccessToken } from "../lib/api";

export default function RootPage() {
  const router = useRouter();
  useEffect(() => {
    router.replace(getAccessToken() ? "/dashboard" : "/login");
  }, [router]);
  return null;
}
