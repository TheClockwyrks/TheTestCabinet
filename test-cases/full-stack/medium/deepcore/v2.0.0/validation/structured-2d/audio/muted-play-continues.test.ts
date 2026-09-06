// audio/muted-play-continues — muting changes nothing but the sound.
//
// `specs/instrumentation.md` makes `muted` a player preference a `reset` leaves
// alone, and `specs/controls.md` has the mute action toggle "all audio" and
// nothing else. So the requirement is that the simulation is untouched by it: a
// cut driven while muted breaks its cell as `specs/character.md` says a cut does,
// banks its ore as `specs/mining.md` says a broken ore cell does, the clock
// `specs/instrumentation.md` has accumulate every update keeps accumulating, and
// the cues `specs/assets.md` ties to those moments still sound at them.
//
// THE READING IS THE MUTED RUN AGAINST THE SPECIFICATION, not against an unmuted
// one. Each figure the muted run is held to is a figure the specs state: the cell
// reads as tunnel, the bay holds one unit of the ore at that ore's own weight, and
// the game time run after the break is the game time that was driven. A build
// that halts, slows or skips the world while muted misses one of them.
//
// AND THE CUES ARE READ, which is the half the engineless project cannot reach.
// The engine announces every play and loop start by name on a muted bus exactly
// as it does on an unmuted one, only at `gain: 0` (`engine/audio.md`), so the
// `drill` cue must be audible while the cut is held and `ore-pickup` must sound
// within a frame of the break, as `audio/drill-loop` and `audio/ore-pickup-cue`
// read them unmuted. A build that stops asking for cues while muted is caught
// here, and a player turning the sound back on mid-descent picks up a game that
// never skipped a beat. The bus is muted with the mute action rather than posed,
// because the engine owns the bit and the surface does not carry it.

import { afterEach, beforeEach, it } from "vitest";
import { CUES, PLAYABLE_COL_MIN } from "../constants";
import { assertCloseTo, assertEqual, assertGreaterThan } from "../assert";
import {
  ACTION_KEY,
  captureReplay,
  createHarness,
  driveCut,
  layFloor,
  layOre,
  mineralOf,
  openScene,
  pinMiner,
  standOn,
  type Harness,
} from "../harness";
import { audibleIn, playsIn, watchAudio } from "./cues";

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

/** Frames either side of the break the pickup cue may land on. */
const SLACK = 1;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("breaks the cell, banks the ore, runs the clock on and sounds the cues while muted", async () => {
  openScene(h);
  await h.advance(2);
  await h.tap(ACTION_KEY.mute);
  // The snapshot carries the game's copy of the engine's bit, refreshed every
  // update, so one frame past the press is where it is read.
  await h.advance(1);
  const muted = h.snapshot().muted;

  layFloor(h, ROW);
  layOre(h, COL, ROW, ORE);
  standOn(h, COL, ROW);
  pinMiner(h);

  const log = watchAudio(h);
  const run = await captureReplay(h, "muted", async () => {
    const from = h.frame();
    const cut = await driveCut(h, "down", { col: COL, row: ROW });
    const broke = h.frame();
    await h.advance(SLACK);
    // The span the clock is held to opens after the break has settled.
    const rested = h.snapshot().simTime;
    await h.advanceSeconds(AFTER_SECONDS, AFTER_FRAMES);
    return {
      cut,
      cutting: { from, to: broke },
      broke,
      rested,
      after: h.snapshot(),
    };
  });

  const drilled = audibleIn(log, CUES.drill, run.cutting);
  const picked = playsIn(log, CUES.orePickup, {
    from: run.broke - SLACK - 1,
    to: run.broke + SLACK,
  });

  assertEqual(muted, true, "specs/controls.md");
  assertEqual(run.cut.broke, true, "specs/character.md");
  assertEqual(run.cut.tile.kind, "tunnel", "specs/character.md");
  assertEqual(run.after.cargo.ore[ORE], 1, "specs/mining.md");
  assertEqual(run.after.cargo.slotsUsed, 1, "specs/mining.md");
  assertEqual(
    run.after.cargo.loadKg,
    mineralOf(ORE).weightKg,
    "specs/mining.md",
  );
  assertCloseTo(
    run.after.simTime - run.rested,
    AFTER_SECONDS,
    CLOCK_DIGITS,
    "specs/instrumentation.md: simTime accumulates the delta of every update, muted or not",
  );
  assertEqual(
    drilled,
    true,
    "specs/assets.md: the drill cue plays while cutting",
  );
  assertGreaterThan(
    picked.length,
    0,
    "specs/assets.md: the ore-pickup cue plays when an ore is banked",
  );
});
