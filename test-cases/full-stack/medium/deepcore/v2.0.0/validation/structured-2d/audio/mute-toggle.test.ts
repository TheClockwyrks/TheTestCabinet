// audio/mute-toggle — the mute action silences the audio.
//
// `specs/controls.md`: the `mute` action toggles all audio.
//
// TWO ROUTES, TWO POINTS. `specs/ui.md` also puts a mute control on the status
// bar, and a build that binds the key and never wires the bar control must grade
// differently from one that wires neither. The bar's route is
// `audio/mute-control-toggles`.
//
// AND THE SILENCE ITSELF IS READABLE HERE. The engine owns the audio bus, and it
// announces a play on a muted bus at `gain: 0` (`engine/audio.md`) — so a cut
// driven while muted must sound its cues at no gain at all. That is the whole of
// "no cue is audible while muted", read from outside the build: the game still
// reacts, the events still arrive, and nothing comes out. Requiring the build to
// stop asking for cues instead would fail a build that mutes through the bus,
// which is the route the engine provides.

import { afterEach, beforeEach, it } from "vitest";
import { PLAYABLE_COL_MIN } from "../constants";
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

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("mutes on the key, and a cut driven muted sounds at no gain", async () => {
  openScene(h);
  layCamp(h);
  standAtCamp(h);
  await h.advance(2);

  const opened = h.snapshot().muted;
  await h.tap(ACTION_KEY.mute);
  // The snapshot carries the game's copy of the engine's bit, refreshed every
  // update, so one frame past the press is where it is read.
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
  assertEqual(
    muted,
    true,
    "specs/controls.md: the mute action toggles all audio",
  );
  assertGreaterThan(heard.length, 0, "specs/assets.md");
  assertEqual(
    audible.map((entry) => entry.cue).join(", "),
    "",
    "specs/controls.md: no cue is audible while muted",
  );
});
