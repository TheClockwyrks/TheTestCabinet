import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import type { DesignVariant } from "./types";

// Shared, persisted choice of which test-case-detail design is active. The
// floating `DesignSwitcher` writes it and every detail shell / specs view reads
// it, so it lives in a context that wraps the whole app in `main.tsx` and the
// selection survives navigation between the detail tabs. This is an exploration
// scaffold: once a direction is chosen, the rest can be deleted and the winner
// promoted to the real layout.
interface DesignVariantState {
  design: DesignVariant;
  setDesign: (design: DesignVariant) => void;
}

const STORAGE_KEY = "ttc:design:variant";

const DEFAULT_DESIGN: DesignVariant = "refined";

const VALID: ReadonlySet<string> = new Set<DesignVariant>([
  "refined",
  "document",
  "rail",
  "deck",
]);

const DesignVariantContext = createContext<DesignVariantState | null>(null);

// Reads the persisted design, tolerating environments where `localStorage` is
// unavailable (private mode, prerender) and ignoring stale/unknown values.
function readStoredDesign(): DesignVariant {
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    if (stored && VALID.has(stored)) {
      return stored as DesignVariant;
    }
  } catch {
    // Fall through to the default.
  }
  return DEFAULT_DESIGN;
}

export function DesignVariantProvider({ children }: { children: ReactNode }) {
  const [design, setDesign] = useState<DesignVariant>(readStoredDesign);

  useEffect(() => {
    try {
      window.localStorage.setItem(STORAGE_KEY, design);
    } catch {
      // Persistence is best-effort; ignore storage failures.
    }
  }, [design]);

  const value = useMemo<DesignVariantState>(
    () => ({ design, setDesign }),
    [design],
  );

  return (
    <DesignVariantContext.Provider value={value}>
      {children}
    </DesignVariantContext.Provider>
  );
}

export function useDesignVariant(): DesignVariantState {
  const state = useContext(DesignVariantContext);
  if (!state) {
    throw new Error(
      "useDesignVariant must be used within a DesignVariantProvider",
    );
  }
  return state;
}
