import { useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router";
import { useAuth } from "../../../client/auth";
import { routes } from "../../routes";
import styles from "./AccountPages.module.scss";

// The shared sign-in / registration form, rendered as its own page by
// {@link LoginPage} and {@link RegisterPage}. The register/login calls go through
// the auth context (which talks to the active worker's auth proxy). On success it
// returns to the `next` path — the page the user came from (e.g. a run they were
// about to review) — defaulting to the account view. The companion mode is a link
// that preserves `next`, so toggling between Sign in and Register keeps the
// return target.
export function AuthForm({ mode }: { mode: "login" | "register" }) {
  const { login, register } = useAuth();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const next = params.get("next") || routes.account();

  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canSubmit =
    username.trim() !== "" &&
    password !== "" &&
    (mode === "login" || displayName.trim() !== "");

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (!canSubmit) return;
    setBusy(true);
    setError(null);
    try {
      if (mode === "register") {
        await register(username.trim(), password, displayName.trim());
      } else {
        await login(username.trim(), password);
      }
      navigate(next, { replace: true });
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }

  // The other mode's page, carrying the same return target.
  const other = mode === "login" ? routes.register(next) : routes.login(next);

  return (
    <form className={styles.form} onSubmit={onSubmit}>
      <div className={styles.fields}>
        <label className={styles.field}>
          <span className={styles.fieldLabel}>Username</span>
          <input
            className={styles.input}
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            autoComplete="username"
            autoFocus
          />
        </label>
        {mode === "register" && (
          <label className={styles.field}>
            <span className={styles.fieldLabel}>Display name</span>
            <input
              className={styles.input}
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              autoComplete="name"
              placeholder="shown beside your reviews"
            />
          </label>
        )}
        <label className={styles.field}>
          <span className={styles.fieldLabel}>Password</span>
          <input
            className={styles.input}
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete={mode === "login" ? "current-password" : "new-password"}
          />
        </label>
      </div>
      <button
        type="submit"
        className={styles.primary}
        disabled={busy || !canSubmit}
      >
        {mode === "login" ? "Sign in" : "Create account"}
      </button>
      {error && <p className={styles.error}>{error}</p>}
      <p className={styles.alt}>
        {mode === "login" ? (
          <>
            Need an account? <Link to={other}>Register</Link>
          </>
        ) : (
          <>
            Have an account? <Link to={other}>Sign in</Link>
          </>
        )}
      </p>
    </form>
  );
}
