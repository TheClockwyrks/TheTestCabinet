import { createContext } from "react";
import type { DesignVariantId } from "./variants";

// The shared design-variant state. Kept in its own module (no component export)
// so the provider and the `useDesignVariant` hook can import it without
// tripping React Fast Refresh.
export interface DesignVariantContextValue {
  variant: DesignVariantId;
  setVariant: (variant: DesignVariantId) => void;
}

export const DesignVariantContext =
  createContext<DesignVariantContextValue | null>(null);
