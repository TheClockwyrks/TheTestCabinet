/**
 * Shared helpers for the "download this preview as a GIF" affordances across the
 * voxel, skinned, and particle result sections: the panel background a bake
 * composites over, and a filesystem-friendly filename for a downloaded clip.
 */

/** The preview panel's background, resolved from the theme so a baked GIF's solid
 * backdrop matches the on-screen preview box (which uses the same var). Falls back to
 * the panel's default color during SSR or if the var is unset. */
export function panelBackground(): string {
  if (typeof document === "undefined") return "#1c1c1c";
  const value = getComputedStyle(document.documentElement)
    .getPropertyValue("--tc-panel-2")
    .trim();
  return value || "#1c1c1c";
}

/** A filesystem-friendly `<name>.gif` for a downloaded clip (an animation or effect
 * name, slugged; a blank name falls back to `animation`). */
export function gifFilename(name: string): string {
  const slug = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return `${slug || "animation"}.gif`;
}
