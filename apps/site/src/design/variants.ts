// The design variants the on-screen switcher cycles through. Each one is a full
// re-theme of the gallery (palette in `styles/variants.scss`, layout in
// `pages/gallery/variants/`). This module is the single source of truth for the
// variant ids and their switcher labels.

export type DesignVariantId =
  | "cabinet"
  | "crt"
  | "neon"
  | "minimal"
  | "neonlog";

export interface DesignVariantMeta {
  id: DesignVariantId;
  /** Display name shown in the switcher. */
  name: string;
  /** One-line description of the direction. */
  blurb: string;
}

// Order here is the order shown in the switcher and the 1..4 hotkey mapping.
export const DESIGN_VARIANTS: readonly DesignVariantMeta[] = [
  {
    id: "cabinet",
    name: "Cabinet Hall",
    blurb: "Skeuomorphic upright cabinets",
  },
  { id: "crt", name: "CRT Terminal", blurb: "Amber phosphor run log" },
  { id: "neon", name: "Neon Grid", blurb: "Synthwave grid & glow" },
  { id: "minimal", name: "Minimal", blurb: "Quiet modern gallery" },
  { id: "neonlog", name: "Neon Log", blurb: "Terminal log on a neon grid" },
];

export const DEFAULT_DESIGN_VARIANT: DesignVariantId = "cabinet";

export function isDesignVariant(value: string): value is DesignVariantId {
  return DESIGN_VARIANTS.some((variant) => variant.id === value);
}
