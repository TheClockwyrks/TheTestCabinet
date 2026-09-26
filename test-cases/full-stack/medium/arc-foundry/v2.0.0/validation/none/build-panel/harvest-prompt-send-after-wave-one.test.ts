// build-panel/harvest-prompt-send-after-wave-one — the panel prompts to SEND in every later build phase.
//
// `specs/hud.md` fixes the panel's harvest prompt as a non-clickable line reading
// `KEEP OR COMBINE A ROLL TO START` "before wave `1`" and
// `KEEP OR COMBINE A ROLL TO SEND` "during a build phase after wave `1`", which
// are `HARVEST_PROMPT_FIRST` and `HARVEST_PROMPT_LATER`.
//
// `specs/campaign.md` opens a run with the wave counter at `0` and numbers the
// waves from `1`, so the counter is what tells the opening build phase from every
// later one, and `setWave` moves it directly.
//
// TWO PROMPTS, TWO POINTS. The prompt is the only line telling the player how a
// wave is opened, and a build that draws the opening one and never changes it
// misleads them for the whole rest of the run while a build that draws only the
// later one leaves the first wave unexplained. Each prompt is decided in its own
// phase, and each is read in the positive AND in the negative, so a build drawing
// the same line in both phases fails one of the two points rather than half of
// one.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import {
  captureStill,
  createHarness,
  drew,
  type Harness,
  openYard,
  PANEL,
} from "../harness";
import { HARVEST_PROMPT_FIRST, HARVEST_PROMPT_LATER } from "../constants";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("prompts to SEND in a build phase after wave 1", async () => {
  await openYard(h, { wave: 0 });
  await h.debug.setWave(1);

  const later = await h.frameCalls();
  await captureStill(h, "prompt");
  assertEqual(
    drew(later, PANEL, HARVEST_PROMPT_LATER),
    true,
    "whether the panel prompts to SEND in a build phase after wave 1 " +
      "(specs/hud.md)",
  );
  assertEqual(
    drew(later, PANEL, HARVEST_PROMPT_FIRST),
    false,
    "whether the panel still prompts to START after wave 1 (specs/hud.md)",
  );
});
