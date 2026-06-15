import { useCallback, useEffect, useState, type ReactNode } from "react";
import { DesignVariantContext } from "./designVariantContext";
import {
  DEFAULT_DESIGN_VARIANT,
  isDesignVariant,
  type DesignVariantId,
} from "./variants";

// Where the chosen variant is persisted so it survives reloads while the user
// is exploring directions.
const STORAGE_KEY = "ttc.designVariant";

function readInitialVariant(): DesignVariantId {
  if (typeof localStorage === "undefined") {
    return DEFAULT_DESIGN_VARIANT;
  }
  const stored = localStorage.getItem(STORAGE_KEY);
  return stored && isDesignVariant(stored) ? stored : DEFAULT_DESIGN_VARIANT;
}

interface DesignVariantProviderProps {
  children: ReactNode;
}

// Owns the active design variant: persists it, and reflects it onto the
// `data-variant` attribute on <html> so the CSS palette in `variants.scss`
// applies to the whole document.
export function DesignVariantProvider({
  children,
}: DesignVariantProviderProps) {
  const [variant, setVariantState] = useState<DesignVariantId>(
    readInitialVariant,
  );

  useEffect(() => {
    document.documentElement.dataset.variant = variant;
  }, [variant]);

  const setVariant = useCallback((next: DesignVariantId) => {
    setVariantState(next);
    try {
      localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // Persistence is best-effort; ignore storage failures (e.g. private mode).
    }
  }, []);

  return (
    <DesignVariantContext.Provider value={{ variant, setVariant }}>
      {children}
    </DesignVariantContext.Provider>
  );
}
