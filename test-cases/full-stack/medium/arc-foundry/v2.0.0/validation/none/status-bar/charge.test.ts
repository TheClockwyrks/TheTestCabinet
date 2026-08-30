// status-bar/charge — the bar draws the run's Charge, and follows it.
//
// `specs/hud.md` puts Charge first in the status bar, showing "the current
// spendable Charge". So Charge is posed to a figure no other read in the bar
// carries, the frame the build drew is read for the figures its text carries, and
// the bar has to be carrying that one; then Charge is posed to a second such
// figure, and the bar has to be carrying the new one and no longer the old.
//
// The yard is emptied first, so what the bar reads is the posed figure and
// nothing the yard put there.

import { afterEach, beforeEach, it } from "vitest";
import { assertContains, assertEqual } from "../assert";
import {
  captureStill,
  createHarness,
  openYard,
  type Harness,
} from "../harness";
import { BAR, figures } from "./reading";

/** Two figures no other bar read carries: not the integrity, wave, or maze length. */
const FIRST = 473;
const SECOND = 128;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("draws the Charge it is posed, and redraws it when it changes", async () => {
  await openYard(h, { charge: FIRST });

  const opening = figures(await h.frameCalls(), BAR);
  await captureStill(h, "bar");
  assertContains(opening, FIRST, "the status bar's figures with Charge at 473");

  await h.debug.setCharge(SECOND);
  const changed = figures(await h.frameCalls(), BAR);
  assertContains(
    changed,
    SECOND,
    "the status bar's figures with Charge at 128",
  );
  assertEqual(
    changed.includes(FIRST),
    false,
    "whether the bar still draws the Charge it no longer holds",
  );
});
