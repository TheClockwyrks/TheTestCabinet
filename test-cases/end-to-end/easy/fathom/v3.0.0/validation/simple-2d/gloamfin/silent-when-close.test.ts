// gloamfin/silent-when-close — it goes silent while it holds you by ear.
//
// THE CLAIM. `specs/predators/gloamfin.md` makes the ping conditional on the lock:
// the timer casts "provided at least `GLOAMFIN_PING_MIN_GAP` (`3 s`) has passed
// since its last ping and `hearingLock` is false", and "a Gloamfin that holds a
// close-range hearing lock is silent for as long as it holds it, and pings as soon
// as the lock breaks". The timer itself "runs down every step, whatever the
// Gloamfin is doing", so by the time a lock has held for two whole
// `GLOAMFIN_PING_INTERVAL` (`4 s`) cadences the ping is long overdue — and it must
// still not have gone.
//
// THE PAIR IS WALLED IN, EACH ON A TILE OF ITS OWN, DIAGONALLY ADJACENT. That does
// two things nothing else does as cleanly. Neither body has an open neighbor, and
// `specs/movement.md` keeps a body on such a tile, so the eight seconds cannot end
// in the Gloamfin reaching the forager and taking a life — and the lock is held by
// standing still rather than by re-posing either of them under the measurement.
// And `45.25` logical units is comfortably inside the `GLOAMFIN_HEAR` (`64`) close
// hearing reaches, where two tiles along a corridor is exactly `64` and would ask
// whether a build reads "at most" as `<=` or `<`.
//
// THE LOCK IS THEN BROKEN WITHOUT TOUCHING THE GLOAMFIN. `setForagerTile` moves the
// forager to a sealed pocket seven tiles off (`specs/instrumentation.md`), which is
// three and a half times the hearing range: nothing about the Gloamfin changes, and
// the only thing that has is whether it can still hear.
//
// WHAT THIS DOES NOT DECIDE. What the cadence is (`gloamfin/ping-cadence`), what
// the floor is (`gloamfin/ping-floor`), or that close hearing takes a fix at all
// (`gloamfin/fix-and-alert`).

import { afterEach, beforeEach, it } from "vitest";
import {
  assertDeepEqual,
  assertEqual,
  assertLessThanOrEqual,
  assertTrue,
} from "../assert";
import {
  GLOAMFIN_HEAR,
  GLOAMFIN_PING_INTERVAL,
  TICK_HZ,
} from "../../src/constants";
import { placeForager, poseMaze, spawnPredator } from "../fixtures";
import {
  captureReplay,
  createHarness,
  startPlaying,
  type Harness,
} from "../harness";
import { FathomSnapshot } from "../surface";
import { parkForager, requireSceneHeld, sceneGuard } from "../scene";
import { apart, gloamfinOf, sweep } from "./pings";

/**
 * The fixture: the forager walled into `F`, the Gloamfin walled into `G`
 * diagonally below it, and `R` a sealed pocket seven tiles away.
 */
const SEALED_PAIR = ["F#      R..", "#G"];

/**
 * The silence, in ticks, split into what runs off camera and what a clip is made
 * of.
 *
 * Eight seconds is two whole `GLOAMFIN_PING_INTERVAL` cadences, so a Gloamfin that
 * merely delayed its ping rather than withholding it has run out of excuses twice
 * over. The last two seconds are recorded, and the clip then runs on through the
 * break and the ping that follows it.
 */
const SILENCE_TICKS = 8 * TICK_HZ;
const RECORDED_TICKS = 2 * TICK_HZ;
const OFF_CAMERA_TICKS = SILENCE_TICKS - RECORDED_TICKS;

/**
 * Ticks between a pose and the reading taken of it.
 *
 * Two. A build may take the distance at the top of a step and raise the lock on
 * the next, and nothing fixes that order, so no reading here is taken on the tick a
 * flag could be turning over.
 */
const SETTLE_TICKS = 2;

/**
 * How long the ping may take to arrive once the lock has broken, in ticks.
 *
 * One second. The timer "runs down every step, whatever the Gloamfin is doing", so
 * after eight seconds of silence it is four seconds past due and the floor — three
 * seconds since a ping that never went — is long clear: the specification's "pings
 * as soon as the lock breaks" leaves a conforming build nothing to wait for. A
 * second is a quarter of the ordinary cadence, so a build that merely restarted its
 * timer on the break fails this rather than sliding past it.
 */
const BREAK_BUDGET = TICK_HZ;

/** Ticks the clip runs on for past the ping, so the wavefront is on screen. */
const TAIL_TICKS = 40;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("It goes silent while it holds you by ear", async () => {
  await startPlaying(h);
  const board = await poseMaze(h, SEALED_PAIR);
  // The lock and the silence are its mind's, so its mind runs and its travel is
  // held: the pair stands the separation the fixture walled them into.
  const index = await spawnPredator(h, "gloamfin", board.mark("G"), {
    state: "wander",
    travel: false,
  });
  await placeForager(h, board.mark("F"), "right");
  // The forager is moved by this scenario on purpose, so the guard watches
  // everything else: a life lost, the dive leaving live play, a denned hunter
  // loose.
  const guard = await sceneGuard(h, { foragerParked: false });

  await h.advance(SETTLE_TICKS);
  const opening = h.snapshot();
  const openingGloamfin = gloamfinOf(opening, index);

  let lockHeld = true;
  let heardAPing = false;
  const watchSilence = (snap: FathomSnapshot): void => {
    if (gloamfinOf(snap, index).hearingLock !== true) lockHeld = false;
    if (snap.pulses.some((pulse) => pulse.source === "gloamfin")) {
      heardAPing = true;
    }
  };

  await sweep(h, OFF_CAMERA_TICKS, watchSilence);
  const broke = await captureReplay(h, "silent", async () => {
    await sweep(h, RECORDED_TICKS, watchSilence);
    const held = h.snapshot();
    // The lock is broken by moving the forager alone. Nothing touches the
    // Gloamfin, so the only thing that changed is what it can hear.
    await parkForager(h, board.mark("R"));
    await h.advance(SETTLE_TICKS);
    const apartNow = h.snapshot();
    const ping = await h.until(
      (snap) => snap.pulses.some((pulse) => pulse.source === "gloamfin"),
      { maxFrames: BREAK_BUDGET, poll: 1 },
    );
    // Past the reading, so the clip carries the wavefront it is about.
    await h.advance(TAIL_TICKS);
    return { held, apartNow, ping };
  });

  requireSceneHeld(h.snapshot(), guard);

  // The scenario stood as posed: the pair inside hearing range, and neither of
  // them anywhere but the tile it was walled into.
  assertLessThanOrEqual(
    apart(opening.forager, openingGloamfin),
    GLOAMFIN_HEAR,
    `logical units between the two centers at the start, against the ` +
      `GLOAMFIN_HEAR (${GLOAMFIN_HEAR}) close hearing reaches`,
  );
  assertDeepEqual(
    { tx: broke.held.forager.tx, ty: broke.held.forager.ty },
    { tx: board.mark("F").tx, ty: board.mark("F").ty },
    "the tile the forager held for the whole silence — specs/movement.md keeps " +
      "a body on a tile whose neighbors are all closed to it",
  );

  assertEqual(
    openingGloamfin.hearingLock,
    true,
    "hearingLock with the forager standing inside GLOAMFIN_HEAR — " +
      "specs/predators/gloamfin.md holds the lock while the two centers are that " +
      "close, in the dark and through rock",
  );
  assertTrue(
    lockHeld,
    `hearingLock stayed true for the whole ${SILENCE_TICKS / TICK_HZ} s the ` +
      `forager stood inside GLOAMFIN_HEAR`,
  );
  assertTrue(
    !heardAPing,
    `the Gloamfin cast no ping at all across ${SILENCE_TICKS / TICK_HZ} s of ` +
      `hearing lock, which is two whole GLOAMFIN_PING_INTERVAL ` +
      `(${GLOAMFIN_PING_INTERVAL} s) cadences — specs/predators/gloamfin.md ` +
      `casts only while hearingLock is false, and a Gloamfin holding a lock "is ` +
      `silent for as long as it holds it"`,
  );

  assertEqual(
    gloamfinOf(broke.apartNow, index).hearingLock,
    false,
    `hearingLock once the forager stood ` +
      `${apart(broke.apartNow.forager, gloamfinOf(broke.apartNow, index)).toFixed(0)} ` +
      `logical units off, beyond the GLOAMFIN_HEAR (${GLOAMFIN_HEAR}) close ` +
      `hearing reaches`,
  );
  assertTrue(
    broke.ping.hit,
    `a ping arrived within ${BREAK_BUDGET} ticks ` +
      `(${BREAK_BUDGET / TICK_HZ} s) of the lock breaking — ` +
      `specs/predators/gloamfin.md has the Gloamfin ping "as soon as the lock ` +
      `breaks", and its timer has been running down throughout the silence`,
  );
});
