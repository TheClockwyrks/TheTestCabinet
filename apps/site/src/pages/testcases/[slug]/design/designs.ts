import type { DesignVariant } from "./types";

// The catalog of design directions, in switcher order. Metadata only (label and
// one-line intent) so it can be imported anywhere without pulling in the shell
// or specs components. The switcher renders this list; the layout and specs page
// map the active id to actual components.
export interface DesignOption {
  id: DesignVariant;
  /** Short label shown in the switcher. */
  label: string;
  /** One-line description of what the direction does. */
  tagline: string;
}

export const DESIGN_OPTIONS: readonly DesignOption[] = [
  {
    id: "refined",
    label: "Refined",
    tagline: "Today's layout, lightly polished — the small-tweaks path.",
  },
  {
    id: "document",
    label: "Document",
    tagline: "Same chrome; Specifications become one scrolling doc + outline.",
  },
  {
    id: "rail",
    label: "Console",
    tagline: "Full rework: a vertical console rail replaces the tab strip.",
  },
  {
    id: "deck",
    label: "Deck",
    tagline: "Cartridge framing with an editor-style file deck for specs.",
  },
] as const;
