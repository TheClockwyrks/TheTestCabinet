// audio/mute-toggle — both mute controls toggle the audio.
//
// `specs/controls.md`: the `mute` action toggles all audio. `specs/ui.md`: the
// status bar carries a mute control, and every status-bar control is clickable. So
// both routes are driven over one scene and each must flip the bit
// `specs/instrumentation.md` has the snapshot mirroring from the runtime.
//
// WHAT SILENCE ITSELF IS NOT. `audio-init.js` sees a source being started, not
// whether anything came out of it. Muting through a master gain and muting by
// declining to start a source are both ordinary implementations and
// `specs/assets.md` requires neither, so a check that demanded no source start
// while muted would fail half the conformant builds. The bit is therefore what is
// decided here, and a reviewer decides by ear that the game actually goes quiet.
//
// The bar's control carries no fixed copy — `specs/ui.md` fixes only that it is ON
// the bar — so it is found by sweeping the band, which is what
// `panels/mouse.ts` exists for. A cut is driven while muted for the evidence the
// review item asks for.

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
import { sweepStatusBar } from "../panels/mouse";
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

it("toggles the mute bit from the key and from the status bar", async () => {
  const armed = await armAudio(h);
  await openScene(h);
  await layCamp(h);
  await standAtCamp(h);

  const opened = (await h.snapshot()).muted;
  await h.tap(ACTION_KEY.mute);
  const afterKey = (await h.snapshot()).muted;

  const clicked = await sweepStatusBar(
    h,
    async () => (await h.snapshot()).muted !== afterKey,
    async () => {
      await h.debug.setPanel(null);
      await h.debug.setScreen("in-mine");
    },
  );
  const afterClick = (await h.snapshot()).muted;

  await h.debug.setMuted(true);
  await layFloor(h, ROW);
  await standOn(h, COL, ROW);
  await pinMiner(h);
  const cut = await captureReplay(h, "muted", () =>
    driveCut(h, "down", { col: COL, row: ROW }),
  );

  assertEqual(armed, true, "specs/assets.md");
  assertEqual(opened, false, "specs/instrumentation.md");
  assertEqual(afterKey, true, "specs/controls.md");
  assertEqual(clicked, true, "specs/ui.md");
  assertEqual(afterClick, false, "specs/ui.md");
  assertEqual(cut.broke, true, "specs/mining.md");
});
