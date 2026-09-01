// instrumentation/overlay — the read-only debug overlay reports the game, and
// watching it leaves the game exactly as it is.
//
// specs/instrumentation.md, Diagnostics, fixes what it shows: "the current
// `screen`, `phase`, and `stage`, and whether the stage is a challenge stage; the
// score, the lives, the resonance, and whether a discharge is ready; whether a
// spectral inversion is active and how long is left; the ship's `x`, its band, and
// its remaining fire lockout; for each drone, its id, its kind, its stored and
// effective bands, its position, its phase, a Flux's shimmer state, and a Prism's
// shell state; how many bullets are in flight, and how many bursts are playing."
//
// WHAT IS THE BUILD'S HERE, AND WHAT IS THE ENGINE'S. Under this engine the panel
// itself is not the build's: "Registering those values is the whole of Spectra's
// part, through `InitApi.diagnostics`. Each source is called with the state
// current at the read ... Drawing the panel, toggling it, and keeping it read-only
// are the engine's." So what this point decides is the REGISTRATION — that every
// fact the list names is a source the build named, reading the state it is handed
// — and, through the same reading, that no source of the build's changes the game
// while it is read.
//
// HOW THE LINES ARE READ. The engine draws the overlay after the game's `render`,
// through the same recorded context every other rendering check reads, so the text
// a steady frame draws WITHOUT the overlay is collected first and the text the
// toggle's frame draws WITH it second; the difference is the panel's own lines.
// The engine's own metrics line — `frame: <mean> / <p95> / <p99> ms`, chrome it
// appends after the registered sources — is dropped from that difference, because
// it is not a value the build named and its figures would otherwise answer for
// one.
//
// HOW A VALUE IS RECOGNISED. Every figure below is checked as a whole run of
// digits rather than as a substring, so a `9` on the panel is not answered by the
// `9` inside some other number, and the field is posed so that no two of the
// values asserted share a figure. Two of them cannot be made unique — a bullet
// count and an entity id are both small integers — and those are the weakest
// readings here. The two DURATIONS are looser still, and deliberately: seconds
// remaining is a quantity a build may honestly print in seconds, in tenths, or in
// milliseconds, so each is accepted at any of those scales. HOW each value is
// drawn is likewise the build's — the engine fixes the line as `name: value` and
// nothing fixes the name — so the facts that are not numbers are accepted in any
// of the forms a build would honestly draw them in, a drone's kind and a band
// included: the Diagnostics list asks a build to "Keep each one short enough to
// read on a line", which makes a one-letter kind or band on a per-drone line as
// honest a drawing of the fact as the spelled-out word.
//
// THE FIELD IS POSED AND THEN PAUSED. specs/ui.md freezes the field behind the
// pause menu — "no drone moves, no bullet travels, no phase timer runs, none of
// the clocks the wave keeps advances ... so a paused game is exactly where it was
// when it was paused" — which is what makes "the snapshot is identical before and
// after" a reading about the OVERLAY rather than about the two frames of play that
// ran underneath it. A live inversion, a fire lockout and a playing burst cannot
// be held still any other way, and the overlay must report all three.
//
// THE STORED AND EFFECTIVE BANDS ARE SEPARATED BY THE POSE. Every drone on the
// field stores CYAN, and specs/bands.md takes a stored band to the opposite once
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
// PURITY is read straight off the snapshot: identical across the toggle apart from
// `simTime`, which is set aside because the specification does not fix whether a
// paused game runs sub-steps at all — `simTime` "accumulates the time the game's
// sub-steps cover", and specs/ui.md freezes the field — so a build that advances
// it across the toggle and one that does not are both conformant.
//
// WHAT THIS DOES NOT DECIDE. The binding, which is `controls/overlay-backquote`,
// and that the panel is off when the game starts, which is that point's too.

import { afterEach, beforeEach, it } from "vitest";
import { RESONANCE_MAX, fluxHold, fluxWindow } from "../../src/constants";
import { assertDeepEqual, assertEqual, fail } from "../assert";
import {
  captureStill,
  createHarness,
  drawFrame,
  drawnText,
  droneOf,
  poseDrone,
  startPosed,
  type Harness,
} from "../harness";
import { poseBursts } from "./bursts";

/** The run posed: three figures no other value on this field carries. */
const SCORE = 4271;
const LIVES = 14;
const SHIP_X = 417;

/**
 * The stage posed: `9`, a multiple of `CHALLENGE_EVERY` (`3`), so the panel has a
 * challenge stage to report rather than the absence of one.
 */
const STAGE = 9;

/** The meter, posed at the ceiling so a discharge is ready to be reported. */
const RESONANCE = RESONANCE_MAX;

/** The two durations, in seconds. Both are whole, so any scale reads cleanly. */
const INVERSION = 4;
const LOCKOUT = 8;

/** Where the three drones stand, at coordinates no other figure here carries. */
const SHARD_AT = { x: 688, y: 296 } as const;
const FLUX_AT = { x: 352, y: 464 } as const;
const PRISM_AT = { x: 928, y: 176 } as const;

/**
 * How far into its band window the Flux is posed, in seconds.
 *
 * `1.5`, which at stage 9 is past `fluxHold(9)` (`1.20` s) and short of
 * `fluxWindow(9)` (`1.60` s) — so the Flux is shimmering, and by specs/bands.md it
 * reads as the band it is moving toward, which is the opposite of the cyan it
 * stores.
 */
const BAND_CLOCK = 1.5;

/** How many drones are popped for the bursts the panel must count. */
const BURSTS = 2;

/** Where the five posed bullets hang: three of the player's, two of the enemy's. */
const FRIENDLY_AT: readonly { x: number; y: number }[] = [
  { x: 100, y: 620 },
  { x: 180, y: 620 },
  { x: 260, y: 620 },
];
const ENEMY_AT: readonly { x: number; y: number }[] = [
  { x: 1100, y: 120 },
  { x: 1200, y: 160 },
];

/** The one key the engine binds the overlay toggle to. */
const OVERLAY_TOGGLE = "Backquote";

/**
 * The engine's own line, appended after the registered sources.
 *
 * `frame: <mean> / <p95> / <p99> ms`, at one decimal each. It is engine chrome
 * rather than a value the build named, so it is dropped before the panel is read:
 * its figures must not be allowed to answer for one of the build's.
 */
const ENGINE_METRICS = /^frame: [\d.]+ \/ [\d.]+ \/ [\d.]+ ms$/;

/**
 * The forms the facts that are not numbers may be drawn in.
 *
 * specs/instrumentation.md names each fact and fixes no spelling for any of them,
 * so each pattern accepts every form a build would honestly use, and the same set
 * is read by the `none`, `simple-2d` and `structured-2d` suites so that one
 * requirement is decided the same way on all three engines.
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

/** Every maximal run of digits the lines carry. */
function digitRuns(lines: readonly string[]): string[] {
  return lines.flatMap((line) => line.match(/\d+/g) ?? []);
}

/** Some line carries `value` as a whole figure; fails naming what was wanted. */
function assertFigure(
  lines: readonly string[],
  value: number,
  what: string,
): void {
  if (!digitRuns(lines).includes(String(value))) {
    fail(`an overlay line carrying ${what} (${String(value)})`, lines);
  }
}

/** Some line carries `seconds` at one of the scales a build may print it at. */
function assertDuration(
  lines: readonly string[],
  seconds: number,
  what: string,
): void {
  const runs = digitRuns(lines);
  const wanted = DURATION_SCALES.map((scale) => String(seconds * scale));
  if (!wanted.some((figure) => runs.includes(figure))) {
    fail(
      `an overlay line carrying ${what} (${String(seconds)} s, as any of ` +
        `${wanted.join(", ")})`,
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

afterEach(() => {
  h?.dispose();
});

it("registers every value the diagnostics list names and changes nothing", async () => {
  startPosed(h);

  // The bursts first, which can only be outcomes: two Shards destroyed by
  // matching shots. They are popped at stage 1, before the stage below is posed,
  // and the helper leaves the drone and player-bullet rosters empty behind it.
  const popped = await poseBursts(h, BURSTS);

  // The three drones the panel must report, each storing CYAN and each with every
  // faculty off, so nothing about them moves between the two frames below.
  const shard = poseDrone(h, "shard", SHARD_AT.x, SHARD_AT.y, { band: "cyan" });
  const flux = poseDrone(h, "flux", FLUX_AT.x, FLUX_AT.y, {
    band: "cyan",
    bandClock: BAND_CLOCK,
  });
  const prism = poseDrone(h, "prism", PRISM_AT.x, PRISM_AT.y, {
    band: "cyan",
    shell: false,
  });

  // The bullets, placed after the pops so the roster holds exactly these.
  for (const at of FRIENDLY_AT) h.debug.addPlayerBullet(at.x, at.y, "cyan");
  for (const at of ENEMY_AT) h.debug.addEnemyBullet(at.x, at.y, "magenta");

  // The run, and the ship.
  h.debug.setScore(SCORE);
  h.debug.setLives(LIVES);
  h.debug.setStage(STAGE);
  h.debug.setResonance(RESONANCE);
  h.debug.setInversion(INVERSION);
  h.debug.setShipX(SHIP_X);
  h.debug.setFireLockout(LOCKOUT);

  // Frozen behind the pause menu, so what changes across the toggle is the
  // overlay and nothing else (specs/ui.md).
  h.debug.setScreen("paused");

  const posed = h.snapshot();
  const bullets = posed.bullets.length;
  const bursts = posed.bursts.length;
  assertEqual(
    droneOf(posed, flux).shimmer,
    true,
    `whether the Flux posed ${String(BAND_CLOCK)} s into its window is ` +
      `shimmering at stage ${String(STAGE)}, where fluxHold is ` +
      `${String(fluxHold(STAGE))} s and the whole window is ` +
      `${String(fluxWindow(STAGE))} s (specs/drones.md) — the effective band ` +
      "the panel must draw depends on it",
  );
  assertEqual(
    bursts,
    popped.length,
    "the bursts playing over the posed field, one per drone popped",
  );
  assertEqual(
    bullets,
    FRIENDLY_AT.length + ENEMY_AT.length,
    "the bullets in flight over the posed field, one per bullet placed",
  );

  // A steady frame without the overlay, for the baseline text — the engine keeps
  // the panel hidden until its key is pressed, and nothing has pressed it.
  const baseline = drawnText(await drawFrame(h));
  const before = h.snapshot();

  // …then the toggle, and the frame that draws the panel it opened.
  h.calls.length = 0;
  await h.tap(OVERLAY_TOGGLE);
  // The overlay drawn over the posed field.
  captureStill(h, "overlay");
  const overlay = newLines(baseline, drawnText([...h.calls])).filter(
    (line) => !ENGINE_METRICS.test(line),
  );
  const after = h.snapshot();

  // ---- The values specs/instrumentation.md names ---------------------------

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
    "an effective band — every drone on this field STORES cyan, and under the " +
      "live inversion the plain Shard reads as magenta (specs/bands.md)",
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

  // ---- And the game is exactly as it was -----------------------------------

  assertDeepEqual(
    { ...after, simTime: 0 },
    { ...before, simTime: 0 },
    "every diagnostic source is a pure read, so watching the overlay leaves " +
      "the game as it is (specs/instrumentation.md)",
  );
});
