import { useState } from "react";
import { useAuth } from "../../client/auth";
import styles from "./AccountBar.module.scss";

// The account affordance for the review/publish flow: when signed in it shows the
// account's display name and a sign-out control; when signed out it offers an
// inline login / register form. Mutating run-lifecycle actions (push, submit
// review, publish) are gated on being signed in, so this is rendered above them
// in the review editor. The register/login calls go through the active worker
// transport (the worker proxies the auth service); see `client/auth.tsx`.
export function AccountBar() {
  const { account, login, register, logout } = useAuth();
  const [mode, setMode] = useState<"login" | "register">("login");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (account) {
    return (
      <div className={styles.bar}>
        <span className={styles.who}>
          Signed in as <strong>{account.displayName}</strong>{" "}
          <span className={styles.handle}>@{account.username}</span>
        </span>
        <button type="button" className={styles.link} onClick={logout}>
          Sign out
        </button>
      </div>
    );
  }

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      if (mode === "register") {
        await register(username.trim(), password, displayName.trim());
      } else {
        await login(username.trim(), password);
      }
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }

  const canSubmit =
    username.trim() !== "" &&
    password !== "" &&
    (mode === "login" || displayName.trim() !== "");

  return (
    <form className={styles.form} onSubmit={onSubmit}>
      <p className={styles.prompt}>
        {mode === "login"
          ? "Sign in to review and publish this run."
          : "Create an account to review and publish runs."}
      </p>
      <div className={styles.fields}>
        <input
          className={styles.input}
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          placeholder="username"
          autoComplete="username"
        />
        {mode === "register" && (
          <input
            className={styles.input}
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            placeholder="display name"
            autoComplete="name"
          />
        )}
        <input
          className={styles.input}
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="password"
          autoComplete={mode === "login" ? "current-password" : "new-password"}
        />
        <button
          type="submit"
          className={styles.primary}
          disabled={busy || !canSubmit}
        >
          {mode === "login" ? "Sign in" : "Register"}
        </button>
      </div>
      <button
        type="button"
        className={styles.link}
        onClick={() => {
          setMode((m) => (m === "login" ? "register" : "login"));
          setError(null);
        }}
      >
        {mode === "login"
          ? "Need an account? Register"
          : "Have an account? Sign in"}
      </button>
      {error && <p className={styles.error}>{error}</p>}
    </form>
  );
}
