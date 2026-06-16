import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

// Shared, persisted state for the decorative backdrop. The WebGL scene
// (mounted outside the router) and the topbar toggle (inside the router) both
// read this, so it lives in a context that wraps the whole tree in `main.tsx`.
interface BackdropSettings {
  // Whether the banded synthwave sun is shown. On by default; the user can
  // opt out via the topbar toggle.
  sunEnabled: boolean;
  toggleSun: () => void;
}

const STORAGE_KEY = "ttc:backdrop:sun";

const BackdropSettingsContext = createContext<BackdropSettings | null>(null);

// Reads the persisted sun preference, tolerating environments where
// `localStorage` is unavailable (private mode, SSR-style prerender). Defaults
// to on when no preference is stored; only an explicit opt-out disables it.
function readStoredSun(): boolean {
  try {
    return window.localStorage.getItem(STORAGE_KEY) !== "false";
  } catch {
    return true;
  }
}

export function BackdropSettingsProvider({ children }: { children: ReactNode }) {
  const [sunEnabled, setSunEnabled] = useState(readStoredSun);

  useEffect(() => {
    try {
      window.localStorage.setItem(STORAGE_KEY, String(sunEnabled));
    } catch {
      // Persistence is best-effort; ignore storage failures.
    }
  }, [sunEnabled]);

  const toggleSun = useCallback(() => setSunEnabled((on) => !on), []);

  const value = useMemo<BackdropSettings>(
    () => ({ sunEnabled, toggleSun }),
    [sunEnabled, toggleSun],
  );

  return (
    <BackdropSettingsContext.Provider value={value}>
      {children}
    </BackdropSettingsContext.Provider>
  );
}

export function useBackdropSettings(): BackdropSettings {
  const settings = useContext(BackdropSettingsContext);
  if (!settings) {
    throw new Error(
      "useBackdropSettings must be used within a BackdropSettingsProvider",
    );
  }
  return settings;
}
