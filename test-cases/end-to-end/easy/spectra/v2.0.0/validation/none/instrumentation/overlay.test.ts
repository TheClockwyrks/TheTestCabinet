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
// field stores CYAN, and two of them read as magenta by `specs/bands.md` — a Flux
// posed mid-shimmer, which "reads as the band it is moving toward", and a Prism
// whose shell is broken, which is read at its core. So a panel that reports only
// the stored bands never draws the word `magenta` at all, and the reading below
// catches it. What is NOT decided is the pairing: a panel showing only effective
// bands draws both words too, and no line structure is fixed by any specification,
// so this point cannot hold a build to drawing the two together. The captured
// image is what a reviewer reads that off.
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
import { assertDeepEqual, assertEqual, fail } from "../assert";
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
const READY_FORMS = /ready|\byes\b|\btrue\b|\bon\b|\bfull\b/i;
const INVERSION_FORMS = /invert|inversion|activ|\byes\b|\btrue\b|\bon\b/i;
const SHIMMER_FORMS = /shimmer|\bshim\b/i;
const SHELL_FORMS = /core|broken|shell/i;

/** The scales a build may honestly print a duration in: seconds to milliseconds. */
const DURATION_SCALES = [1, 10, 100, 1000] as const;

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
 * Every number the lines drew, read with any grouping taken back out.
 *
 * A figure is read whole rather than digit by digit, so a panel that drew the
 * score as `4,271` reports the one number `4271` and not the two numbers `4` and
 * `271`. `specs/ui.md` fixes no presentation for a panel it never mentions, so
 * how a build groups its digits is the build's.
 */
function drawnNumbers(lines: readonly string[]): number[] {
  return lines.flatMap((line) =>
    (line.match(DRAWN) ?? []).map((drawn) =>
      Number(drawn.replace(new RegExp(GROUP, "g"), "")),
    ),
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
      `band the panel must draw depends on it`,
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

  // …then the toggle, and the frame that draws the panel it opened.
  await toggleOverlay(h);
  const overlay = newLines(baseline, drawnTextLines(await h.frameCalls()));
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
  assertForm(overlay, READY_FORMS, "that a discharge is ready");

  assertForm(overlay, INVERSION_FORMS, "that a spectral inversion is active");
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
    "an effective band — every drone on this field STORES cyan, and the " +
      "shimmering Flux and the shell-broken Prism both read as magenta " +
      "(specs/bands.md)",
  );
  assertFigure(overlay, SHARD_AT.x, "the x of the Shard's position");
  assertFigure(overlay, SHARD_AT.y, "the y of the Shard's position");
  assertFigure(overlay, FLUX_AT.x, "the x of the Flux's position");
  assertFigure(overlay, FLUX_AT.y, "the y of the Flux's position");
  assertFigure(overlay, PRISM_AT.x, "the x of the Prism's position");
  assertFigure(overlay, PRISM_AT.y, "the y of the Prism's position");
  assertForm(overlay, /formation/i, "each drone's phase");
  assertForm(overlay, SHIMMER_FORMS, "the Flux's shimmer state");
  assertForm(overlay, SHELL_FORMS, "the Prism's shell state");

  assertFigure(overlay, bullets, "how many bullets are in flight");
  assertFigure(overlay, bursts, "how many bursts are playing");

  // ---- And the game is exactly as it was ----------------------------------

  assertDeepEqual(
    { ...after, simTime: 0 },
    { ...before, simTime: 0 },
    "every diagnostic source is a pure read, so watching the overlay leaves " +
      "the game as it is (specs/instrumentation.md)",
  );
});
