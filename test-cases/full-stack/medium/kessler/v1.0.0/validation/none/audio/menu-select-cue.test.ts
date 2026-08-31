// audio/menu-select-cue — confirm accepting a menu entry plays the
// menu-select cue exactly once.
//
// specs/screens.md, on the menus: "`confirm` accepts the highlighted entry
// and plays the `menu-select` cue."
//
// THE SCENE IS THE TITLE MENU AT ITS BOOT STATE, and the accepted entry is
// the highlighted START. `Enter` is the key pressed: it carries `confirm`
// alone, while `Space` also carries `launch`, and which bound keys fire is
// the controls category's concern. Where the accept lands — a fresh session
// on `playing` — is the screens category's point and goes unasserted; what
// is counted is the one play of the cue the accept makes.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { BINDINGS } from "../constants";
import {
  captureStill,
  cuesNamed,
  onCue,
  openHarness,
  tap,
  type Harness,
} from "../harness";

/** The cue specs/screens.md has an accepted entry play. */
const CUE = "menu-select";

/** The key that carries `confirm` alone — `Space` also carries `launch`. */
const CONFIRM = BINDINGS.confirm[1];

let h: Harness;

beforeEach(async () => {
  h = await openHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("sounds menu-select exactly once for the accepted entry", async () => {
  await h.armAudio();
  await h.reset();

  const cues = onCue(h);
  await tap(h, CONFIRM);
  await h.snapshot(); // drains the cue log before the count
  await captureStill(h, "confirmed");

  assertEqual(
    cuesNamed(cues, CUE).length,
    1,
    `${CUE} plays for the accepted entry`,
  );
});
