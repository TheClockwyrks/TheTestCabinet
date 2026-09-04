// build-panel/stamp-control — STAMP, the allowance left, and when it is refused.
//
// `specs/hud.md` gives the panel's press control as "`STAMP`, showing that
// placement is free and how many of the level's `5` stamps remain", "disabled
// when the allowance is spent and during a wave". `specs/scrap-press.md` fixes
// the allowance at `STAMPS_PER_LEVEL` and makes pulling the press a build-phase
// action, and `specs/controls.md` states the press "is refused when the level's
// stamp allowance is spent".
//
// HOW THE REFUSAL IS READ. `specs/instrumentation.md` reports this control as the
// `stamp` row of `pressControls`, whose `disabled` "follows the stamp allowance
// and the phase". So the refusal is read off the control itself, at both points
// the rule names, against the one pose where the control is offered. What the
// panel DRAWS is read alongside it, so a build reporting an honest control it
// never draws fails here too.

import { afterEach, beforeEach, it } from "vitest";
import { assertContains, assertEqual } from "../assert";
import {
  captureStill,
  createHarness,
  drew,
  figures,
  type Harness,
  holdWaveOpen,
  openYard,
  PANEL,
  pressControl,
} from "../harness";
import { STAMP_TEXT, STAMPS_PER_LEVEL } from "../constants";

/** An allowance figure no other read in the panel carries. */
const LEFT = 3;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("draws STAMP with the allowance, and is refused when spent and in a wave", async () => {
  await openYard(h, { stamps: LEFT });

  const drawn = await h.frameCalls();
  await captureStill(h, "control");
  assertEqual(
    drew(drawn, PANEL, STAMP_TEXT),
    true,
    "whether the panel draws the press control's STAMP",
  );
  assertContains(
    figures(drawn, PANEL),
    LEFT,
    "the panel's figures with three of the five stamps left",
  );

  assertEqual(
    (await pressControl(h, "stamp")).disabled,
    false,
    "the press control with three stamps left in a build phase",
  );

  await h.debug.setStamps(0);
  assertEqual(
    (await pressControl(h, "stamp")).disabled,
    true,
    "the press control with the level's allowance spent",
  );

  await h.debug.setStamps(STAMPS_PER_LEVEL);
  await holdWaveOpen(h);
  assertEqual(
    (await h.snapshot()).phase,
    "wave",
    "the phase `setPhase` puts the run into (specs/instrumentation.md)",
  );
  assertEqual(
    (await pressControl(h, "stamp")).disabled,
    true,
    "the press control during a live wave, allowance full",
  );
});
