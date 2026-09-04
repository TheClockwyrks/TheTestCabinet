// audio/mute-toggle — both mute controls toggle the audio, and a muted cue is silent.
//
// `specs/controls.md`: the `mute` action toggles all audio. `specs/ui.md`: the
// status bar carries a mute control, and every status-bar control is clickable. So
// both routes are driven over one scene and each must flip the bit
// `specs/instrumentation.md` has the snapshot mirroring from the runtime.
//
// AND THE SILENCE ITSELF IS READABLE HERE. The engine owns the audio bus, and it
// announces a play on a muted bus at `gain: 0` (`engine/audio.md`) — so a cut
// driven while muted must sound its cues at no gain at all. That is the whole of
// "no cue is audible while muted", read from outside the build: the game still
// reacts, the events still arrive, and nothing comes out. Requiring the build to
// stop asking for cues instead would fail a build that mutes through the bus,
// which is the route the engine provides.
//
// The bar's control carries no fixed copy — `specs/ui.md` fixes only that it is ON
// the bar, `y` in `[0, HUD_H]` — so it is found by sweeping the band with the
// mouse, which is what "operable with the mouse" means where no layout is fixed.
// The sweep searches the SCREEN for a control the specification requires to be
// somewhere on it; it never searches the world for a scenario to stand in.

import { afterEach, beforeEach, it } from "vitest";
import { HUD_H, PLAYABLE_COL_MIN, STAGE_W } from "../../src/constants";
import { assertEqual, assertGreaterThan } from "../assert";
import {
  ACTION_KEY,
  captureReplay,
  createHarness,
  driveCut,
  layCamp,
  layFloor,
  openScene,
  pinMiner,
  standAtCamp,
  standOn,
  type Harness,
} from "../harness";
import { over, soundedIn, watchAudio } from "./cues";

const ROW = 200;
const COL = PLAYABLE_COL_MIN + 8;

/** How far apart the sweep's columns sit, in logical units. */
const SWEEP_STEP = 16;

/** The rows of the status bar the sweep clicks along. */
const SWEEP_ROWS: readonly number[] = [HUD_H / 2, HUD_H / 4, (HUD_H * 3) / 4];

/**
 * Click along the status bar until `took` reports a control answered.
 *
 * `between` runs before each click, so a sweep whose earlier clicks landed on the
 * inventory or the pause control can put the game back where it started.
 */
async function sweepStatusBar(
  h: Harness,
  took: () => boolean,
  between: () => void,
): Promise<boolean> {
  for (const y of SWEEP_ROWS) {
    for (let x = SWEEP_STEP / 2; x < STAGE_W; x += SWEEP_STEP) {
      between();
      await h.click(x, y);
      if (took()) return true;
    }
  }
  return false;
}

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("toggles the mute bit from the key and from the status bar, and silences the cues", async () => {
  openScene(h);
  layCamp(h);
  standAtCamp(h);
  await h.advance(2);

  const opened = h.snapshot().muted;
  await h.tap(ACTION_KEY.mute);
  // The snapshot carries the game's copy of the engine's bit, refreshed every
  // update, so one frame past the press is where it is read.
  await h.advance(1);
  const afterKey = h.snapshot().muted;

  const clicked = await sweepStatusBar(
    h,
    () => h.snapshot().muted !== afterKey,
    () => {
      h.debug.setPanel(null);
      h.debug.setScreen("in-mine");
    },
  );
  const afterClick = h.snapshot().muted;

  // And a cut driven with the bus muted, which is the clip the review item asks
  // for and the reading that says the cues came out at no gain.
  await h.tap(ACTION_KEY.mute);
  await h.advance(1);
  const muted = h.snapshot().muted;
  layFloor(h, ROW);
  standOn(h, COL, ROW);
  pinMiner(h);

  const log = watchAudio(h);
  const cut = await captureReplay(h, "muted", () =>
    over(h, () => driveCut(h, "down", { col: COL, row: ROW })),
  );
  const heard = soundedIn(log, cut);
  const audible = heard.filter((entry) => entry.gain > 0);

  assertEqual(opened, false, "specs/instrumentation.md");
  assertEqual(afterKey, true, "specs/controls.md");
  assertEqual(clicked, true, "specs/ui.md");
  assertEqual(afterClick, false, "specs/ui.md");
  assertEqual(muted, true, "specs/controls.md");
  assertGreaterThan(heard.length, 0, "specs/assets.md");
  assertEqual(
    audible.map((entry) => entry.cue).join(", "),
    "",
    "specs/controls.md",
  );
});
