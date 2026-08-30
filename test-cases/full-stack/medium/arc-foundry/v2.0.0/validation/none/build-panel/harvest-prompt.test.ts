// build-panel/harvest-prompt — START before wave 1, SEND after it.
//
// `specs/hud.md` fixes the panel's harvest prompt as a non-clickable line reading
// `KEEP OR COMBINE A ROLL TO START` "before wave `1`" and
// `KEEP OR COMBINE A ROLL TO SEND` "during a build phase after wave `1`", which
// are `HARVEST_PROMPT_FIRST` and `HARVEST_PROMPT_LATER`.
//
// `specs/campaign.md` opens a run with the wave counter at `0` and numbers the
// waves from `1`, so the counter is what tells the opening build phase from every
// later one, and `setWave` moves it directly. Both prompts are read in both
// phases, so a build that draws the same line in each fails rather than passing
// on half the requirement.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import {
  captureStill,
  createHarness,
  openYard,
  type Harness,
} from "../harness";
import { HARVEST_PROMPT_FIRST, HARVEST_PROMPT_LATER } from "../constants";
import { PANEL, drew } from "./reading";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("prompts to START in the opening build phase and to SEND after wave 1", async () => {
  await openYard(h, { wave: 0 });

  const opening = await h.frameCalls();
  assertEqual(
    drew(opening, PANEL, HARVEST_PROMPT_FIRST),
    true,
    "whether the panel prompts to START in the build phase before wave 1",
  );
  assertEqual(
    drew(opening, PANEL, HARVEST_PROMPT_LATER),
    false,
    "whether the panel already prompts to SEND before wave 1",
  );

  await h.debug.setWave(1);
  const later = await h.frameCalls();
  await captureStill(h, "prompt");
  assertEqual(
    drew(later, PANEL, HARVEST_PROMPT_LATER),
    true,
    "whether the panel prompts to SEND in a build phase after wave 1",
  );
  assertEqual(
    drew(later, PANEL, HARVEST_PROMPT_FIRST),
    false,
    "whether the panel still prompts to START after wave 1",
  );
});
