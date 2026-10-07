// Kessler — the palette, the type, and the layer table, in one place.
//
// The specification fixes no palette and no font (`specs/screens.md`); it
// fixes what a player reads at a glance, and the look that answers it is this
// build's. The mood `specs/assets.md` asks for is cold orbital demolition —
// hard vacuum, glass, and sunlight on dead metal, with the planet the one
// warm thing in view — so everything here is cold: near-black space, steel
// and glass blues, one accent hue per ring, and text like instrument glass.
// The warmth stays inside the produced planet sprite and the burn-up effect.

export const COLORS = {
  /** The stage's ground, and the letterbox bars around it. */
  stage: "#05070d",
  /** The containment field's glassy edge. */
  containment: "#58e6ff",
  /** The deflector: bright glass, the player's own light. */
  paddle: "#eaf6ff",
  paddleGlow: "#58e6ff",
  /** The shield ring while one is active. */
  shield: "#64f0a8",
  /** Dead-metal target plating, lit and in shadow. */
  plate: "#28354a",
  plateDark: "#182233",
  /** The per-ring accent, ring 1 (innermost) first. */
  ringAccents: ["#57d8c8", "#6fa8ff", "#a98cf0"] as const,
  /** The fallback tint per pod kind, where a sprite failed to load. */
  pods: {
    widen: "#7fe3ff",
    narrow: "#ff9a62",
    multiball: "#ffd464",
    shield: "#64f0a8",
    pierce: "#c09aff",
  } as const,
  /** Text, brightest to faintest. */
  text: "#e8f1fa",
  textDim: "#8b9bb0",
  textFaint: "#4c5a70",
  /** The menu highlight. */
  highlight: "#58e6ff",
  /** Panels and dimming laid over the field. */
  panel: "rgba(8, 11, 18, 0.88)",
  panelEdge: "rgba(70, 92, 122, 0.55)",
  dim: "rgba(5, 7, 13, 0.72)",
} as const;

/** One monospace stack, so nothing is downloaded and the HUD never reflows. */
export const FONT =
  'ui-monospace, "DejaVu Sans Mono", "SFMono-Regular", Consolas, "Courier New", monospace';

/**
 * The engine's render pipeline draws lower layers first, so this table is the
 * back-to-front order of the whole picture: the starfield and containment,
 * the three rings of targets, the planet with the shield ring over it, the
 * deflector, the falling pods, the balls, the particle effects, and the HUD
 * with the screen chrome on top. Numbered in one place, with gaps, exactly as
 * the engine's rendering documentation recommends.
 */
export const LAYERS = {
  field: 0,
  rings: 10,
  planet: 20,
  paddle: 30,
  pods: 40,
  balls: 50,
  fx: 60,
  hud: 70,
} as const;
