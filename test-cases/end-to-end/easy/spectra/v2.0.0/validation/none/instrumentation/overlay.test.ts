// Spectra — instrumentation/overlay: the read-only debug overlay reports the game,
// and watching it leaves the game exactly as it is.
//
// `specs/instrumentation.md`, Diagnostics, fixes what it shows: "the current
// `screen`, `phase`, and `stage`, and whether the stage is a challenge stage; the
// score, the lives, the resonance, and whether a discharge is ready; whether a
// spectral inversion is active and how long is left; the ship's `x`, its band, and
// its remaining fire lockout; for each drone, its id, its kind, its stored and
// effective bands, its position, its phase, a Flux's shimmer state, and a Prism's
// shell state; how many bullets are in flight, and how many bursts are playing."
// Under this engine the panel is the build's own: "The overlay is part of the
// runtime layer you write. It draws the registered sources, it is shown and hidden
// by the backtick key as `specs/controls.md` states, it is off when the game
// starts, and it reads the game without changing it."
//
// HOW THE LINES ARE READ. The overlay is drawn over the game, through the same
// context every other rendering check reads, so the text a steady frame draws
// WITHOUT the overlay is collected first and the text a frame draws WITH it
// second; the difference is the overlay's own lines.
//
// HOW A VALUE IS RECOGNISED. Every figure below is checked as a whole number the
// panel drew rather than as a substring, so a `9` on the panel is not answered by
// the `9` inside some other number, and the field is posed so that no two of the
// values asserted share a figure. A figure the panel grouped its digits in — a
// score drawn as `4,271` — reads as the one number it draws, since how a panel
// presents a figure is the build's; the ASCII space alone is not read as a
// grouping character, because it is what stands between two figures on a line.
// A comma between two runs of digits is ambiguous — `688,296` is one grouped
// figure or a position's two coordinates — and the specification fixes no form
// for a position, so a coordinate alone is accepted in both readings.
// Two of them cannot be made unique — a bullet count and an entity id are both
// small integers — and those are the weakest readings here. The two DURATIONS
// are looser still, and deliberately: seconds remaining is a quantity a build may
// honestly print in seconds, in tenths, or in milliseconds, so each is accepted
// at any of those scales. HOW each value is
// drawn is likewise the build's — `specs/ui.md` fixes no palette, no typeface and
// no layout for a panel it never mentions — so the facts that are not numbers are
// accepted in any of the forms a build would honestly draw them in.
//
// THE FIELD IS POSED AND THEN PAUSED. `specs/ui.md` freezes the field behind the
// pause menu — "no drone moves, no bullet travels, no phase timer runs, none of
// the clocks the wave keeps advances… so a paused game is exactly where it was
// when it was paused" — which is what makes "the snapshot is identical before and
// after" a reading about the OVERLAY rather than about the two frames of play that
// ran underneath it. A live inversion, a fire lockout and a playing burst cannot be
// held still any other way, and the overlay must report all three.
//
// THE STORED AND EFFECTIVE BANDS ARE SEPARATED BY THE POSE. Every drone on the
// field stores CYAN, and `specs/bands.md` takes a stored band to the opposite once
// for each of the shell being broken, a Flux shimmering, and an inversion being
// active. With the inversion this field poses live, that lands on three different
// answers from one stored band: the plain Shard reads MAGENTA, on the inversion's
// single swap; the shimmering Flux and the shell-broken Prism each take two swaps
// and read cyan again. So a panel that reports only the stored bands never draws
// the word `magenta` at all, and the reading below catches it. What is NOT decided
// is the pairing: a panel showing only effective bands draws both words too, and
// no line structure is fixed by any specification, so this point cannot hold a
// build to drawing the two together. The captured image is what a reviewer reads
// that off.
//
// TWO FLAGS ARE READ BY CHANGING THEM, WITH THE BAND WORDS MASKED. A Flux's
// shimmer state and a Prism's shell state are named by the specification and
// spelled by nobody: it asks that each line be "short enough to read on a line",
// so `shimmer`, `~`, `S:1` and `core` are all honest drawings of a flag, and no
// pattern can accept them all. What CAN be decided is sensitivity: the posed field
// is read again with exactly that one fact moved, through the setter
// `specs/instrumentation.md` gives it, and the panel must differ. But each flag
// also moves the drone's EFFECTIVE band — `specs/bands.md` takes a stored band to
// the opposite for a shimmering Flux and for a broken shell — and the effective
// band is a source of its own that the panel already draws, so a panel with no
// flag on it at all would differ on the band word alone. Every band word, in the
// spellings `CYAN_FORMS` and `MAGENTA_FORMS` accept, is therefore replaced by one
// placeholder before two panels are compared, and what is left to differ is a
// token that is not a band: the flag, in whatever spelling. A control reading with
// nothing moved finds the lines a panel moves on its own — a frame counter, a
// clock, which "Register at least" permits — and their figures are blanked in
// every comparison, so a restless panel cannot pass for one that reports the fact.
// Two things this reading does not separate from the flag: a panel that draws the
// Flux's band clock as a figure, which the shimmer setter moves too; and an
// effective band drawn as something other than a word, which the mask does not
// reach.
//
// TWO MORE FLAGS FOLLOW A FIGURE AND ARE READ THE SAME WAY. Whether a discharge
// is ready follows the resonance and whether an inversion is active follows the
// seconds left of it (specs/instrumentation.md), and neither has a spelling
// either — `ready`, `yes`, a tick, a `1`, or a mark drawn only while the fact
// holds are all honest drawings — so each is moved through the figure it
// follows: the resonance from RESONANCE_MAX to below it, with the meter's own
// figures masked so a panel that draws the meter alone cannot answer for the
// readiness, and the inversion from its posed seconds to none, where the seconds
// left are a source the panel owes as well and a zero of them is none. Each of
// those panels is read against a fresh frame drawn with the panel down, so text
// the HUD itself changes with the meter or with the inversion's mark
// (specs/ui.md) never stands in for a line of the panel.
//
// PURITY is read straight off the snapshot: identical across the toggle apart from
// `simTime`, which is set aside because the specification does not fix whether a
// paused game runs sub-steps at all — `simTime` "accumulates the time the game's
// sub-steps cover", and `specs/ui.md` freezes the field — so a build that advances
// it across the toggle and one that does not are both conformant.
//
// WHAT THIS DOES NOT DECIDE. The binding, which is `controls/overlay-backquote`,
// and that the panel is off when the game starts, which is that point's too.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual, assertNotEqual, fail } from "../assert";
import {
  FLIP_LOCKOUT,
  INVERSION_TIME,
  RESONANCE_MAX,
  START_LIVES,
  fluxHold,
  fluxWindow,
} from "../constants";
import {
  captureStill,
  createHarness,
  drawnTextLines,
  droneById,
  framesFor,
  poseDrone,
  requireDrone,
  shootDrone,
  startPosed,
  toggleOverlay,
  type Harness,
} from "../harness";

/**
 * The run posed, each figure inside the range its own rule allows it.
 *
 * `specs/progression.md` starts a run at `START_LIVES` (`3`) and pays exactly one
 * extra life, so four is the most a run ever carries and is the value posed here:
 * it differs from what `startPosed` left, so a build that ignores the pose draws
 * something else.
 */
const SCORE = 4271;
const LIVES = START_LIVES + 1;
const SHIP_X = 417;

/**
 * The stage posed: `9`, a multiple of `CHALLENGE_EVERY` (`3`), so the panel has a
 * challenge stage to report rather than the absence of one.
 */
const STAGE = 9;

/** The meter, posed at the ceiling so a discharge is ready to be reported. */
const RESONANCE = RESONANCE_MAX;

/**
 * Where the meter is moved to for the discharge reading: below the ceiling, so
 * a discharge is no longer ready, at a figure nothing else posed here carries.
 */
const RESONANCE_SPENT = 37;

/**
 * The two durations, in seconds, each at the top of the range its own rule fixes.
 *
 * `specs/bands.md` runs an inversion for `INVERSION_TIME` (`5.0`) seconds and
 * `specs/ship.md` sets the fire lockout to `FLIP_LOCKOUT` (`0.30`) on a flip, so
 * these are the largest values the game can hold and no value here is one the
 * game could never produce. Both read cleanly at every scale a build may print
 * them in, from seconds to milliseconds.
 */
const INVERSION = INVERSION_TIME;
const LOCKOUT = FLIP_LOCKOUT;

/** Where the three drones stand, at coordinates no other figure here carries. */
const SHARD_AT = { x: 688, y: 296 } as const;
const FLUX_AT = { x: 352, y: 464 } as const;
const PRISM_AT = { x: 928, y: 176 } as const;

/**
 * How far into its band window the Flux is posed, in seconds.
 *
 * `1.5`, which at stage 9 is past `fluxHold(9)` (`1.20` s) and short of
 * `fluxWindow(9)` (`1.60` s) — so the Flux is shimmering, and by
 * `specs/bands.md` it reads as the band it is moving toward, which is the
 * opposite of the cyan it stores.
 */
const BAND_CLOCK = 1.5;

/** Where the drones popped for their bursts stand, in clear columns of their own. */
const POP_AT: readonly { x: number; y: number }[] = [
  { x: 600, y: 520 },
  { x: 760, y: 520 },
];

/** How far below a popped drone its shot starts, and the frames it is allowed. */
const SHOT_BELOW = 60;
const SHOT_FRAMES = 25;

/** Where the six posed bullets hang: three of the player's and three of the enemy's. */
const FRIENDLY_AT: readonly { x: number; y: number }[] = [
  { x: 100, y: 620 },
  { x: 180, y: 620 },
  { x: 260, y: 620 },
];
const ENEMY_AT: readonly { x: number; y: number }[] = [
  { x: 1100, y: 120 },
  { x: 1200, y: 160 },
  { x: 1020, y: 208 },
];

/**
 * The forms the facts that are not numbers may be drawn in.
 *
 * `specs/instrumentation.md` names each fact and fixes no spelling for any of
 * them, so each pattern accepts every form a build would honestly use, and the
 * same set is read by the `none`, `simple-2d` and `structured-2d` suites so that
 * one requirement is decided the same way on all three engines.
 */
const CHALLENGE_FORMS = /challeng/i;
/**
 * A drone's kind, spelled out or abbreviated to its initial.
 *
 * The Diagnostics list names the fact and immediately asks a build to "Keep each
 * one short enough to read on a line", so a one-letter kind on a per-drone line is
 * an honest drawing of it and a spelled-out word is too. The three patterns cannot
 * be satisfied by one token, so a panel that reports a kind at all still has to
 * distinguish the three; a panel that reports none of them matches nothing.
 */
const SHARD_FORMS = /\bshard\b|\bs\b/i;
const FLUX_FORMS = /\bflux\b|\bf\b/i;
const PRISM_FORMS = /\bprism\b|\bp\b/i;
/**
 * A band, spelled out or abbreviated to its initial, for the same reason.
 *
 * A panel that draws only the STORED bands of this field draws neither a
 * `magenta` nor a standalone `m`, because every drone on it stores cyan and so
 * does the ship — so widening the form costs the reading below nothing.
 */
const CYAN_FORMS = /\bcyan\b|\bc\b/i;
const MAGENTA_FORMS = /\bmagenta\b|\bm\b/i;
/**
 * Every band word on a line, in the spellings above, as one placeholder.
 *
 * The two flag readings at the end move a Flux's shimmer and a Prism's shell, and
 * `specs/bands.md` moves the drone's effective band with each of them — a source
 * the panel draws in its own right. With the band words masked, the two panels of
 * a reading can differ only in something that is not a band, which is the flag.
 */
const BAND_WORDS = new RegExp(
  `${CYAN_FORMS.source}|${MAGENTA_FORMS.source}`,
  "gi",
);
function withoutBands(line: string): string {
  return line.replace(BAND_WORDS, "band");
}

/** The scales a build may honestly print a duration in: seconds to milliseconds. */
const DURATION_SCALES = [1, 10, 100, 1000] as const;

/**
 * How long, in seconds, each of the three flag readings runs the paused field
 * before its panel is read.
 *
 * A panel may carry sources of its own beyond the list — a frame counter, a
 * clock — and a value that ticks once a second or faster ticks inside the
 * control's span, so it is caught there rather than mistaken for the fact moved
 * in the reading that follows.
 */
const SETTLE_SPAN = 1;
const SETTLE_FRAMES = framesFor(SETTLE_SPAN);

/** The lines `after` drew beyond `before`, as a multiset difference. */
function newLines(
  before: readonly string[],
  after: readonly string[],
): string[] {
  const counts = new Map<string, number>();
  for (const line of before) counts.set(line, (counts.get(line) ?? 0) + 1);
  return after.filter((line) => {
    const held = counts.get(line) ?? 0;
    if (held > 0) {
      counts.set(line, held - 1);
      return false;
    }
    return true;
  });
}

/**
 * A line with every figure blanked: which line of the panel it is, whatever it
 * reads at the moment.
 *
 * The control reading below finds the lines a panel moves on its own, and a
 * frame counter or a clock is the same line from one frame to the next with a
 * different figure on it. Such a line is compared in this blanked form rather
 * than dropped, so a drone's line keeps its flag if a counter shares its
 * baseline; only a flag spelled as a figure is lost with it there.
 */
function shapeOf(line: string): string {
  return line.replace(/\d+/g, "#");
}

/**
 * The characters a build may group a run of digits with.
 *
 * A comma, an apostrophe and the three spaces a locale groups thousands by —
 * between them every separator `Number.prototype.toLocaleString` reaches for. The
 * ASCII space is deliberately absent: a plain space is what stands between two
 * figures on one panel line, so accepting it would read the two figures of
 * `40 130` as the single number `40130`. The full stop is absent for a reason of
 * its own — it is the decimal point, and a panel drawing `1.5` means one and a
 * half.
 */
const GROUP = "[,'\\u00A0\\u202F\\u2009]";

/** One number as a panel may have drawn it: grouped in threes, or plain. */
const DRAWN = new RegExp(
  `-?\\d{1,3}(?:${GROUP}\\d{3})+(?:\\.\\d+)?|-?\\d+(?:\\.\\d+)?`,
  "g",
);

/**
 * Every number the lines drew, read with any grouping taken back out — and, when
 * `apart` is set, every run of digits inside a grouped figure as a number of its
 * own as well.
 *
 * A figure is read whole rather than digit by digit, so a panel that drew the
 * score as `4,271` reports the one number `4271` and not the two numbers `4` and
 * `271`. `specs/ui.md` fixes no presentation for a panel it never mentions, so
 * how a build groups its digits is the build's. The same characters also spell
 * two figures a panel joined with a comma — a position drawn as `688,296` — and
 * nothing in the text tells the two apart, so a reading that wants the joined
 * figures asks for them `apart`: `688,296` then reports `688296`, `688` and
 * `296`, and a build that never drew a coordinate still draws none of them.
 */
function drawnNumbers(lines: readonly string[], apart = false): number[] {
  const grouping = new RegExp(GROUP, "g");
  return lines.flatMap((line) =>
    (line.match(DRAWN) ?? []).flatMap((drawn) => {
      const whole = Number(drawn.replace(grouping, ""));
      if (!apart) return [whole];
      return [whole, ...drawn.split(new RegExp(GROUP)).map(Number)];
    }),
  );
}

/**
 * A line with every figure that reads as one of `figures` blanked.
 *
 * The discharge reading moves the resonance, and the resonance is a source of
 * its own that the panel already draws — `resonance: 100` before the move and
 * `resonance: 37` after it — so a panel with no readiness on it at all would
 * differ on that figure alone. Both figures are blanked before the two panels
 * are compared, as the band words are for the shimmer and the shell, and what
 * is left to differ is something that is not the meter: the flag, in whatever
 * spelling, or a mark drawn only while a discharge is ready. A flag spelled as
 * a figure of its own (`ready: 1`) is neither figure and still changes its line.
 */
function withoutFigures(line: string, figures: readonly number[]): string {
  const grouping = new RegExp(GROUP, "g");
  return line.replace(DRAWN, (drawn) =>
    figures.includes(Number(drawn.replace(grouping, ""))) ? "#" : drawn,
  );
}

/** Some line carries `value` as a whole figure; fails naming what was wanted. */
function assertFigure(
  lines: readonly string[],
  value: number,
  what: string,
): void {
  if (!drawnNumbers(lines).includes(value)) {
    fail(`an overlay line carrying ${what} (${String(value)})`, lines);
  }
}

/**
 * Some line carries `value` as one coordinate of a position: a whole figure of
 * its own, or one run of a comma-joined pair.
 *
 * `specs/instrumentation.md` asks for each drone's "position" and fixes no form
 * for it, so `(688, 296)`, `x 688 y 296` and `@688,296` all draw the coordinates
 * the reading asks for — and the last of those is the same text as the grouped
 * figure `688296`. Only a position is read this way; the scalar figures keep the
 * whole-figure reading, so a score drawn as `4,271` never answers for the lives.
 */
function assertCoordinate(
  lines: readonly string[],
  value: number,
  what: string,
): void {
  if (!drawnNumbers(lines, true).includes(value)) {
    fail(`an overlay line carrying ${what} (${String(value)})`, lines);
  }
}

/** Some line carries `seconds` at one of the scales a build may print it at. */
function assertDuration(
  lines: readonly string[],
  seconds: number,
  what: string,
): void {
  const drawn = drawnNumbers(lines);
  const wanted = DURATION_SCALES.map((scale) => seconds * scale);
  if (!wanted.some((figure) => drawn.includes(figure))) {
    fail(
      `an overlay line carrying ${what} (${seconds} s, as any of ` +
        `${wanted.map(String).join(", ")})`,
      lines,
    );
  }
}

/** Some line matches `pattern`; fails naming what was wanted. */
function assertForm(
  lines: readonly string[],
  pattern: RegExp,
  what: string,
): void {
  if (!lines.some((line) => pattern.test(line))) {
    fail(`an overlay line carrying ${what}`, lines);
  }
}

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h?.dispose();
});

it("draws every registered value and changes nothing in the game", async () => {
  await startPosed(h);

  // The three drones the panel must report, each storing CYAN and each with every
  // faculty off, so nothing about them moves between the two frames below.
  const shard = await poseDrone(h, "shard", SHARD_AT.x, SHARD_AT.y, {
    band: "cyan",
  });
  const flux = await poseDrone(h, "flux", FLUX_AT.x, FLUX_AT.y, {
    band: "cyan",
    bandClock: BAND_CLOCK,
  });
  const prism = await poseDrone(h, "prism", PRISM_AT.x, PRISM_AT.y, {
    band: "cyan",
    shell: false,
  });

  // The bursts, which can only be outcomes: two Shards destroyed by matching
  // shots. They are popped at stage 1, before the stage below is posed.
  for (const at of POP_AT) {
    const target = await poseDrone(h, "shard", at.x, at.y, { band: "cyan" });
    const shot = await shootDrone(h, target, "cyan", {
      below: SHOT_BELOW,
      maxFrames: SHOT_FRAMES,
    });
    if (!shot.hit || droneById(shot.snapshot, target) !== undefined) {
      fail(
        `the Shard at (${at.x}, ${at.y}) destroyed by a matching shot ` +
          `(specs/bands.md) — the panel must report the bursts playing, and ` +
          `nothing adds one but a kill`,
        `the drone was still on the field after ${SHOT_FRAMES} frames`,
      );
    }
  }

  // The bullets, placed after the shots so the roster holds exactly these.
  for (const at of FRIENDLY_AT) {
    await h.debug.addPlayerBullet(at.x, at.y, "cyan");
  }
  for (const at of ENEMY_AT) {
    await h.debug.addEnemyBullet(at.x, at.y, "magenta");
  }

  // The run, and the ship.
  await h.debug.setScore(SCORE);
  await h.debug.setLives(LIVES);
  await h.debug.setStage(STAGE);
  await h.debug.setResonance(RESONANCE);
  await h.debug.setInversion(INVERSION);
  await h.debug.setShipX(SHIP_X);
  await h.debug.setFireLockout(LOCKOUT);

  // Frozen behind the pause menu, so what changes across the toggle is the
  // overlay and nothing else (specs/ui.md).
  await h.debug.setScreen("paused");

  const posed = await h.snapshot();
  const bullets = posed.bullets.length;
  const bursts = posed.bursts.length;
  assertEqual(
    requireDrone(posed, flux, "the Flux the panel reports").shimmer,
    true,
    `whether the Flux posed ${BAND_CLOCK} s into its window is shimmering at ` +
      `stage ${STAGE}, where fluxHold is ${fluxHold(STAGE)} s and the whole ` +
      `window is ${fluxWindow(STAGE)} s (specs/drones.md) — the effective ` +
      `band the panel must draw depends on it (specs/bands.md)`,
  );
  assertEqual(
    bursts,
    POP_AT.length,
    `the bursts playing over the posed field, one per drone popped`,
  );
  assertEqual(
    bullets,
    FRIENDLY_AT.length + ENEMY_AT.length,
    `the bullets in flight over the posed field, one per bullet placed`,
  );

  // A steady frame without the overlay, for the baseline text — the overlay is
  // off when the game starts and nothing has toggled it yet.
  const baseline = drawnTextLines(await h.frameCalls());
  const before = await h.snapshot();

  /** The panel's own lines over the field as it stands, off one more frame. */
  const panelNow = async (): Promise<string[]> =>
    newLines(baseline, drawnTextLines(await h.frameCalls()));

  // …then the toggle, and the frame that draws the panel it opened.
  await toggleOverlay(h);
  const overlay = await panelNow();
  // The overlay drawn over the posed field.
  await captureStill(h, "overlay");
  const after = await h.snapshot();

  // ---- The values specs/instrumentation.md names --------------------------

  assertForm(overlay, /paused/i, "the current screen, 'paused'");
  assertForm(overlay, /\blive\b/i, "the current phase, 'live'");
  assertFigure(overlay, STAGE, "the current stage");
  assertForm(overlay, CHALLENGE_FORMS, "that the stage is a challenge stage");

  assertFigure(overlay, SCORE, "the score");
  assertFigure(overlay, LIVES, "the lives");
  assertFigure(overlay, RESONANCE, "the resonance");
  // Whether a discharge is ready is read below, by moving the resonance.

  // Whether an inversion is active is read below, by ending it.
  assertDuration(overlay, INVERSION, "how long is left of the inversion");

  assertFigure(overlay, SHIP_X, "the ship's x");
  assertForm(
    overlay,
    CYAN_FORMS,
    "the ship's band, and the drones' stored bands",
  );
  assertDuration(overlay, LOCKOUT, "the ship's remaining fire lockout");

  assertFigure(overlay, shard, "the Shard's id");
  assertFigure(overlay, flux, "the Flux's id");
  assertFigure(overlay, prism, "the Prism's id");
  assertForm(overlay, SHARD_FORMS, "the Shard's kind");
  assertForm(overlay, FLUX_FORMS, "the Flux's kind");
  assertForm(overlay, PRISM_FORMS, "the Prism's kind");
  assertForm(
    overlay,
    MAGENTA_FORMS,
    "an effective band — every drone on this field STORES cyan, and under the " +
      "live inversion the plain Shard reads as magenta (specs/bands.md)",
  );
  assertCoordinate(overlay, SHARD_AT.x, "the x of the Shard's position");
  assertCoordinate(overlay, SHARD_AT.y, "the y of the Shard's position");
  assertCoordinate(overlay, FLUX_AT.x, "the x of the Flux's position");
  assertCoordinate(overlay, FLUX_AT.y, "the y of the Flux's position");
  assertCoordinate(overlay, PRISM_AT.x, "the x of the Prism's position");
  assertCoordinate(overlay, PRISM_AT.y, "the y of the Prism's position");
  assertForm(overlay, /formation/i, "each drone's phase");

  assertFigure(overlay, bullets, "how many bullets are in flight");
  assertFigure(overlay, bursts, "how many bursts are playing");

  // ---- And the game is exactly as it was ----------------------------------

  assertDeepEqual(
    { ...after, simTime: 0 },
    { ...before, simTime: 0 },
    "every diagnostic source is a pure read, so watching the overlay leaves " +
      "the game as it is (specs/instrumentation.md)",
  );

  // ---- The two flags, read by changing them -------------------------------
  //
  // Every panel below is compared with its band words masked, because each flag
  // moves the drone's effective band as well (specs/bands.md) and the band is
  // already a source of its own; what has to differ is the flag.

  // The control first: the same field, a second on. Nothing on it moves behind
  // the pause menu (specs/ui.md), so a line that reads differently now is one the
  // build moves on its own — a frame counter, a clock — and its figures are
  // blanked in the two readings below, each of which is taken over the same span.
  await h.advance(SETTLE_FRAMES);
  const held = await panelNow();
  const restless = new Set(
    [...newLines(overlay, held), ...newLines(held, overlay)].map((line) =>
      shapeOf(withoutBands(line)),
    ),
  );
  const settled = (panel: readonly string[]): string =>
    panel
      .map((line) => {
        const read = withoutBands(line);
        return restless.has(shapeOf(read)) ? shapeOf(read) : read;
      })
      .join("\n");

  await h.debug.setDroneBandClock(flux, 0);
  await h.advance(SETTLE_FRAMES);
  const fluxHolding = await panelNow();
  assertNotEqual(
    settled(fluxHolding),
    settled(held),
    `the panel's settled lines, band words masked, over the same field with ` +
      `the Flux's band clock moved from ${String(BAND_CLOCK)} s to 0, below ` +
      `fluxHold(${String(STAGE)}) = ${String(fluxHold(STAGE))} s, so it holds ` +
      `its band instead of shimmering (specs/drones.md) — its effective band ` +
      `moves with that (specs/bands.md) and is masked out, and the same drone ` +
      `stands at the same id and position, so a panel that reports the Flux's ` +
      `shimmer state draws something different and one that omits it cannot ` +
      `(specs/instrumentation.md, Diagnostics); the figures of ` +
      `${String(restless.size)} line(s) that moved with nothing changed are ` +
      `blanked`,
  );

  await h.debug.setDroneShell(prism, true);
  await h.advance(SETTLE_FRAMES);
  const shellIntact = await panelNow();
  assertNotEqual(
    settled(shellIntact),
    settled(fluxHolding),
    "the panel's settled lines, band words masked, over the same field with " +
      "the Prism's shell restored — its effective band moves with that " +
      "(specs/bands.md) and is masked out, and the same drone stands at the " +
      "same id and position, so a panel that reports the Prism's shell state " +
      "draws something different and one that omits it cannot " +
      "(specs/instrumentation.md, Diagnostics); the figures of " +
      `${String(restless.size)} line(s) that moved with nothing changed are ` +
      "blanked",
  );
  // ---- The two flags that follow a figure, read the same way --------------
  //
  // Whether a discharge is ready follows the resonance and whether an inversion
  // is active follows the seconds left of it (specs/instrumentation.md:
  // `dischargeReady` follows the resonance, `inversionActive` follows the
  // inversion), and specs/instrumentation.md spells neither, so each is moved
  // through the figure it follows and the panel must differ, with the lines the
  // control pair found restless blanked as above. Each panel here is read
  // against a FRESH frame drawn with the panel down: the HUD draws the resonance
  // meter and the inversion's field-wide mark (specs/ui.md), and text the game
  // itself draws differently once the meter is spent or the inversion is over
  // must not stand in for a line of the panel.

  /** The panel's lines, read against a frame drawn with the panel down. */
  const panelFresh = async (): Promise<string[]> => {
    await toggleOverlay(h);
    const bare = drawnTextLines(await h.frameCalls());
    await toggleOverlay(h);
    return newLines(bare, drawnTextLines(await h.frameCalls()));
  };

  // The resonance is a source of its own that the panel already draws, so its
  // figure before and after the move is masked as the band words are: what is
  // left to differ is the readiness, in whatever spelling.
  const meterFigures = [RESONANCE, RESONANCE_SPENT];
  const ready = await panelFresh();
  await h.debug.setResonance(RESONANCE_SPENT);
  await h.advance(SETTLE_FRAMES);
  const spent = await panelFresh();
  assertNotEqual(
    settled(spent.map((line) => withoutFigures(line, meterFigures))),
    settled(ready.map((line) => withoutFigures(line, meterFigures))),
    `the panel's settled lines, band words and the meter's figures masked, ` +
      `over the same field with the resonance moved from ${String(RESONANCE)} ` +
      `to ${String(RESONANCE_SPENT)}, below RESONANCE_MAX, so a discharge is ` +
      `no longer ready (specs/instrumentation.md: dischargeReady follows the ` +
      `resonance) — the meter's own figure is masked out, so a panel that ` +
      `reports whether a discharge is ready draws something different and one ` +
      `that draws the meter alone cannot (specs/instrumentation.md, ` +
      `Diagnostics); the figures of ${String(restless.size)} line(s) that ` +
      `moved with nothing changed are blanked`,
  );

  // The seconds left are a source of their own too, and they are NOT masked: a
  // zero of them is none (specs/instrumentation.md), so a line that reports
  // them reports whether an inversion is active, as a run's count reports
  // whether a run is in hand. What a panel that reports neither cannot do is
  // differ.
  await h.debug.setInversion(0);
  await h.advance(SETTLE_FRAMES);
  const ended = await panelFresh();
  assertNotEqual(
    settled(ended),
    settled(spent),
    `the panel's settled lines, band words masked, over the same field with ` +
      `the inversion ended (${String(INVERSION)} s left moved to 0) — every ` +
      `drone's and every enemy bullet's effective band moves with that ` +
      `(specs/bands.md) and is masked out, so a panel that reports whether a ` +
      `spectral inversion is active, or how long is left of it, draws ` +
      `something different and one that reports neither cannot ` +
      `(specs/instrumentation.md, Diagnostics); the figures of ` +
      `${String(restless.size)} line(s) that moved with nothing changed are ` +
      `blanked`,
  );
});
