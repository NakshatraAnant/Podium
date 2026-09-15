"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState, type FormEvent } from "react";
import { ApiError, api } from "../../lib/api";
import { useAuth } from "../../lib/auth";

/**
 * BUG-003's missing half.
 *
 * `mustChangePassword` has been enforced server-side since the password
 * lifecycle work — MustChangePasswordGuard 403s every authenticated route
 * except this one — and `authTokensSchema` documents that the flag "forces
 * the frontend into the change-password screen". That screen was never
 * built, so until now an account created with the flag set could sign in and
 * then watch every single request fail with no way out. The 2026-09-15
 * employee provisioning made that the normal case for all 25 real accounts,
 * which is how it surfaced.
 *
 * Deliberately NOT inside AppShell: the shell's nav, notification bell and
 * dashboard queries would all 403 behind the same guard, so rendering it
 * here would fill the screen with errors the user cannot act on.
 */
const MIN_LENGTH = 10;

export default function ChangePasswordPage() {
  const { user, loading, markPasswordChanged } = useAuth();
  const router = useRouter();

  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!loading && !user) router.replace("/login");
  }, [loading, user, router]);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);

    // Checked here purely so the mismatch is caught before a round trip; the
    // length rule is enforced by the API's Zod schema either way.
    if (newPassword !== confirmPassword) return setError("The two new passwords do not match.");
    if (newPassword.length < MIN_LENGTH) return setError(`Password must be at least ${MIN_LENGTH} characters.`);
    if (newPassword === currentPassword) return setError("The new password must be different from the temporary one.");

    setSubmitting(true);
    try {
      await api.post("/auth/change-password", { currentPassword, newPassword });
      // Clear the flag locally so AppShell stops bouncing us back here. The
      // server has already cleared it; this just avoids a reload.
      markPasswordChanged();
      router.replace("/dashboard");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not change the password.");
    } finally {
      setSubmitting(false);
    }
  }

  if (loading || !user) return <div className="center-screen" />;

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

        <div className="login-title">Choose a password</div>
        <div className="login-sub">
          {user.name}, your account was set up with a temporary password. Pick your own to continue — it buys one sign-in
          and nothing else.
        </div>

        {error && <div className="error-banner">{error}</div>}

        <form onSubmit={onSubmit}>
          <div className="field" style={{ marginBottom: 12 }}>
            <label htmlFor="currentPassword">Temporary password</label>
            <input
              id="currentPassword"
              name="currentPassword"
              type="password"
              autoComplete="current-password"
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
              required
            />
          </div>

          <div className="field" style={{ marginBottom: 12 }}>
            <label htmlFor="newPassword">New password</label>
            <input
              id="newPassword"
              name="newPassword"
              type="password"
              autoComplete="new-password"
              minLength={MIN_LENGTH}
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              required
            />
            <div className="page-sub" style={{ fontSize: 12, marginTop: 4 }}>
              At least {MIN_LENGTH} characters.
            </div>
          </div>

          <div className="field" style={{ marginBottom: 16 }}>
            <label htmlFor="confirmPassword">Confirm new password</label>
            <input
              id="confirmPassword"
              name="confirmPassword"
              type="password"
              autoComplete="new-password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              required
            />
          </div>

          <button className="btn-primary" type="submit" disabled={submitting} style={{ width: "100%" }}>
            {submitting ? "Saving…" : "Set password and continue"}
          </button>
        </form>
      </div>
    </div>
  );
}
