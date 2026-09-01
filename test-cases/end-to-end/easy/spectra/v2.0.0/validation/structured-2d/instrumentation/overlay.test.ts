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
// Under this engine the panel is ENGINE CHROME: "Registering those values is the
// whole of Spectra's part, through `world.diagnostics` in the game mode's
// `beginPlay`… Drawing the panel and toggling it are the engine's." So what this
// point decides is Spectra's half — that every one of those facts reaches the
// panel — and that the sources are pure reads.
//
// HOW THE LINES ARE READ. The engine draws the overlay after the pipeline renders,
// through the same context the harness records, so the text a steady frame draws
// WITHOUT the overlay is collected first and the text a frame draws WITH it
// second; the difference is the overlay's own lines. The engine's own two lines —
// the world line `level: … phase: … actors: …` and the metrics line `frame: … ms`
// — are dropped from that difference wherever a reading compares two panels,
// because the engine docs fix both formats and neither is Spectra's to register.
//
// THE FACTS ARE READ IN TWO DIFFERENT WAYS, BECAUSE THEY ARE TWO DIFFERENT KINDS
// OF FACT.
//
//   1. A FACT WITH A VALUE is read as its value. Every figure below is checked as
//      a whole run of digits rather than as a substring, so a `9` on the panel is
//      not answered by the `9` inside some other number, and the field is posed so
//      that no two of the values asserted share a figure. Three of them cannot be
//      made unique — a bullet count, a burst count and an entity id are all small
//      integers — and those are the weakest readings here. The two DURATIONS are
//      looser still, and deliberately: seconds remaining is a quantity a build may
//      honestly print in seconds, in tenths, or in milliseconds, so each is
//      accepted at any of those scales. The screen, the phase, and the three
//      yes/no facts are matched as words, in every form a build would honestly
//      draw them in.
//
//   2. A FACT WITH NO SPELLING is read by CHANGING IT. A drone's kind, its stored
//      band, its phase, a Flux's shimmer, a Prism's shell and the ship's band are
//      all named by the specification and spelled by nobody: it asks that each
//      line be "short enough to read on a line", so `shard`, `s` and a colour
//      swatch of a glyph are all honest answers and no pattern can accept them
//      all. What CAN be decided is sensitivity: the same field is posed twice,
//      differing in exactly that one fact, and the panel a build draws must differ
//      between the two. A panel that never reports the fact cannot. The two poses
//      are each opened by `reset({ seed })`, which "sets… the counter the next
//      entity's id is taken from back to the first id, so two runs reset with the
//      same seed report the same ids for the same scenario"
//      (specs/instrumentation.md) — so the drone in both halves carries the same
//      id at the same point, and the one thing left to tell them apart is the fact
//      under test.
//
// THE VALUE HALF IS POSED AND THEN PAUSED. specs/ui.md freezes the field behind
// the pause menu — "no drone moves, no bullet travels, no phase timer runs, none
// of the clocks the wave keeps advances… so a paused game is exactly where it was
// when it was paused" — which is what makes "the snapshot is identical before and
// after" a reading about the OVERLAY rather than about the two frames of play that
// ran underneath it. A live inversion, a fire lockout and a playing burst cannot
// be held still any other way, and the overlay must report all three.
//
// PURITY is read straight off the snapshot: identical across the toggle apart from
// `simTime`, which is set aside because the specification does not fix whether a
// paused game runs sub-steps at all — `simTime` "accumulates the time the game's
// sub-steps cover", and specs/ui.md freezes the field — so a build that advances
// it across the toggle and one that does not are both conformant.
//
// WHAT THIS DOES NOT DECIDE. That the STORED and the EFFECTIVE band are drawn as a
// pair: the sensitivity readings below separate a build that reports a drone's
// band from one that reports none, and the shell reading moves a Prism's effective
// band while its stored band holds, but no line structure is fixed by any
// specification and the captured image is what a reviewer reads the pairing off.
// Nor the binding, nor that the panel is off when the game starts, which are
// `controls.overlay-backquote`'s.

import { afterEach, beforeEach, it } from "vitest";
import {
  PLAYER_BULLET_HALF,
  PLAYER_BULLET_SPEED,
  RESONANCE_MAX,
  SHARD_HALF,
  fluxHold,
  fluxWindow,
} from "../../src/constants";
import { assertDeepEqual, assertEqual, assertNotEqual, fail } from "../assert";
import {
  captureStill,
  createHarness,
  drawnText,
  droneById,
  poseDrone,
  poseEnemyBullet,
  posePlayerBullet,
  resetTo,
  startPosed,
  ticksFor,
  toggleOverlay,
  type Harness,
} from "../harness";
import { requireDrone } from "./crowded-field";

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
 * `fluxWindow(9)` (`1.60` s) — so the Flux is shimmering, which is one of the
 * facts the panel must carry.
 */
const BAND_CLOCK = 1.5;

/** Where the drones popped for their bursts stand, in clear columns of their own. */
const POP_AT: readonly { x: number; y: number }[] = [
  { x: 600, y: 520 },
  { x: 760, y: 520 },
];

/**
 * How far below a popped drone its shot starts, and the frames it is allowed.
 *
 * A Shard's contact reach is `SHARD_HALF` (`14`) plus `PLAYER_BULLET_HALF` (`6`),
 * so three times that puts the bullet in flight rather than in contact; the climb
 * to the edge of the reach at `PLAYER_BULLET_SPEED` (`760`) is six frames of the
 * suite's 100 Hz clock, and four times that leaves ample slack for whichever
 * sub-step a build resolves the contact on.
 */
const TOUCHING = SHARD_HALF + PLAYER_BULLET_HALF;
const SHOT_BELOW = 3 * TOUCHING;
const SHOT_FRAMES = 4 * ticksFor((SHOT_BELOW - TOUCHING) / PLAYER_BULLET_SPEED);

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

/** The seed the two halves of every sensitivity reading are opened with. */
const TWIN_SEED = 3;

/** Where the twin's one drone stands: mid-field, clear of both HUD strips. */
const TWIN_AT = { x: 640, y: 300 } as const;

/**
 * The band clock a twin's Flux shimmers at, in seconds.
 *
 * A tenth past `fluxHold(1)` (`1.6` s) and well short of `fluxWindow(1)` (`2.0`),
 * so the Flux is settled on neither band (specs/drones.md) while the twin's other
 * half, at `0`, is holding its band.
 */
const TWIN_SHIMMER_CLOCK = fluxHold(1) + 0.1;

/**
 * The engine's own overlay lines, which no game registers and no build controls.
 *
 * The engine docs fix both formats — a world line `level: … phase: … actors: …`
 * and a metrics line `frame: … / … / … ms` — and the metrics line carries a
 * different wall-clock figure on every read, so a comparison of two panels drops
 * them and reads the sources Spectra registered.
 */
const ENGINE_LINES = /^\s*(level|frame):\s/;

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
      `an overlay line carrying ${what} (${seconds} s, as any of ` +
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

it("draws every registered value and changes nothing in the game", async () => {
  startPosed(h);

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

  // The bursts, which can only be outcomes: two Shards destroyed by matching
  // shots. They are popped at stage 1, before the stage below is posed.
  for (const at of POP_AT) {
    const target = poseDrone(h, "shard", at.x, at.y, { band: "cyan" });
    posePlayerBullet(h, at.x, at.y + SHOT_BELOW, "cyan");
    const shot = await h.until((s) => droneById(s, target) === undefined, {
      maxFrames: SHOT_FRAMES,
    });
    if (!shot.hit) {
      fail(
        `the Shard at (${at.x}, ${at.y}) destroyed by a matching shot inside ` +
          `${SHOT_FRAMES} frames (specs/bands.md) — the panel must report the ` +
          `bursts playing, and nothing adds one but a kill`,
        `the drone was still on the field after ${SHOT_FRAMES} frames`,
      );
    }
  }

  // The bullets, placed after the shots so the roster holds exactly these.
  for (const at of FRIENDLY_AT) posePlayerBullet(h, at.x, at.y, "cyan");
  for (const at of ENEMY_AT) poseEnemyBullet(h, at.x, at.y, "magenta");

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
    requireDrone(posed, flux, "the Flux the panel reports").shimmer,
    true,
    `whether the Flux posed ${BAND_CLOCK} s into its window is shimmering at ` +
      `stage ${STAGE}, where fluxHold is ${fluxHold(STAGE)} s and the whole ` +
      `window is ${fluxWindow(STAGE)} s (specs/drones.md)`,
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
  // hidden when the engine is created and nothing has toggled it yet.
  h.calls.length = 0;
  await h.advance(1);
  const baseline = drawnText(h.calls);
  const before = h.snapshot();

  // …then the toggle, and the frame that draws the panel it opened.
  h.calls.length = 0;
  await toggleOverlay(h);
  const overlay = newLines(baseline, drawnText(h.calls));
  // The overlay drawn over the posed field.
  captureStill(h, "overlay");
  const after = h.snapshot();

  // ---- The facts that have a value ----------------------------------------

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

  // ---- And the game is exactly as it was ----------------------------------

  assertDeepEqual(
    { ...after, simTime: 0 },
    { ...before, simTime: 0 },
    "every diagnostic source is a pure read, so watching the overlay leaves " +
      "the game as it is (specs/instrumentation.md)",
  );

  // ---- The facts that have no spelling ------------------------------------
  //
  // The overlay is left DOWN here, which is where each reading below expects it.

  await toggleOverlay(h);

  /**
   * The panel Spectra's own sources drew over a field posed from a fresh,
   * identically seeded run.
   *
   * The bare frame is captured first and subtracted, so what comes back is the
   * overlay's own lines; the engine's two lines are dropped; and the overlay is
   * put back down for the next reading.
   */
  const panelOver = async (pose: () => void): Promise<string[]> => {
    resetTo(h, TWIN_SEED);
    startPosed(h);
    pose();

    h.calls.length = 0;
    await h.advance(1);
    const bare = drawnText(h.calls);

    h.calls.length = 0;
    await toggleOverlay(h);
    const lines = newLines(bare, drawnText(h.calls)).filter(
      (line) => !ENGINE_LINES.test(line),
    );

    await toggleOverlay(h);
    return lines;
  };

  /** Two fields differing in exactly one fact must draw two different panels. */
  const reports = async (
    fact: string,
    one: () => void,
    other: () => void,
  ): Promise<void> => {
    const first = (await panelOver(one)).join("\n");
    const second = (await panelOver(other)).join("\n");
    assertNotEqual(
      second,
      first,
      `the overlay's own lines over a field posed with ${fact} — the two ` +
        `fields are identical in every other respect, and both runs are ` +
        `opened by reset({ seed: ${TWIN_SEED} }) so the drone carries the ` +
        `same id at the same point in each, so a panel that reports the fact ` +
        `draws something different and one that omits it cannot ` +
        `(specs/instrumentation.md, Diagnostics)`,
    );
  };

  await reports(
    "a Shard, against the same field posed with a Flux (each drone's KIND)",
    () => {
      poseDrone(h, "shard", TWIN_AT.x, TWIN_AT.y, { band: "cyan" });
    },
    () => {
      poseDrone(h, "flux", TWIN_AT.x, TWIN_AT.y, { band: "cyan" });
    },
  );

  await reports(
    "a cyan Shard, against the same Shard storing magenta (a drone's BAND)",
    () => {
      poseDrone(h, "shard", TWIN_AT.x, TWIN_AT.y, { band: "cyan" });
    },
    () => {
      poseDrone(h, "shard", TWIN_AT.x, TWIN_AT.y, { band: "magenta" });
    },
  );

  await reports(
    "a Shard resting in formation, against the same Shard diving (its PHASE)",
    () => {
      poseDrone(h, "shard", TWIN_AT.x, TWIN_AT.y, {
        band: "cyan",
        phase: "formation",
      });
    },
    () => {
      poseDrone(h, "shard", TWIN_AT.x, TWIN_AT.y, {
        band: "cyan",
        phase: "diving",
      });
    },
  );

  await reports(
    `a Flux holding its band, against the same Flux ${TWIN_SHIMMER_CLOCK} s ` +
      `into a window whose held part is fluxHold(1) = ${fluxHold(1)} s, so it ` +
      `is SHIMMERING (specs/drones.md)`,
    () => {
      poseDrone(h, "flux", TWIN_AT.x, TWIN_AT.y, {
        band: "cyan",
        bandClock: 0,
      });
    },
    () => {
      poseDrone(h, "flux", TWIN_AT.x, TWIN_AT.y, {
        band: "cyan",
        bandClock: TWIN_SHIMMER_CLOCK,
      });
    },
  );

  await reports(
    "a Prism with its shell intact, against the same Prism with its shell " +
      "broken (its SHELL state, and with it the band its exposed layer reads " +
      "as, specs/bands.md)",
    () => {
      poseDrone(h, "prism", TWIN_AT.x, TWIN_AT.y, {
        band: "cyan",
        shell: true,
      });
    },
    () => {
      poseDrone(h, "prism", TWIN_AT.x, TWIN_AT.y, {
        band: "cyan",
        shell: false,
      });
    },
  );

  await reports(
    "the ship on cyan, against the same field with the ship on magenta (the " +
      "SHIP'S BAND)",
    () => h.debug.setShipBand("cyan"),
    () => h.debug.setShipBand("magenta"),
  );
});
