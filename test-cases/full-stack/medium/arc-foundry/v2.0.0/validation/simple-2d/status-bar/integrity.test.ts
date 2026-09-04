// status-bar/integrity — the bar draws the remaining Grid Integrity.
//
// `specs/hud.md` puts Grid Integrity second in the status bar, showing "the
// remaining Grid Integrity". `specs/economy.md` opens a run at START_INTEGRITY
// (20), so both figures posed here are inside the range a run really reaches, and
// neither collides with the Charge, the wave, or the maze length the bar also
// carries.

import { afterEach, beforeEach, it } from "vitest";
import { assertContains, assertEqual } from "../assert";
import {
  BAR,
  captureStill,
  createHarness,
  figures,
  type Harness,
  openYard,
} from "../harness";

const FIRST = 17;
const SECOND = 12;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("draws the Grid Integrity it is posed, and follows it down", async () => {
  openYard(h, { charge: 473, integrity: FIRST });

  const opening = figures(await h.frameCalls(), BAR);
  captureStill(h, "bar");
  assertContains(
    opening,
    FIRST,
    "the status bar's figures with Grid Integrity at 17",
  );

  h.debug.setIntegrity(SECOND);
  const changed = figures(await h.frameCalls(), BAR);
  assertContains(
    changed,
    SECOND,
    "the status bar's figures with Grid Integrity at 12",
  );
  assertEqual(
    changed.includes(FIRST),
    false,
    "whether the bar still draws the Grid Integrity it no longer holds",
  );
});
