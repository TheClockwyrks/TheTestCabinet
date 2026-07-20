import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import type { Account, AuthResult } from "./types";
import { useWorkers } from "./context";

// The signed-in account, shared across the console. The actual register/login
// network calls go through the *active worker* transport (the worker proxies the
// standalone auth service over `POST /auth/{register,login}`); this provider only
// owns the resulting token + account and persists them in localStorage so a
// reload keeps the session. The token authorizes every mutating run-lifecycle
// call (push/review/publish), which read it from `useAuth().token`.

const STORAGE_KEY = "tcab.auth";

interface StoredAuth {
  token: string;
  account: Account;
}

export interface AuthContextValue {
  /** The signed-in account, or null when logged out. */
  account: Account | null;
  /** The bearer token, or null when logged out. */
  token: string | null;
  /** Register a new account and sign in. Throws on failure (e.g. taken username). */
  register: (
    username: string,
    password: string,
    displayName: string,
  ) => Promise<void>;
  /** Log in to an existing account. Throws on bad credentials. */
  login: (username: string, password: string) => Promise<void>;
  /** Sign out — clears the stored token and account. */
  logout: () => void;
  /**
   * Set or replace the signed-in account's profile picture from an image blob
   * (already downscaled by the caller), updating the session in place. Throws when
   * signed out or the active transport can't set a picture.
   */
  setProfilePicture: (picture: Blob) => Promise<void>;
  /**
   * Clear the signed-in account's profile picture, updating the session in place.
   * Throws when signed out or the active transport can't change a picture.
   */
  removeProfilePicture: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

function readStored(): StoredAuth | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as StoredAuth;
    return parsed.token && parsed.account ? parsed : null;
  } catch {
    return null;
  }
}

// Wraps the console below the workers provider (so it can reach the active worker
// transport) and exposes the auth state to the review/publish UI. A host that has
// no auth (the static site) simply never mounts it; components guard with
// {@link useAuth} returning a logged-out value there.
export function AuthProvider({ children }: { children: ReactNode }) {
  const { active: worker } = useWorkers();
  const client = worker?.client ?? null;
  const [stored, setStored] = useState<StoredAuth | null>(() => readStored());

  const persist = useCallback((result: AuthResult) => {
    const next: StoredAuth = {
      token: result.token,
      account: result.account,
    };
    setStored(next);
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    } catch {
      /* private mode / storage full — keep the in-memory session */
    }
  }, []);

  const register = useCallback(
    async (username: string, password: string, displayName: string) => {
      if (!client)
        throw new Error("No worker connected to authenticate against.");
      persist(await client.register(username, password, displayName));
    },
    [client, persist],
  );

  const login = useCallback(
    async (username: string, password: string) => {
      if (!client)
        throw new Error("No worker connected to authenticate against.");
      persist(await client.login(username, password));
    },
    [client, persist],
  );

  const logout = useCallback(() => {
    setStored(null);
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch {
      /* ignore */
    }
  }, []);

  // Replace the stored account (keeping the token) after a profile change, and
  // persist it so a reload keeps the update.
  const updateAccount = useCallback((account: Account) => {
    setStored((prev) => {
      if (!prev) return prev;
      const next: StoredAuth = { token: prev.token, account };
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      } catch {
        /* private mode / storage full — keep the in-memory session */
      }
      return next;
    });
  }, []);

  const setProfilePicture = useCallback(
    async (picture: Blob) => {
      if (!client?.setProfilePicture || !stored) {
        throw new Error("Cannot set a profile picture here.");
      }
      updateAccount(await client.setProfilePicture(picture, stored.token));
    },
    [client, stored, updateAccount],
  );

  const removeProfilePicture = useCallback(async () => {
    if (!client?.removeProfilePicture || !stored) {
      throw new Error("Cannot change the profile picture here.");
    }
    updateAccount(await client.removeProfilePicture(stored.token));
  }, [client, stored, updateAccount]);

  const value = useMemo<AuthContextValue>(
    () => ({
      account: stored?.account ?? null,
      token: stored?.token ?? null,
      register,
      login,
      logout,
      setProfilePicture,
      removeProfilePicture,
    }),
    [stored, register, login, logout, setProfilePicture, removeProfilePicture],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

// Read the auth state. Returns a logged-out value (with throwing actions) when no
// provider is mounted — so the static gallery, which never authenticates, can
// still call it without crashing.
export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (ctx) return ctx;
  return {
    account: null,
    token: null,
    register: () =>
      Promise.reject(new Error("Accounts are not available here.")),
    login: () => Promise.reject(new Error("Accounts are not available here.")),
    logout: () => {},
    setProfilePicture: () =>
      Promise.reject(new Error("Accounts are not available here.")),
    removeProfilePicture: () =>
      Promise.reject(new Error("Accounts are not available here.")),
  };
}
