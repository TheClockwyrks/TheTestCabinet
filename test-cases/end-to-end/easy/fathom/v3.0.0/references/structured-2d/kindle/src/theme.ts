// Fathom — this build's own look.
//
// The specification fixes no palette, no font and no screen composition
// (`specs/overview.md`, Visual design), so everything aesthetic lives here
// apart from the figures `src/constants.ts` names. The trench is a near-black
// blue; the light in it is cold cyan; the two amber lights of the maze share
// one warm, red-leaning hue that no other element uses, so a glimmer in the
// dark reads as amber and nothing else does.

/** The layer each render component draws on, low to high. */
export const LAYER = {
  /** The trench: tiles, the fog, the light pocket, plankton and ink. */
  trench: 0,
  /** The wavefronts, the flare blooms and the detection alerts. */
  effects: 10,
  /** The bodies: the predators, the drifters and the forager. */
  creatures: 20,
  /** The amber lights, over the bodies so they read at any distance. */
  amber: 30,
  /** The HUD strips above and below the maze. */
  hud: 40,
  /** The screen a value of `screen` names: menus, overlays and panels. */
  screens: 50,
} as const;

export const COLOR = {
  /** The water, the letterbox bars, and an unrevealed tile. */
  abyss: "#03060c",
  /** A revealed corridor floor. */
  water: "#0a1422",
  /** A revealed rock face. */
  rock: "#16293d",
  /** The rim light along a rock face that meets a corridor. */
  rim: "#24506b",
  /** The den gate's barred threshold. */
  gate: "#3c6f8c",
  /** The forager, and the cold light it carries. */
  forager: "#46f0e0",
  /** A plankton mote. */
  plankton: "#b8f5c8",
  /** The forager's sonar pulse. */
  sonarCyan: "94, 242, 255",
  /** An ordinary Gloamfin ping. */
  sonarViolet: "196, 107, 255",
  /** The Gloamfin's guaranteed lost-you ping. */
  sonarOrange: "255, 150, 60",
  /** The maze's two amber lights: the drifter and the Lanternjaw's bulb. */
  amber: "255, 209, 102",
  amberCore: "#fff3cf",
  /** The Gloamfin's own color, which its detection alert flashes in. */
  gloamfin: "#c46bff",
  /** The Flarefish's own color, which its detection alert flashes in. */
  flarefish: "#ff7a59",
  /** An ink cloud. */
  ink: "11, 10, 31",
  text: "#e6edf3",
  textDim: "#8a94a6",
  textFaint: "#4a5567",
  panel: "#0a1018",
  panelBorder: "#16293d",
} as const;

/**
 * A system monospace stack, so every screen renders the same with no network
 * (`specs/overview.md`).
 */
export const MONO =
  '"DejaVu Sans Mono", "SFMono-Regular", "SF Mono", Menlo, Consolas, "Liberation Mono", monospace';

/** A canvas font string at a size and weight, in this build's one face. */
export function font(size: number, weight = 400): string {
  return `${weight} ${size}px ${MONO}`;
}

/** An `rgba()` color from one of the `r, g, b` triples above. */
export function rgba(triple: string, alpha: number): string {
  return `rgba(${triple}, ${Math.max(0, Math.min(1, alpha))})`;
}
