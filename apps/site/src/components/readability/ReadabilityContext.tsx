import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import {
  DEFAULT_READABILITY,
  isReadabilityVariant,
  type ReadabilityVariant,
} from "./variants";

// Shared, persisted choice of how prose is made legible over the backdrop. The
// floating switcher writes it and every <ReadableSurface> reads it, so it lives
// in a context that wraps the whole tree in `main.tsx` (mirroring the backdrop
// settings provider).
interface ReadabilitySettings {
  variant: ReadabilityVariant;
  setVariant: (variant: ReadabilityVariant) => void;
}

const STORAGE_KEY = "ttc:readability:variant";

const ReadabilityContext = createContext<ReadabilitySettings | null>(null);

// Reads the persisted choice, tolerating environments where `localStorage` is
// unavailable (private mode, SSR-style prerender) and unknown stored values.
function readStoredVariant(): ReadabilityVariant {
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    return isReadabilityVariant(stored) ? stored : DEFAULT_READABILITY;
  } catch {
    return DEFAULT_READABILITY;
  }
}

export function ReadabilityProvider({ children }: { children: ReactNode }) {
  const [variant, setVariant] = useState<ReadabilityVariant>(readStoredVariant);

  useEffect(() => {
    try {
      window.localStorage.setItem(STORAGE_KEY, variant);
    } catch {
      // Persistence is best-effort; ignore storage failures.
    }
  }, [variant]);

  const value = useMemo<ReadabilitySettings>(
    () => ({ variant, setVariant }),
    [variant],
  );

  return (
    <ReadabilityContext.Provider value={value}>
      {children}
    </ReadabilityContext.Provider>
  );
}

export function useReadability(): ReadabilitySettings {
  const settings = useContext(ReadabilityContext);
  if (!settings) {
    throw new Error("useReadability must be used within a ReadabilityProvider");
  }
  return settings;
}
