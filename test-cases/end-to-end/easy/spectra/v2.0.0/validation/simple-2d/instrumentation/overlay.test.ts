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
// TWO FLAGS ARE READ BY CHANGING THEM, WITH THE BAND WORDS MASKED. A Flux's
// shimmer state and a Prism's shell state are named by the specification and
// spelled by nobody: it asks that each line be "short enough to read on a line",
// so `shimmer`, `~`, `S:1` and `core` are all honest drawings of a flag, and no
// pattern can accept them all. What CAN be decided is sensitivity: the posed field
// is read again with exactly that one fact moved, through the setter
// specs/instrumentation.md gives it, and the panel must differ. But each flag also
// moves the drone's EFFECTIVE band — specs/bands.md takes a stored band to the
// opposite for a shimmering Flux and for a broken shell — and the effective band
// is a source of its own that the panel already draws, so a panel with no flag on
// it at all would differ on the band word alone. Every band word, in the spellings
// `CYAN_FORMS` and `MAGENTA_FORMS` accept, is therefore replaced by one
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
// WHAT THIS DOES NOT DECIDE. The binding, the panel itself, and that it is off
// when the game starts, all of which this engine supplies to every build on it.
// What is read here is the sources the BUILD registered into it.

import { afterEach, beforeEach, it } from "vitest";
import {
  FLIP_LOCKOUT,
  INVERSION_TIME,
  RESONANCE_MAX,
  START_LIVES,
  fluxHold,
  fluxWindow,
} from "../constants";
import { assertDeepEqual, assertEqual, assertNotEqual, fail } from "../assert";
import {
  captureStill,
  createHarness,
  drawFrame,
  drawnText,
  droneOf,
  poseDrone,
  ticksFor,
  startPosed,
  type Harness,
} from "../harness";
import { poseBursts } from "./bursts";

/** The run posed: three figures no other value on this field carries. */
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
 * `fluxWindow(9)` (`1.60` s) — so the Flux is shimmering, and by specs/bands.md it
 * reads as the band it is moving toward, which is the opposite of the cyan it
 * stores.
 */
const BAND_CLOCK = 1.5;

/** How many drones are popped for the bursts the panel must count. */
const BURSTS = 2;

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
/**
 * Every band word on a line, in the spellings above, as one placeholder.
 *
 * The two flag readings at the end move a Flux's shimmer and a Prism's shell, and
 * specs/bands.md moves the drone's effective band with each of them — a source
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
const READY_FORMS = /ready|\byes\b|\btrue\b|\bon\b|\bfull\b/i;
const INVERSION_FORMS = /invert|inversion|activ|\byes\b|\btrue\b|\bon\b/i;

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
const SETTLE_FRAMES = ticksFor(SETTLE_SPAN);

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
      `an overlay line carrying ${what} (${String(seconds)} s, as any of ` +
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
      "the panel must draw depends on it (specs/bands.md)",
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

  /** The panel's own lines over the field as it stands, off one more frame. */
  const panelNow = async (): Promise<string[]> =>
    newLines(baseline, drawnText(await drawFrame(h))).filter(
      (line) => !ENGINE_METRICS.test(line),
    );

  // …then the toggle, and a frame that draws the panel it opened.
  await h.tap(OVERLAY_TOGGLE);
  const overlay = await panelNow();
  // The overlay drawn over the posed field.
  captureStill(h, "overlay");
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
  assertCoordinate(overlay, SHARD_AT.x, "the x of the Shard's position");
  assertCoordinate(overlay, SHARD_AT.y, "the y of the Shard's position");
  assertCoordinate(overlay, FLUX_AT.x, "the x of the Flux's position");
  assertCoordinate(overlay, FLUX_AT.y, "the y of the Flux's position");
  assertCoordinate(overlay, PRISM_AT.x, "the x of the Prism's position");
  assertCoordinate(overlay, PRISM_AT.y, "the y of the Prism's position");
  assertForm(overlay, /formation/i, "each drone's phase");

  assertFigure(overlay, bullets, "how many bullets are in flight");
  assertFigure(overlay, bursts, "how many bursts are playing");

  // ---- And the game is exactly as it was -----------------------------------

  assertDeepEqual(
    { ...after, simTime: 0 },
    { ...before, simTime: 0 },
    "every diagnostic source is a pure read, so watching the overlay leaves " +
      "the game as it is (specs/instrumentation.md)",
  );

  // ---- The two flags, read by changing them --------------------------------
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

  h.debug.setDroneBandClock(flux, 0);
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

  h.debug.setDroneShell(prism, true);
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
});
