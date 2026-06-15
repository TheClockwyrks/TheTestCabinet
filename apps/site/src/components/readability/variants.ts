// The catalog of readability treatments for prose that sits directly over the
// animated backdrop. Each entry is one approach to keeping body text legible
// against the neon grid; the switcher lets a visitor compare them and the
// choice persists (see `ReadabilityContext`). Keep this list and the SCSS in
// `ReadableSurface.module.scss` (one rule per `data-variant`) in lockstep.

export type ReadabilityVariant =
  | "scrim"
  | "panel"
  | "frost"
  | "halo"
  | "none";

export interface ReadabilityOption {
  /** The variant id, mirrored as `data-variant` on the surface. */
  id: ReadabilityVariant;
  /** Short label for the switcher. */
  label: string;
  /** One-line description of the treatment, shown in the switcher. */
  hint: string;
}

// The treatment shown before a visitor picks one. The translucent scrim is the
// gentlest fix — opaque behind the text, feathering away past it — so it leads.
export const DEFAULT_READABILITY: ReadabilityVariant = "scrim";

export const READABILITY_OPTIONS: ReadonlyArray<ReadabilityOption> = [
  {
    id: "scrim",
    label: "Scrim",
    hint: "Opaque behind the text, fading to clear past it",
  },
  {
    id: "panel",
    label: "Panel",
    hint: "Solid neon-bordered card, matching the rest of the site",
  },
  {
    id: "frost",
    label: "Frosted",
    hint: "Blurs the backdrop behind the text",
  },
  {
    id: "halo",
    label: "Halo",
    hint: "No box; a dark glow around each glyph",
  },
  {
    id: "none",
    label: "None",
    hint: "Raw text on the backdrop, for comparison",
  },
];

// Narrows an arbitrary string (e.g. from storage) to a known variant.
export function isReadabilityVariant(
  value: string | null,
): value is ReadabilityVariant {
  return READABILITY_OPTIONS.some((option) => option.id === value);
}
