// Wick — screens: the arrangements and frame readings the checks in this
// category share. NOT a check: a module of poses and pure readings, so a
// check that needs an empty candidate pool, the anchor a screen drew a line of
// copy at, or a press that runs no tick names the thing it means rather than
// spelling it again.
//
// WHERE THE ARRANGEMENTS COME FROM. `specs/progression.md`, "Slots":
// `WEAPON_SLOTS` (`6`), `PASSIVE_SLOTS` (`6`), `MAX_WEAPON_LEVEL` (`8`), and a
// passive's own max level from `PASSIVES`. "The candidate pool" holds "every
// held base weapon below `MAX_WEAPON_LEVEL`, and every held passive below its
// max level", a new weapon only "when a weapon slot is free" and a new passive
// only "when a passive slot is free" — so every slot full with every item at
// its maximum leaves the pool empty, which is the arrangement that puts the
// lamp-oil offer on the overlay ("When the pool is empty the overlay offers
// exactly one item, `LAMP_OIL_ID`").
//
// WHY A PARTIAL FRAME EXISTS HERE. `specs/controls.md`: "The frame's update
// then runs on the screen the edges left: a frame whose press enters
// `playing` ... runs that frame's ticks". A check that must read the state a
// press LEFT, before any tick moves it, therefore presses on a frame shorter
// than one tick: `specs/instrumentation.md` says "a clock of any other length
// poses a partial frame", and a tick is consumed only while the accumulator
// holds at least `TICK_DT − TICK_EPSILON`.

import {
  MAX_WEAPON_LEVEL,
  PASSIVES,
  STAGE_H,
  STAGE_W,
  type BaseWeaponId,
  type PassiveId,
} from "../constants";
import {
  holdPassive,
  holdWeapon,
  type Harness,
  type PixelRect,
  type TextDraw,
  type WickSnapshot,
} from "../harness";

/** Six base weapons, one per weapon slot. */
export const EVERY_WEAPON_SLOT: readonly BaseWeaponId[] = [
  "taper",
  "ember",
  "spark",
  "shard",
  "sconce",
  "flare",
];

/**
 * Six passives, one per passive slot, none of them the recipe passive of a
 * weapon above: Taper needs Wick and Ember needs Oil (`specs/evolutions.md`),
 * and the other four have no evolution at all, so nothing here evolves when a
 * chest is opened over this loadout.
 */
export const EVERY_PASSIVE_SLOT: readonly PassiveId[] = [
  "glass",
  "brass",
  "mirror",
  "bellows",
  "tinder",
  "soot",
];

/**
 * Fill every weapon slot at `MAX_WEAPON_LEVEL` and every passive slot at that
 * passive's own max: the loadout whose candidate pool is empty, which is what
 * puts `LAMP_OIL_ID` on the next overlay.
 */
export function fillEverySlot(h: Harness): void {
  for (const id of EVERY_WEAPON_SLOT) holdWeapon(h, id, MAX_WEAPON_LEVEL);
  for (const id of EVERY_PASSIVE_SLOT) {
    holdPassive(h, id, PASSIVES[id].maxLevel);
  }
}

/** `text` lower-cased with every run of whitespace removed: how copy is compared here. */
export function folded(text: string): string {
  return text.replace(/\s+/g, "").toLowerCase();
}

/**
 * Every run of text the frame drew that carries `text`, ignoring case and
 * whitespace.
 *
 * Compared with the whitespace folded out of BOTH sides, the way the shared
 * harness's `drewText` compares: a build that letter-spaces its copy may skip
 * the space glyph and advance the pen, and one that colours a word may draw a
 * line's words as separate calls, so a run spelling `LIGHTTHELAMP` — or a run
 * the merge rule wrote a space into — is the copy `LIGHT THE LAMP` either way.
 * Fed {@link placedRuns} by every reader here, so a menu item drawn a glyph at
 * a time is one run holding its name.
 */
export function drawsCarrying(
  draws: readonly TextDraw[],
  text: string,
): TextDraw[] {
  const wanted = folded(text);
  return draws.filter((draw) => folded(draw.text).includes(wanted));
}

/**
 * The TOPMOST anchor a run of text carrying `text` was drawn at, in device
 * pixels, or `null` where the frame drew no such run. Topmost because a build
 * that draws a line twice, a shadow under a face, anchors the two a pixel or
 * two apart, and the pair is one line to a player.
 */
export function anchorY(
  draws: readonly TextDraw[],
  text: string,
): number | null {
  const found = drawsCarrying(draws, text);
  return found.length === 0 ? null : Math.min(...found.map((d) => d.y));
}

/** The LOWEST anchor a run of text carrying `text` was drawn at. */
export function lowestAnchorY(
  draws: readonly TextDraw[],
  text: string,
): number | null {
  const found = drawsCarrying(draws, text);
  return found.length === 0 ? null : Math.max(...found.map((d) => d.y));
}

/**
 * The distinct strings the frame drew below `y`, ignoring the ones carrying
 * `except` — compared folded, as {@link drawsCarrying} compares.
 */
export function textBelow(
  draws: readonly TextDraw[],
  y: number,
  except: string,
): string[] {
  const skip = folded(except);
  return [
    ...new Set(
      draws
        .filter((draw) => draw.y > y && !folded(draw.text).includes(skip))
        .map((draw) => draw.text),
    ),
  ].sort();
}

/** How far above a text anchor a band of pixels reaches, in device pixels. */
const BAND_ABOVE = 26;
/** How far below a text anchor a band of pixels reaches, in device pixels. */
const BAND_BELOW = 12;

/**
 * The full-width band of canvas around a text anchor: the pixels one menu
 * item occupies, whatever the build drew its highlight as — a marker beside
 * the words, a different colour, a plate behind them — since every one of
 * those lands in the item's own rows.
 */
export function bandAt(h: Harness, y: number): PixelRect {
  const top = Math.max(0, Math.min(STAGE_H - 1, Math.round(y) - BAND_ABOVE));
  const height = Math.max(1, Math.min(STAGE_H - top, BAND_ABOVE + BAND_BELOW));
  return h.pixelRect(0, top, STAGE_W, height);
}

/** How long a frame that must consume no tick is worth, in milliseconds. */
export const PARTIAL_MS = 1;

/**
 * Press a key, deliver its edge on a frame far shorter than one tick, and
 * release it: the press with nothing but the press in it. What a check uses
 * where the state the press LEFT is the thing being read and a tick would
 * move it on.
 */
export async function tapPartial(
  h: Harness,
  code: string,
): Promise<WickSnapshot> {
  h.holdKey(code);
  try {
    await h.frameOf(PARTIAL_MS);
  } finally {
    h.releaseKey(code);
  }
  return h.snapshot();
}
