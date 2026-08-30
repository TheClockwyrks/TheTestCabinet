// build-panel/stamp-control — STAMP, the allowance left, and when it is refused.
//
// `specs/hud.md` gives the panel's press control as "`STAMP`, showing that
// placement is free and how many of the level's `5` stamps remain", "disabled
// when the allowance is spent and during a wave". `specs/scrap-press.md` fixes
// the allowance at `STAMPS_PER_LEVEL` and makes pulling the press a build-phase
// action, and `specs/controls.md` states the press "is refused when the level's
// stamp allowance is spent".
//
// HOW THE REFUSAL IS READ. No reading reports this control: `panelButtons` covers
// the inspector's actions for a selected structure, and `STAMP` is not one of
// them. What a refused control means is decided instead from what it does — the
// `stamp` action arms nothing — and the two refusals are read against a pull that
// DOES arm a rock, so a build whose keyboard never reaches the press fails here
// rather than passing three times over.

import { afterEach, beforeEach, it } from "vitest";
import { assertContains, assertEqual } from "../assert";
import {
  captureStill,
  clearHand,
  createHarness,
  holdWaveOpen,
  openYard,
  pressAction,
  type Harness,
} from "../harness";
import { STAMPS_PER_LEVEL } from "../../src/constants";
import { PANEL, drew, figures } from "./reading";

/** An allowance figure no other read in the panel carries. */
const LEFT = 3;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

/** Whether pulling the press armed a rock on the cursor. */
async function pull(): Promise<boolean> {
  await pressAction(h, "stamp");
  return h.snapshot().held.active;
}

it("draws STAMP with the allowance, and is refused when spent and in a wave", async () => {
  openYard(h, { stamps: LEFT });

  const drawn = await h.frameCalls();
  captureStill(h, "control");
  assertEqual(
    drew(drawn, PANEL, "STAMP"),
    true,
    "whether the panel draws the press control's STAMP",
  );
  assertContains(
    figures(drawn, PANEL),
    LEFT,
    "the panel's figures with three of the five stamps left",
  );

  assertEqual(
    await pull(),
    true,
    "whether the press arms a rock with three stamps left in a build phase",
  );
  await clearHand(h);

  h.debug.setStamps(0);
  assertEqual(
    await pull(),
    false,
    "whether the press arms a rock with the level's allowance spent",
  );

  h.debug.setStamps(STAMPS_PER_LEVEL);
  holdWaveOpen(h);
  assertEqual(
    h.snapshot().phase,
    "wave",
    "the phase a released unit puts the run into (specs/instrumentation.md)",
  );
  assertEqual(
    await pull(),
    false,
    "whether the press arms a rock during a live wave, allowance full",
  );
});
