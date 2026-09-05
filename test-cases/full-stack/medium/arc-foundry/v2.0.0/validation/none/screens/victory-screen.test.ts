// screens/victory-screen — the victory screen shows the run's figures.
//
// THE REQUIREMENT. `specs/ui.md`, of `victory`: "It shows the Maze Rating, the
// number of waves survived, which is `N`, and the Grid Integrity remaining. It
// offers `PLAY AGAIN` ... and `MENU`." Three figures and two choices, and the
// figures are the whole payoff of a run: `specs/campaign.md` says the run "keeps
// no running score" and that the Maze Rating is "its one end-of-run figure".
//
// HOW IT IS DECIDED. The run is WON rather than posed. The surface carries no
// operation that ends a run, so the final wave is opened and emptied, the finale
// runs, the Overload Dynamo grounds out at the collector, and the victory screen
// arrives on the game's own rules. The run is driven on Easy, so `N` is `40`, and
// its Grid Integrity is posed to `13`, a number sharing no digits with `40`, so
// neither can be found in the other.
//
// The frame's own text draws then have to carry all three figures: `40` and `13`
// as numbers of their own, and a number matching the Maze Rating the game itself
// reports, to within a unit, because a build is free to round the rating for
// display. The two choices are read off `menuButtons` by the action each carries
// and off the frame by the copy `specs/ui.md` fixes for them.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertTruthy } from "../assert";
import { VICTORY_ITEMS } from "../constants";
import {
  captureStill,
  createHarness,
  menuControl,
  type Harness,
} from "../harness";
import { drawnNumbers, drewNumber, drewText } from "./reading";
import { ENDING_WAVES, VICTORY_INTEGRITY, reachVictory } from "./outcomes";

/** How far a drawn figure may sit from the reported Maze Rating. */
const RATING_TOLERANCE = 1;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("shows the rating, the waves survived and the Integrity left", async () => {
  await reachVictory(h);
  const calls = await h.frameCalls();
  await captureStill(h, "victory");

  const won = await h.snapshot();
  assertEqual(
    won.screen,
    "victory",
    "the victory screen showing (specs/ui.md)",
  );

  assertEqual(
    drewNumber(calls, ENDING_WAVES),
    true,
    `the victory screen to show the ${ENDING_WAVES} waves survived, which is ` +
      "N for the chosen difficulty (specs/ui.md)",
  );
  assertEqual(
    drewNumber(calls, VICTORY_INTEGRITY),
    true,
    `the victory screen to show the ${VICTORY_INTEGRITY} Grid Integrity ` +
      "remaining (specs/ui.md)",
  );
  assertTruthy(
    drawnNumbers(calls).some(
      (drawn) => Math.abs(drawn - won.mazeRating) <= RATING_TOLERANCE,
    ),
    `the victory screen to show the Maze Rating the run produced, ` +
      `${won.mazeRating}, to within ${RATING_TOLERANCE} of a figure it draws ` +
      "(specs/ui.md, specs/campaign.md)",
  );

  for (const item of VICTORY_ITEMS) {
    assertEqual(
      drewText(calls, item),
      true,
      `the victory screen to draw its ${item} choice (specs/ui.md)`,
    );
  }
  await menuControl(h, "again");
  await menuControl(h, "menu");
});
