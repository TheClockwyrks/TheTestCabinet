// audio/mute-toggle — the mute action silences the audio.
//
// `specs/controls.md`: the `mute` action toggles all audio, and
// `specs/instrumentation.md` has the snapshot mirror the bit the runtime holds.
//
// TWO ROUTES, TWO POINTS. `specs/ui.md` also puts a mute control on the status
// bar, and a build that binds the key and never wires the bar control must grade
// differently from one that wires neither. The bar's route is
// `audio/mute-control-toggles`.
//
// THE EVIDENCE IS A CUT DRIVEN WHILE MUTED, which is the clip the review item
// asks for: the game still reacts and the cell still breaks, with the audio off.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { PLAYABLE_COL_MIN } from "../constants";
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
import { armAudio } from "./probe";

const ROW = 200;
const COL = PLAYABLE_COL_MIN + 8;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("mutes on the key, and the game plays on with the audio off", async () => {
  const armed = await armAudio(h);
  await openScene(h);
  await layCamp(h);
  await standAtCamp(h);

  const opened = (await h.snapshot()).muted;
  await h.tap(ACTION_KEY.mute);
  const muted = (await h.snapshot()).muted;

  await layFloor(h, ROW);
  await standOn(h, COL, ROW);
  await pinMiner(h);
  const cut = await captureReplay(h, "muted", () =>
    driveCut(h, "down", { col: COL, row: ROW }),
  );

  assertEqual(armed, true, "specs/assets.md");
  assertEqual(opened, false, "specs/instrumentation.md");
  assertEqual(
    muted,
    true,
    "specs/controls.md: the mute action toggles all audio",
  );
  assertEqual(cut.broke, true, "specs/mining.md");
});
