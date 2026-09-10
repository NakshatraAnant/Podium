"use client";

import { useState, type FormEvent } from "react";
import { ApiError } from "../../lib/api";
import { useAuth } from "../../lib/auth";

export default function LoginPage() {
  const { login } = useAuth();
  const [email, setEmail] = useState("anant.sharma@ammbrands.in");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await login(email, password);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not sign in.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="center-screen">
      <div className="login-card">
        <div className="brandmark" style={{ padding: 0, border: "none", marginBottom: 18 }}>
          <div className="mark">P</div>
          <div className="names">
            <div className="company" style={{ color: "var(--ink)" }}>
              Podium
            </div>
            <div className="sub" style={{ color: "var(--text-dim)" }}>
              AMM Brands LLP
            </div>
          </div>
        </div>
        <div className="login-title">Sign in</div>
        <div className="login-sub">Event production &amp; bar operations, six cities.</div>
        {error && <div className="error-banner">{error}</div>}
        <form onSubmit={onSubmit}>
          <div className="field" style={{ marginBottom: 12 }}>
            <label htmlFor="email">Email</label>
            <input id="email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
          </div>
          <div className="field" style={{ marginBottom: 4 }}>
            <label htmlFor="password">Password</label>
            <input id="password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} required />
          </div>
          <button type="submit" className="btn-primary full-btn" disabled={submitting}>
            {submitting ? "Signing in…" : "Sign in"}
          </button>
        </form>
        <div className="small muted" style={{ marginTop: 14 }}>
          Dev seed password for every demo user: <span className="mono">Podium123!</span>
        </div>
      </div>
    </div>
  );
}
