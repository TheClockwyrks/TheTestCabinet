// audio/muted-play-continues — muting changes nothing but the sound.
//
// `specs/instrumentation.md` makes `muted` a player preference a `reset` leaves
// alone, and `specs/controls.md` has the mute action toggle "all audio" and
// nothing else. So the requirement is that the simulation is untouched by it: a
// cut driven while muted breaks its cell as `specs/character.md` says a cut does,
// banks its ore as `specs/mining.md` says a broken ore cell does, and the clock
// `specs/instrumentation.md` has accumulate every update keeps accumulating.
//
// THE READING IS THE MUTED RUN AGAINST THE SPECIFICATION, not against an unmuted
// one. Each figure the muted run is held to is a figure the specs state: the cell
// reads as tunnel, the bay holds one unit of the ore at that ore's own weight, and
// the game time run after the break is the game time that was driven. A build
// that halts, slows or skips the world while muted misses one of them.
//
// Whether the cues FIRE at their moments while muted is not readable from
// outside an engineless build: `audio-init.js` sees a source being started, and a
// build that mutes by declining to start one is as conformant as one that mutes
// through a master gain. So what is decided here is the half that is readable, and
// it is the half that matters to a player who turns the sound back on mid-descent.
// Nothing here waits on the build's audio to start, either: the mute is posed
// through `setMuted`, and whether the build produces sound at all is what the
// audio items around this one decide.

import { afterEach, beforeEach, it } from "vitest";
import { assertCloseTo, assertEqual } from "../assert";
import { ORES, PLAYABLE_COL_MIN } from "../constants";
import {
  captureReplay,
  createHarness,
  driveCut,
  layFloor,
  layOre,
  openScene,
  pinMiner,
  standOn,
  type Harness,
} from "../harness";

/** A topsoil cell, so the cut is the shortest a band allows. */
const ROW = 12;
const COL = PLAYABLE_COL_MIN + 8;
const ORE = "voltite" as const;

/**
 * How long the scenario runs on after the cut, and in how many frames.
 *
 * One second is enough to read: a build whose clock stood still while muted is
 * off by the whole span, and the cut before it already holds the world under
 * the mute for as long as the ore takes to break.
 */
const AFTER_SECONDS = 1;
const AFTER_FRAMES = 60;

/**
 * Frames the recording settles for past the break, so the reviewer sees the
 * cell open and the ore banked. The clock's span runs after the recorder is
 * disarmed: a second of a miner standing still is nothing to watch, and the
 * frames a recording holds are what an engineless replay costs.
 */
const SETTLE_FRAMES = 15;

/**
 * Decimal places the clock is held to over that span.
 *
 * `simTime` is a sum of the frames' deltas, so two correct builds can differ by
 * the rounding of sixty additions; a build whose clock stood still while muted
 * is off by the whole span.
 */
const CLOCK_DIGITS = 3;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("breaks the cell, banks the ore and runs the clock on while muted", async () => {
  await openScene(h);
  await h.debug.setMuted(true);
  await layFloor(h, ROW);
  await layOre(h, COL, ROW, ORE);
  await standOn(h, COL, ROW);
  await pinMiner(h);
  const muted = (await h.snapshot()).muted;

  const cut = await captureReplay(h, "muted", async () => {
    const result = await driveCut(h, "down", { col: COL, row: ROW });
    await h.advance(SETTLE_FRAMES);
    return result;
  });
  // The span the clock is held to opens after the break has settled.
  const rested = (await h.snapshot()).simTime;
  await h.advanceSeconds(AFTER_SECONDS, AFTER_FRAMES);
  const run = { cut, rested, after: await h.snapshot() };

  assertEqual(muted, true, "specs/instrumentation.md");
  assertEqual(run.cut.broke, true, "specs/character.md");
  assertEqual(run.cut.tile.kind, "tunnel", "specs/character.md");
  assertEqual(run.after.cargo.ore[ORE], 1, "specs/mining.md");
  assertEqual(run.after.cargo.slotsUsed, 1, "specs/mining.md");
  assertEqual(run.after.cargo.loadKg, ORES[ORE].weight, "specs/mining.md");
  assertCloseTo(
    run.after.simTime - run.rested,
    AFTER_SECONDS,
    CLOCK_DIGITS,
    "specs/instrumentation.md: simTime accumulates the delta of every update, muted or not",
  );
});
