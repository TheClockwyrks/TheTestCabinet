import { useContext } from "react";
import { DesignVariantContext } from "./designVariantContext";

// Read and update the active design variant. Must be used within a
// DesignVariantProvider.
export function useDesignVariant() {
  const context = useContext(DesignVariantContext);
  if (!context) {
    throw new Error(
      "useDesignVariant must be used within a DesignVariantProvider",
    );
  }
  return context;
}
