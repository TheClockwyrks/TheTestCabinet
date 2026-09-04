// screens/overload-screen — the overload screen shows the wave reached and no
// rating.
//
// THE REQUIREMENT. `specs/ui.md`, of `overload`: "It shows the wave reached, and
// no Maze Rating, because the finale is never reached from a defeat. It offers
// `TRY AGAIN` and `MENU`." `specs/campaign.md` states the reason plainly: "A
// defeat never reaches the finale, so a defeated run has no Maze Rating." The
// absent figure is as much the requirement as the present one — a build that
// shows a rating of `0` on a lost run is telling the player they scored nothing
// rather than that the run was never scored.
//
// HOW IT IS DECIDED. The run is LOST rather than posed. The surface carries no
// operation that ends a run, so a unit is released and put on the collector with
// the last point of Grid Integrity on the counter; it grounds out, the counter
// reaches `0`, and the defeat is the game's own. The run is lost on wave `17`, a
// number of its own so that reading it off the screen's text cannot pick up some
// other figure. The frame's own text draws are then read three ways: the wave is
// there, the words "MAZE RATING" are not, and the two choices are drawn and
// reported.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { OVERLOAD_ITEMS } from "../constants";
import {
  captureStill,
  createHarness,
  menuControl,
  type Harness,
} from "../harness";
import { drewNumber, drewText } from "./reading";
import { OVERLOAD_WAVE, reachOverload } from "./outcomes";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("shows the wave the run reached and offers its two choices", async () => {
  await reachOverload(h);
  const calls = await h.frameCalls();
  await captureStill(h, "overload");

  const lost = await h.snapshot();
  assertEqual(
    lost.screen,
    "overload",
    "the overload screen showing (specs/ui.md)",
  );

  assertEqual(
    drewNumber(calls, OVERLOAD_WAVE),
    true,
    `the overload screen to show wave ${OVERLOAD_WAVE}, the wave the run ` +
      "reached (specs/ui.md)",
  );
  assertEqual(
    lost.mazeRating,
    0,
    "the Maze Rating of a defeated run, which never reaches the finale and so " +
      "has none (specs/ui.md, specs/campaign.md)",
  );

  for (const item of OVERLOAD_ITEMS) {
    assertEqual(
      drewText(calls, item),
      true,
      `the overload screen to draw its ${item} choice (specs/ui.md)`,
    );
  }
  await menuControl(h, "again");
  await menuControl(h, "menu");
});
