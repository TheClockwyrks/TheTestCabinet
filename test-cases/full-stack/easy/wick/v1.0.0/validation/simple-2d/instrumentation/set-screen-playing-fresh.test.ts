// instrumentation/set-screen-playing-fresh — `setScreen('playing')` from
// title, howto, fallen, or dawn begins a fresh run exactly as LIGHT THE LAMP
// and TRY AGAIN do: the idle run with Taper at level 1 and cooldown 0 alone in
// the first weapon slot, screen playing, menuIndex 0.
//
// WHAT THE SPECIFICATION FIXES. specs/instrumentation.md, `setScreen`'s row
// for `playing` from "any other": "Begins a fresh run exactly as `LIGHT THE
// LAMP` and `TRY AGAIN` do: the idle run with Taper at level `1` and cooldown
// `0` in the first weapon slot". specs/ui.md, "A fresh run", lists the same
// values; `FRESH_RUN` in `helpers.ts` restates them with the snapshot's
// derived fields.
//
// THE POSE. From each of the four screens in turn, each reached through the
// surface: title by reset, howto by its row, fallen and dawn by their rows
// over a run first disturbed and ticked, so on the end screens "a fresh run"
// is read against a kept run that would betray a `setScreen` that resumed it.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import {
  captureStill,
  createHarness,
  type Harness,
  type Screen,
} from "../harness";
import { assertFreshRun, poseBusyNight } from "./helpers";

const FROM: readonly Exclude<
  Screen,
  "playing" | "levelup" | "chest" | "paused"
>[] = ["title", "howto", "fallen", "dawn"];

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

/** Reach `screen` through the surface, over a disturbed run for the end screens. */
async function reach(screen: (typeof FROM)[number]): Promise<void> {
  if (screen === "title") {
    h.reset();
    return;
  }
  if (screen === "howto") {
    h.reset();
    h.debug.setScreen("howto");
    return;
  }
  poseBusyNight(h);
  await h.tick(3);
  h.debug.setScreen(screen);
}

it("begins a fresh run from each of the four screens", async () => {
  for (const from of FROM) {
    await reach(from);
    assertEqual(h.snapshot().screen, from, `the screen the pose is issued on`);

    h.debug.setScreen("playing");
    const s = h.snapshot();

    assertEqual(s.screen, "playing", `the screen after setScreen from ${from}`);
    assertEqual(s.menuIndex, 0, `menuIndex after setScreen from ${from}`);
    assertFreshRun(s.run, `run after setScreen('playing') from ${from}`);
  }
  await h.tick(1);
  captureStill(h, "fresh");
});
