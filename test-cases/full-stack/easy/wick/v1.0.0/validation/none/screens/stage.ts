// screens/stage — what the Screens checks share: what a frame is showing, where
// it drew each piece of copy, the overlays reached the real way, and the two
// ends of a run.
//
// WHAT "THE FRAME SHOWS" MEANS HERE. `specs/overview.md` ("Hard requirements"):
// "Render real graphics on the canvas: the world scrolling under the camera, a
// sprite for every actor and effect, and the HUD, drawn as sprites, shapes, and
// text", and ("Units, ticks, the world, and the camera") "The HUD, the menus,
// and the overlays are laid out in logical stage units". So a screen's copy is
// text the frame DRAW, read off the frame's own operations in logical stage
// units, and the text the document carries is read beside it so that a build
// that lays part of a screen over the page as elements is read the way it
// shows. `specs/ui.md` ("Presentation") fixes "no palette, no font, no layout,
// and no styling", so a piece of copy is looked for folded — lower-cased, with
// every space, dash, and underscore removed — and across consecutive runs, so a
// build that letter-spaces a heading, draws a menu item word by word, or wraps
// a highlighted item in marks of its own is read as showing it.
//
// WHERE A PIECE OF COPY WAS DRAWN. A check about an ORDER, about which row an
// icon or a tag belongs to, or about a highlight moving needs the place a run
// of text landed, which {@link rowY} answers in stage units: the smallest `y`
// among the consecutive runs that spell the text. `ROW_BAND` is what "on the
// same row" allows, and it is the case's figure rather than the
// specification's, which fixes no layout at all.
//
// EVERY OVERLAY IS REACHED THE REAL WAY. The level-up overlay is opened by a
// tick that ends with a level-up queued and the chest overlay by the tick that
// collects a chest, as `specs/progression.md` states, so no check here poses
// `screen` `levelup` or `chest`. The two endings are reached by the tick that
// ends the run, as `specs/world.md` states.

import { assertEqual, fail } from "../assert";
import {
  ICON_SIZE,
  LAMP_OIL_ID,
  LEVEL_LABEL,
  LAMP_OIL_NAME,
  MAX_POSED_TICK,
  MAX_WEAPON_LEVEL,
  PASSIVES,
  evolutionOf,
  PASSIVE_IDS,
  PASSIVE_SLOTS,
  STAGE_H,
  STAGE_W,
  WEAPON_NAMES,
  WEAPON_SLOTS,
  isPassiveId,
  type BaseWeaponId,
  type OfferId,
  type PassiveId,
} from "../constants";
import {
  folded,
  holdPassive,
  holdWeapon,
  imageDraws,
  isolate,
  openChest,
  openLevelUp,
  textDraws,
  type DrawCall,
  type Harness,
  type ImageDraw,
  type PixelRect,
  type TextDraw,
  type WickSnapshot,
} from "../harness";

/* -------------------------------------------------------------------------- */
/* A frame's delta                                                            */
/* -------------------------------------------------------------------------- */

/**
 * A frame's delta time short enough that no whole tick is consumed by it.
 *
 * `specs/instrumentation.md` ("A deterministic core"): "A tick is consumed
 * while the accumulator is at least `TICK_DT − TICK_EPSILON`", and `advance`
 * "Runs one frame of the build's loop worth `seconds` of delta time ... exactly
 * as a wall-clock frame of that length". A thousandth of a second is far below
 * a sixtieth, so a frame of it reads the keys, runs the screen's update, and
 * ticks nothing.
 *
 * What that is FOR: `specs/controls.md` has a frame's press edges read against
 * the screen the frame began on and then "The frame's update ... runs on the
 * screen the edges left: a frame whose press enters `playing` ... runs that
 * frame's ticks". A check about the state a press ARRIVES at, rather than about
 * the tick that follows it, therefore presses across a frame this short.
 */
export const SUB_TICK = 0.001;

/* -------------------------------------------------------------------------- */
/* What a frame is showing                                                    */
/* -------------------------------------------------------------------------- */

/** One frame's picture, as a check about a screen's copy reads it. */
export interface Shown {
  /** Every operation the frame's render issued. */
  calls: DrawCall[];
  /** Every run of text it drew, with the anchor each landed at. */
  draws: TextDraw[];
  /** The document's own text, for a build that lays part of a screen over the page. */
  dom: string;
}

/** Run one frame and read what it is showing. */
export async function shown(h: Harness): Promise<Shown> {
  const calls = await h.frameCalls();
  const dom = await h.page.evaluate(() => document.body.innerText ?? "");
  return { calls, draws: textDraws(calls), dom };
}

/** Every run of text on show, drawn runs in draw order then the document's lines. */
function runsOf(page: Shown): string[] {
  return [
    ...page.draws.map((draw) => draw.text),
    ...page.dom.split("\n").filter((line) => line.trim() !== ""),
  ];
}

/**
 * Whether the frame shows `text`: some run holds it, or consecutive runs spell
 * it, folded for case, spacing, dashes, and underscores.
 */
export function shows(page: Shown, text: string): boolean {
  const wanted = folded(text);
  if (wanted === "") return true;
  return folded(runsOf(page).join("")).includes(wanted);
}

/** The frame shows `text`, or the point fails, naming what was on show. */
export function assertShows(page: Shown, text: string, what: string): void {
  if (shows(page, text)) return;
  fail(`${what}: the frame showing ${JSON.stringify(text)}`, runsOf(page));
}

/** The frame does NOT show `text`, or the point fails. */
export function assertHides(page: Shown, text: string, what: string): void {
  if (!shows(page, text)) return;
  fail(`${what}: the frame not showing ${JSON.stringify(text)}`, runsOf(page));
}

/**
 * Whether the frame names `token` as a word: a single letter or a whole number
 * that is not part of a longer one.
 *
 * A folded search cannot decide a key named `P` or a kill count of `6`, because
 * either is a substring of nearly any text. So the raw text is searched for the
 * token standing alone, with a letter bounded by non-letters and a number by
 * non-digits.
 */
export function names(page: Shown, token: string): boolean {
  const text = runsOf(page).join("\n");
  const bound = /^[0-9]+$/.test(token) ? "0-9" : "A-Za-z";
  const pattern = new RegExp(
    `(^|[^${bound}])${token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}([^${bound}]|$)`,
    "i",
  );
  return pattern.test(text);
}

/** The frame names `token` as a word, or the point fails. */
export function assertNames(page: Shown, token: string, what: string): void {
  if (names(page, token)) return;
  fail(`${what}: the frame naming ${JSON.stringify(token)}`, runsOf(page));
}

/* -------------------------------------------------------------------------- */
/* Where a piece of copy was drawn                                            */
/* -------------------------------------------------------------------------- */

/**
 * How far from an entry's name another part of the same entry may be drawn, in
 * stage units.
 *
 * The case's figure: `specs/ui.md` fixes "no layout", so an icon and a tag are
 * told to belong to an entry's name by standing near it rather than at a place
 * the specification named. A seventh of the stage's height is wide enough for
 * an icon set above its name and narrow enough to exclude the HUD, which stands
 * at the stage's edges.
 */
export const ROW_BAND = 110;

/** How many consecutive runs may be joined to spell one piece of copy. */
const MAX_RUN_SPAN = 12;

/**
 * The `y` at which the frame drew `text`, in stage units, or `null`.
 *
 * The smallest anchor `y` among the consecutive runs that spell it, so a
 * heading drawn as one run, as one run over a shadow, or word by word all
 * answer the row they landed on. The DOM is not searched: a position is what
 * this answers, and an element's is not a drawn anchor.
 */
export function rowY(page: Shown, text: string): number | null {
  const wanted = folded(text);
  if (wanted === "") return null;
  const draws = page.draws;
  // The SHORTEST run of consecutive draws that spells it, so a heading drawn
  // above a menu is not read as the first word of the item below it.
  for (let span = 0; span < MAX_RUN_SPAN; span += 1) {
    for (let i = 0; i + span < draws.length; i += 1) {
      let joined = "";
      let top = Number.POSITIVE_INFINITY;
      for (let j = i; j <= i + span; j += 1) {
        joined += folded(draws[j]!.text);
        top = Math.min(top, draws[j]!.y);
      }
      if (joined.includes(wanted)) return top;
    }
  }
  return null;
}

/** The row `text` was drawn on, or the point fails. */
export function mustRowY(page: Shown, text: string, what: string): number {
  const y = rowY(page, text);
  if (y === null) {
    fail(
      `${what}: ${JSON.stringify(text)} drawn on the frame`,
      page.draws.map((draw) => draw.text),
    );
  }
  return y;
}

/**
 * Every row on which the frame drew a run of text holding `text`, in draw
 * order.
 *
 * What a check about a per-entry part reads: a list shows the same tag beside
 * several entries, so the question is not where the frame drew it but whether
 * each entry has one.
 */
export function rowsShowing(page: Shown, text: string): number[] {
  const wanted = folded(text);
  return page.draws
    .filter((draw) => folded(draw.text).includes(wanted))
    .map((draw) => draw.y);
}

/** Some row of `rows` sits within {@link ROW_BAND} of `y`, or the point fails. */
export function assertOnRow(
  rows: readonly number[],
  y: number,
  what: string,
): void {
  if (rows.some((row) => Math.abs(row - y) <= ROW_BAND)) return;
  fail(`${what}: drawn within ${ROW_BAND} units of the row at y ${y}`, rows);
}

/** `first` was drawn above `second`, or the point fails. */
export function assertStacked(
  page: Shown,
  first: string,
  second: string,
  what: string,
): void {
  const top = mustRowY(page, first, what);
  const below = mustRowY(page, second, what);
  if (top < below) return;
  fail(
    `${what}: ${JSON.stringify(first)} drawn above ${JSON.stringify(second)}`,
    `${JSON.stringify(first)} at y ${top}, ${JSON.stringify(second)} at y ${below}`,
  );
}

/* -------------------------------------------------------------------------- */
/* Icons                                                                      */
/* -------------------------------------------------------------------------- */

/**
 * The source rectangle an image draw took: the rectangle the call named, or the
 * whole of the image when it named none.
 *
 * An icon is `ICON_SIZE` (`24 x 24`) on the canvas it was PRODUCED on
 * (`specs/assets.md`), and `specs/assets.md` has a produced file "scaled in code
 * to the live shape", so the size it lands at on the stage says nothing. What
 * says it is the source: a build that draws each icon file draws the whole of a
 * `24 x 24` image, and a build that packs its icons into one sheet takes a
 * `24 x 24` rectangle out of it.
 */
function sourceSize(draw: ImageDraw): { width: number; height: number } {
  return {
    width: draw.sw ?? draw.image.width,
    height: draw.sh ?? draw.image.height,
  };
}

/** How far a source rectangle may miss `ICON_SIZE` on either side, in pixels. */
const ICON_TOL = 1;

/** Every image the frame drew from an icon-sized source, in draw order. */
export function iconDraws(calls: readonly DrawCall[]): ImageDraw[] {
  return imageDraws(calls).filter((draw) => {
    const size = sourceSize(draw);
    return (
      Math.abs(size.width - ICON_SIZE.width) <= ICON_TOL &&
      Math.abs(size.height - ICON_SIZE.height) <= ICON_TOL
    );
  });
}

/** What tells one icon from another: the image it came from and the corner of it. */
function iconKey(draw: ImageDraw): string {
  return `${draw.image.id}:${draw.sx ?? 0}:${draw.sy ?? 0}`;
}

/**
 * The icon drawn for the entry whose name sits on `y`: the icon-sized draw
 * nearest that row, within {@link ROW_BAND} of it and nearer to it than to any
 * of `others`.
 */
export function iconOnRow(
  icons: readonly ImageDraw[],
  y: number,
  others: readonly number[] = [],
): ImageDraw | undefined {
  let best: ImageDraw | undefined;
  let gap = ROW_BAND;
  for (const icon of icons) {
    const own = Math.abs(icon.cy - y);
    if (own > gap) continue;
    if (others.some((row) => Math.abs(icon.cy - row) < own)) continue;
    best = icon;
    gap = own;
  }
  return best;
}

/** Each of `icons` came from a different source, or the point fails. */
export function assertDistinctIcons(
  icons: readonly ImageDraw[],
  what: string,
): void {
  const keys = icons.map(iconKey);
  assertEqual(new Set(keys).size, keys.length, `${what}: distinct icons drawn`);
}

/* -------------------------------------------------------------------------- */
/* A menu's rows                                                              */
/* -------------------------------------------------------------------------- */

/** How tall a band read around a menu row may be, in stage units. */
const MAX_BAND = 48;

/**
 * A band of the stage around the row at `y`, tall enough to hold a highlight
 * and short enough not to reach the neighbouring row.
 */
export function bandOf(y: number, gap: number): { y: number; height: number } {
  const height = Math.max(8, Math.min(MAX_BAND, Math.abs(gap) - 4));
  const top = Math.max(0, Math.min(STAGE_H - height, y - height / 2));
  return { y: top, height };
}

/** The pixels of the full-width band around the row at `y`. */
export function bandPixels(
  h: Harness,
  y: number,
  gap: number,
): Promise<PixelRect> {
  const band = bandOf(y, gap);
  return h.pixelRect(0, band.y, STAGE_W, band.height);
}

/* -------------------------------------------------------------------------- */
/* Offers                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * An offer's display name: "the weapon's name from `WEAPON_NAMES`, the
 * passive's from `PASSIVES`, or `LAMP_OIL_NAME` (`Lamp Oil`)" (`specs/ui.md`).
 */
export function offerName(id: OfferId): string {
  if (id === LAMP_OIL_ID) return LAMP_OIL_NAME;
  if (isPassiveId(id)) return PASSIVES[id].name;
  return WEAPON_NAMES[id];
}

/**
 * An offer's tag for an item not held: "`OFFER_NEW_TEXT` (`NEW`) for an item not
 * yet held, else `LEVEL_LABEL` and the level it would become, as `LEVEL 3`"
 * (`specs/ui.md`).
 */
export function levelTag(level: number): string {
  return `${LEVEL_LABEL} ${level}`;
}

/**
 * Open a level-up overlay presenting exactly `ids`, over an isolated night.
 *
 * `setNextOffers` "is checked against the candidate pool at the moment the next
 * level-up overlay opens: it is accepted when every id is a candidate of the
 * pool at that moment ... and the overlay then presents exactly that list in
 * that order" (`specs/instrumentation.md`), and the overlay is opened by a tick
 * that ends with a level-up queued (`specs/progression.md`). The night is
 * isolated first, so the pool is drawn from the slots the check posed and
 * nothing else moves while the overlay stands.
 *
 * The overlay presenting the queued list is the PRECONDITION of a check about
 * what the overlay shows or how its highlight moves: a build that presented
 * something else fails the progression points that decide the draw, and this
 * fails here rather than reading a list the check did not pose.
 */
export async function openOffers(
  h: Harness,
  ids: readonly OfferId[],
  count = 1,
): Promise<WickSnapshot> {
  await h.debug.setNextOffers(ids);
  const opened = await openLevelUp(h, count);
  assertEqual(
    opened.screen,
    "levelup",
    "the screen the queued level-up opened",
  );
  assertEqual(
    (opened.run.offers ?? []).join(","),
    ids.join(","),
    "the offers the overlay presents",
  );
  assertEqual(opened.menuIndex, 0, "menuIndex on opening the overlay");
  return opened;
}

/** The six base weapons held at `MAX_WEAPON_LEVEL` to fill every weapon slot. */
const FULL_WEAPONS: readonly BaseWeaponId[] = [
  "taper",
  "ember",
  "pin",
  "lantern",
  "halo",
  "oil-splash",
];

/** The six passives held at their max levels to fill every passive slot. */
const FULL_PASSIVES: readonly PassiveId[] = PASSIVE_IDS.slice(
  0,
  PASSIVE_SLOTS,
) as readonly PassiveId[];

/**
 * Open the overlay an EMPTY pool leaves: "When the pool is empty the overlay
 * offers exactly one item, `LAMP_OIL_ID`" (`specs/progression.md`).
 *
 * Every weapon slot holds a base weapon at `MAX_WEAPON_LEVEL` and every passive
 * slot a passive at its own max, so the pool holds no held item below its max
 * and no free slot to offer a new one.
 */
export async function openLampOil(h: Harness): Promise<WickSnapshot> {
  for (const [slot, id] of FULL_WEAPONS.entries()) {
    await holdWeapon(h, id, MAX_WEAPON_LEVEL, slot);
  }
  for (const [slot, id] of FULL_PASSIVES.entries()) {
    await holdPassive(h, id, PASSIVES[id].maxLevel, slot);
  }
  const held = await h.snapshot();
  assertEqual(
    (held.run.weapons ?? []).length,
    WEAPON_SLOTS,
    "weapon slots held",
  );
  assertEqual(
    (held.run.passives ?? []).length,
    PASSIVE_SLOTS,
    "passive slots held",
  );
  const opened = await openLevelUp(h, 1);
  assertEqual(
    opened.screen,
    "levelup",
    "the screen the queued level-up opened",
  );
  assertEqual(
    (opened.run.offers ?? []).join(","),
    LAMP_OIL_ID,
    "the offers an empty pool presents",
  );
  return opened;
}

/* -------------------------------------------------------------------------- */
/* The chest overlay                                                          */
/* -------------------------------------------------------------------------- */
//
// EVERY CHEST IS OPENED THE REAL WAY. `specs/instrumentation.md` (`setScreen`):
// "The chest overlay is reached through `spawnPickup("chest", x, y)` at the
// lamplighter's center and one tick, which is the real collection path", which
// is what the harness's `openChest` does. No check here poses `screen` `chest`
// and none poses a result: which of the three results a chest gives is decided
// by the loadout it finds, under the rules of `specs/evolutions.md` ("Opening a
// chest"), so each of the three is reached by holding what that rule needs.

/** What a chest reported, with the `null` of an unopened chest ruled out. */
export type ChestOutcome = NonNullable<WickSnapshot["run"]["chestResult"]>;

/** The result the open overlay reports, or the point fails. */
export function chestResultOf(
  snapshot: WickSnapshot,
  what: string,
): ChestOutcome {
  const result = snapshot.run.chestResult;
  if (result === null || result === undefined) {
    fail(`a chest result after ${what}`, result);
  }
  return result;
}

/**
 * Open a chest that HEALS: "`hp` rises by `CHEST_HEAL` (`30`), capped at
 * `maxHp`. The result is `{ kind: "heal" }`" (`specs/evolutions.md`, rule 3).
 *
 * Over an empty loadout, rule 1 finds no weapon at `MAX_WEAPON_LEVEL` to
 * evolve and rule 2 finds no held item below its max to raise, so the chest
 * falls through to the heal.
 */
export async function openHealChest(h: Harness): Promise<WickSnapshot> {
  const opened = await openChest(h);
  assertEqual(opened.screen, "chest", "the screen the collected chest opened");
  assertEqual(
    chestResultOf(opened, "a chest opened over an empty loadout").kind,
    "heal",
    "the result of a chest with nothing to evolve and nothing to level",
  );
  return opened;
}

/** Taper's level for the chest that LEVELS: below `MAX_WEAPON_LEVEL`. */
export const CHEST_TAPER_LEVEL = 3;

/** Brass's level for the chest that LEVELS: below its own max of 3. */
export const CHEST_BRASS_LEVEL = 1;

/**
 * Open a chest that LEVELS one held item: "One held item below its max level ...
 * is chosen uniformly at random ... and rises by `1`. The result is
 * `{ kind: "level", item, level }`, with `level` the level it became"
 * (`specs/evolutions.md`, rule 2).
 *
 * Taper stands below `MAX_WEAPON_LEVEL`, so rule 1 has nothing to evolve, and
 * both held items stand below their maxes, so rule 2 has one to raise.
 */
export async function openLevelChest(h: Harness): Promise<WickSnapshot> {
  await holdWeapon(h, "taper", CHEST_TAPER_LEVEL, 0);
  await holdPassive(h, "brass", CHEST_BRASS_LEVEL, 0);
  const opened = await openChest(h);
  assertEqual(opened.screen, "chest", "the screen the collected chest opened");
  assertEqual(
    chestResultOf(opened, "a chest opened over Taper 3 and Brass 1").kind,
    "level",
    "the result of a chest with an item below its max and nothing to evolve",
  );
  return opened;
}

/** The weapon a chest evolves Taper into: `EVOLUTIONS`' Taper row. */
export const TAPER_EVOLUTION = evolutionOf("taper");

/**
 * Open a chest that EVOLVES: "the first base weapon at `MAX_WEAPON_LEVEL` whose
 * recipe passive is held at any level evolves ... The result is
 * `{ kind: "evolve", weapon }`" (`specs/evolutions.md`, rule 1).
 *
 * Taper at `MAX_WEAPON_LEVEL` with Wick held is that recipe, "Pyre | `pyre` |
 * Taper | Wick".
 */
export async function openEvolveChest(h: Harness): Promise<WickSnapshot> {
  await holdWeapon(h, "taper", MAX_WEAPON_LEVEL, 0);
  await holdPassive(h, "wick", 1, 0);
  const opened = await openChest(h);
  assertEqual(opened.screen, "chest", "the screen the collected chest opened");
  const result = chestResultOf(
    opened,
    "a chest opened over Taper at its top level with Wick held",
  );
  assertEqual(
    result.kind,
    "evolve",
    "the result of a chest paying a recipe off",
  );
  return opened;
}

/**
 * Close the open overlay the way `confirm` does, to pose the next scenario:
 * "`playing` | `chest` | Closes the overlay exactly as `confirm` does:
 * `chestResult` becomes `null`" (`specs/instrumentation.md`, `setScreen`). What
 * `confirm` itself does is `chest-confirm-closes`.
 */
export async function closeChest(h: Harness): Promise<WickSnapshot> {
  await h.debug.setScreen("playing");
  const playing = await h.snapshot();
  assertEqual(playing.screen, "playing", "the screen the closed overlay left");
  return playing;
}

/* -------------------------------------------------------------------------- */
/* The two ends of a run                                                      */
/* -------------------------------------------------------------------------- */

/**
 * End the isolated run fallen on the next tick, and read the end screen.
 *
 * `specs/world.md` ("Fallen and dawn"): a run ends "at the end of a tick, after
 * every other phase of that tick has been applied", fallen when "`hp` is `0` or
 * below", which `setHp` reaches directly: "A value at or below `0` ends the run
 * fallen at the end of the next `playing` tick" (`specs/instrumentation.md`).
 */
export async function endFallen(h: Harness): Promise<WickSnapshot> {
  await h.debug.setHp(0);
  const ended = await h.step(1);
  assertEqual(ended.screen, "fallen", "the screen a run out of health ends on");
  assertEqual(ended.menuIndex, 0, "menuIndex on arriving at fallen");
  return ended;
}

/**
 * End the isolated run at dawn on the next tick, and read the end screen.
 *
 * `specs/world.md` ("Fallen and dawn"): the run ends at dawn when "`tick` equals
 * `DAWN_TIME x TICK_HZ` (`36000`)", so the clock is posed to `MAX_POSED_TICK`
 * (`35999`), the greatest `setTick` accepts, and one tick reaches it.
 */
export async function endDawn(h: Harness): Promise<WickSnapshot> {
  await h.debug.setTick(MAX_POSED_TICK);
  const ended = await h.step(1);
  assertEqual(ended.screen, "dawn", "the screen the tick at dawn ends on");
  assertEqual(ended.menuIndex, 0, "menuIndex on arriving at dawn");
  return ended;
}

/** An isolated night standing on `playing` with nothing alive and nothing held. */
export async function night(h: Harness): Promise<WickSnapshot> {
  const posed = await isolate(h);
  assertEqual(
    posed.screen,
    "playing",
    "the screen an isolated night stands on",
  );
  return posed;
}

/**
 * The menu on `screen` reads `index` after `pressed`, or the point fails.
 *
 * The one reading every navigation point here makes: the screen is unchanged
 * and the highlight stands where the press left it.
 */
export function assertHighlight(
  after: WickSnapshot,
  screen: WickSnapshot["screen"],
  index: number,
  what: string,
): void {
  assertEqual(after.screen, screen, `the screen ${what}`);
  assertEqual(after.menuIndex, index, `menuIndex ${what}`);
}

/** Every run of text on show, for a failure that has to say what was there. */
export function textOn(page: Shown): string[] {
  return runsOf(page);
}

/** Whether `page` shows a run of text that `others` do not, drawn below `heading`. */
export function ownTextBelow(
  page: Shown,
  heading: number,
  others: readonly Shown[],
): string[] {
  const elsewhere = new Set(
    others.flatMap((other) => runsOf(other).map((run) => folded(run))),
  );
  const own: string[] = [];
  for (const draw of page.draws) {
    const text = folded(draw.text);
    if (text === "" || elsewhere.has(text)) continue;
    if (draw.y <= heading) continue;
    own.push(draw.text);
  }
  return own;
}
