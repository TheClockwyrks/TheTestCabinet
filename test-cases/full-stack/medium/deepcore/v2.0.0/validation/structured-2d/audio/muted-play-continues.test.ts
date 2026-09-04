// audio/muted-play-continues — muting changes nothing but the sound.
//
// `specs/instrumentation.md` makes `muted` a player preference a `reset` leaves
// alone, and `specs/controls.md` has the mute action toggle "all audio" and
// nothing else. So the requirement is that the simulation is untouched by it: one
// identical scenario, driven once unmuted and once muted, has to reach exactly the
// same state and raise exactly the same cues at exactly the same moments.
//
// THE SCENARIO IS THE SAME ONE TWICE, not two similar ones. Both runs open from a
// `reset` on the same seed, lay the same floor and the same ore cell, stand the
// miner on the same cell with its travel held, hold the same key until the cell
// breaks, and then run the same span of game time. Everything the snapshot reports
// about the miner, the bay and the clock is compared, and the cell that was cut is
// read back too.
//
// AND THE CUES ARE COMPARED, which is the half the engineless project cannot
// reach. The engine announces every play and loop start by name on a muted bus
// exactly as it does on an unmuted one, only at `gain: 0` (`engine/audio.md`), so
// the two runs' cue transcripts — each cue's name against the frame of its own run
// it sounded on — must be identical. A build that stops asking for cues while
// muted is caught here, and a player turning the sound back on mid-descent picks
// up a game that never skipped a beat.
//
// The bed is started before either run is measured, so its one loop belongs to
// neither transcript. The bus is muted with the mute action rather than posed,
// because the engine owns the bit and the surface does not carry it.

import { afterEach, beforeEach, it } from "vitest";
import { PLAYABLE_COL_MIN } from "../constants";
import { assertEqual } from "../assert";
import {
  ACTION_KEY,
  captureReplay,
  createHarness,
  driveCut,
  layFloor,
  layOre,
  openScene,
  pinMiner,
  standOn,
  type DeepcoreSnapshot,
  type Harness,
} from "../harness";
import { over, transcript, watchAudio, type AudioLog } from "./cues";

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
let log: AudioLog;

beforeEach(async () => {
  h = await createHarness();
  log = watchAudio(h);
});

afterEach(() => {
  h?.dispose();
});

it("reaches the same state and sounds the same cues muted and unmuted", async () => {
  // The bed starts on the first frame the game runs, so it is started here rather
  // than inside the first of the two runs, where it would land in one transcript
  // and not the other.
  openScene(h);
  await h.advance(2);

  const dig = async (): Promise<{ outcome: string; cues: string[] }> => {
    openScene(h);
    layFloor(h, ROW);
    layOre(h, COL, ROW, ORE);
    standOn(h, COL, ROW);
    pinMiner(h);
    let broke = false;
    const window = await over(h, async () => {
      broke = (await driveCut(h, "down", { col: COL, row: ROW })).broke;
      await h.advanceSeconds(AFTER_SECONDS, AFTER_FRAMES);
    });
    return {
      outcome: outcome(h.snapshot(), broke),
      cues: transcript(log, window),
    };
  };

  const both = await captureReplay(h, "same", async () => {
    const loud = await dig();
    await h.tap(ACTION_KEY.mute);
    await h.advance(1);
    const muted = h.snapshot().muted;
    const quiet = await dig();
    return { loud, quiet, muted };
  });

  assertEqual(both.muted, true, "specs/controls.md");
  assertEqual(both.quiet.outcome, both.loud.outcome, "specs/controls.md");
  assertEqual(
    both.quiet.cues.join(", "),
    both.loud.cues.join(", "),
    "specs/controls.md",
  );
});
