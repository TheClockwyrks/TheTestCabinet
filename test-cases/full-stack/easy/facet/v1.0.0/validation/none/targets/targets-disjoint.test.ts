// Facet — targets/targets-disjoint: no two targets on one screen overlap.
//
// The fourth row of specs/controls.md's requirements table: "Separation — no two
// targets on one screen overlap." That file then leans on the property when it
// says how a screen is operated: "A pointer position lies in at most one target,
// since no two on a screen overlap." So the requirement is what makes every rule
// below it well defined — a press in an overlap would arm two targets, and the
// specification says which one only because there cannot be one.
//
// A FAULT THE BEHAVIOR POINTS CANNOT SEE. Every press and release in this
// category aims at a target's own CENTER, and two menu rows can overlap along
// their inner edges while both centers still lie in one rectangle alone. So a
// build whose rows are stacked too closely answers `hover-highlights-menu`,
// `press-arms-target` and `release-takes-target` and leaves a band across the
// menu where a press has no defined answer.
//
// SHARING AN EDGE IS NOT OVERLAPPING. `board.ts`'s `targetsOverlap` is strict on
// every edge, so two targets laid exactly edge to edge are separate: a shared
// boundary line has no area, and the sentence the requirement exists for — a
// position lies in at most one target — is not put at risk by it in any build
// that hit-tests a half-open rectangle.
//
// EVERY PAIR ON EVERY SCREEN, because the requirement is about pairs and a build
// lays its screens out one at a time. A screen carrying one target has no pair
// and passes, which is correct: `howto` and `playing` are single-target screens
// and `targets/targets-reported` is what says so.

//
// HOW EACH SCREEN IS REACHED. Through `reachScreen`, the harness's own sequence
// of the atomic poses specs/instrumentation.md gives: a `reset`, a posed board
// under the four screens specs/ui.md draws one behind, and `setScreen`. Nothing
// here depends on a menu's ordering, on a key binding, or on the level and end
// conditions that raise `levelclear` and `gameover` in play — those are other
// items' requirements, and a route through them would put their failures on this
// point. `setScreen` shows a screen and changes nothing else, and the screen
// behaves from there exactly as it does when a player reaches it, so the targets
// read here are the targets a player sees.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertGreaterThanOrEqual } from "../assert";
import { SCREENS, type Screen } from "../constants";
import { targetsOverlap } from "../board";
import {
  captureStill,
  createHarness,
  reachScreen,
  type Harness,
} from "../harness";

/** The screen the kept picture is taken on. */
const PICTURED: Screen = "paused";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("reports no two targets on one screen sharing any area", async () => {
  for (const screen of SCREENS) {
    const reading = await reachScreen(h, screen);
    assertGreaterThanOrEqual(
      reading.targets.length,
      1,
      `the targets the ${screen} screen reports, of which every one is read`,
    );

    for (let i = 0; i < reading.targets.length; i += 1) {
      for (let j = i + 1; j < reading.targets.length; j += 1) {
        const a = reading.targets[i];
        const b = reading.targets[j];
        assertEqual(
          targetsOverlap(a, b),
          false,
          `targets ${a.id} at (${a.x},${a.y}) ${a.w}x${a.h} and ${b.id} at ` +
            `(${b.x},${b.y}) ${b.w}x${b.h} on ${screen} sharing area`,
        );
      }
    }

    if (screen === PICTURED) {
      // One frame, so the picture is of the screen the rectangles were read on.
      await h.advance(1);
      await captureStill(h, "targets");
    }
  }
});
