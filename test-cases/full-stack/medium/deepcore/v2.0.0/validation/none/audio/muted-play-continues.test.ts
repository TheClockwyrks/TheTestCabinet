// audio/muted-play-continues — muting changes nothing but the sound.
//
// `specs/instrumentation.md` makes `muted` a player preference a `reset` leaves
// alone, and `specs/controls.md` has the mute action toggle "all audio" and
// nothing else. So the requirement is that the simulation is untouched by it: one
// identical scenario, driven once unmuted and once muted, has to reach exactly the
// same state.
//
// THE SCENARIO IS THE SAME ONE TWICE, not two similar ones. Both runs open from a
// `reset` on the same seed, lay the same floor and the same ore cell, stand the
// miner on the same cell with its travel held, hold the same key until the cell
// breaks, and then run the same span of game time. Everything the snapshot reports
// about the miner, the bay and the clock is compared, and the cell that was cut is
// read back too.
//
// Whether the cues FIRE at the same moments while muted is not readable from
// outside an engineless build: `audio-init.js` sees a source being started, and a
// build that mutes by declining to start one is as conformant as one that mutes
// through a master gain. So what is decided here is the half that is readable, and
// it is the half that matters to a player who unmutes mid-descent.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { PLAYABLE_COL_MIN } from "../constants";
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
  type DeepcoreSnapshot,
} from "../harness";
import { armAudio } from "./probe";

const ROW = 300;
const COL = PLAYABLE_COL_MIN + 8;
const ORE = "voltite" as const;

/** How long the scenario runs on after the cut, and in how many frames. */
const AFTER_SECONDS = 2;
const AFTER_FRAMES = 120;

/** Everything about the run that muting must leave exactly as it was. */
function outcome(snapshot: DeepcoreSnapshot, broke: boolean): string {
  const { miner, cargo, satchel } = snapshot;
  return JSON.stringify({
    broke,
    simTime: snapshot.simTime,
    x: miner.x,
    y: miner.y,
    vx: miner.vx,
    vy: miner.vy,
    state: miner.state,
    fuel: miner.fuel,
    hull: miner.hull,
    slotsUsed: cargo.slotsUsed,
    loadKg: cargo.loadKg,
    ore: cargo.ore,
    satchel,
  });
}

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("reaches the same state muted and unmuted", async () => {
  const armed = await armAudio(h);

  const dig = async (muted: boolean): Promise<string> => {
    await openScene(h);
    await h.debug.setMuted(muted);
    await layFloor(h, ROW);
    await layOre(h, COL, ROW, ORE);
    await standOn(h, COL, ROW);
    await pinMiner(h);
    const cut = await driveCut(h, "down", { col: COL, row: ROW });
    await h.advanceSeconds(AFTER_SECONDS, AFTER_FRAMES);
    return outcome(await h.snapshot(), cut.broke);
  };

  const both = await captureReplay(h, "same", async () => ({
    loud: await dig(false),
    quiet: await dig(true),
  }));

  assertEqual(armed, true, "specs/assets.md");
  assertEqual(both.quiet, both.loud, "specs/controls.md");
});
