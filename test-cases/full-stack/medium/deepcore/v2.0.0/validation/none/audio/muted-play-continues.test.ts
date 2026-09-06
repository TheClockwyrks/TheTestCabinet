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
import { armAudio } from "./probe";

const ROW = 300;
const COL = PLAYABLE_COL_MIN + 8;
const ORE = "voltite" as const;

/** How long the scenario runs on after the cut, and in how many frames. */
const AFTER_SECONDS = 2;
const AFTER_FRAMES = 120;

/**
 * Decimal places the clock is held to over that span.
 *
 * `simTime` is a sum of the frames' deltas, so two correct builds can differ by
 * the rounding of a hundred and twenty additions; a build whose clock stood
 * still while muted is off by the whole span.
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
  const armed = await armAudio(h);
  await openScene(h);
  await h.debug.setMuted(true);
  await layFloor(h, ROW);
  await layOre(h, COL, ROW, ORE);
  await standOn(h, COL, ROW);
  await pinMiner(h);
  const muted = (await h.snapshot()).muted;

  const run = await captureReplay(h, "muted", async () => {
    const cut = await driveCut(h, "down", { col: COL, row: ROW });
    await h.advanceSeconds(AFTER_SECONDS, AFTER_FRAMES);
    return { cut, after: await h.snapshot() };
  });

  assertEqual(armed, true, "specs/assets.md");
  assertEqual(muted, true, "specs/instrumentation.md");
  assertEqual(run.cut.broke, true, "specs/character.md");
  assertEqual(run.cut.tile.kind, "tunnel", "specs/character.md");
  assertEqual(run.after.cargo.ore[ORE], 1, "specs/mining.md");
  assertEqual(run.after.cargo.slotsUsed, 1, "specs/mining.md");
  assertEqual(run.after.cargo.loadKg, ORES[ORE].weight, "specs/mining.md");
  assertCloseTo(
    run.after.simTime - run.cut.snapshot.simTime,
    AFTER_SECONDS,
    CLOCK_DIGITS,
    "specs/instrumentation.md: simTime accumulates the delta of every update, muted or not",
  );
});
