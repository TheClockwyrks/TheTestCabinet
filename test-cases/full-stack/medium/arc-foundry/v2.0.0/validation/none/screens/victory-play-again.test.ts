// screens/victory-play-again — PLAY AGAIN replays the same run.
//
// THE REQUIREMENT. `specs/ui.md`, of `victory`: "It offers `PLAY AGAIN`, which
// replays the run on the same map at the same difficulty." `specs/campaign.md`
// says what the run it begins is: one that "opens on its first build phase, with
// `START_CHARGE` Charge, `START_INTEGRITY` Grid Integrity, refinement at `R0`, an
// empty yard, and the wave counter at `0`."
//
// HOW IT IS DECIDED. The run is WON rather than posed — the final wave is opened
// and emptied, the finale runs, and the victory screen arrives on the game's own
// rules — and `PLAY AGAIN` is then found by the action it carries rather than by
// where it was drawn and pressed at the centre of the rectangle the build itself
// reported for it. What is read back is both halves of "replays the run": the map
// and the difficulty are the ones the finished run was played on, and every
// opening value is back where a fresh run starts it.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertLength } from "../assert";
import { START_CHARGE, START_INTEGRITY } from "../constants";
import {
  captureStill,
  createHarness,
  pressMenu,
  type Harness,
} from "../harness";
import { ENDING_DIFFICULTY, reachVictory } from "./outcomes";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("begins a fresh run on the map and difficulty just played", async () => {
  await reachVictory(h);
  const won = await h.snapshot();
  assertEqual(
    won.screen,
    "victory",
    "the victory screen showing (specs/ui.md)",
  );

  await pressMenu(h, "again");
  await captureStill(h, "again");

  const again = await h.snapshot();
  assertEqual(
    again.screen,
    "playing",
    "the screen PLAY AGAIN begins the replay on (specs/ui.md)",
  );
  assertEqual(
    again.phase,
    "build",
    "the phase a replayed run opens on (specs/campaign.md)",
  );
  assertEqual(
    again.map,
    won.map,
    "the map PLAY AGAIN replays on, which is the same one (specs/ui.md)",
  );
  assertEqual(
    again.difficulty,
    ENDING_DIFFICULTY,
    "the difficulty PLAY AGAIN replays at, which is the same one " +
      "(specs/ui.md)",
  );
  assertEqual(
    again.charge,
    START_CHARGE,
    "the Charge a replayed run opens with (specs/campaign.md)",
  );
  assertEqual(
    again.integrity,
    START_INTEGRITY,
    "the Grid Integrity a replayed run opens with (specs/campaign.md)",
  );
  assertEqual(
    again.refinement,
    0,
    "the refinement level a replayed run opens at, R0 (specs/campaign.md)",
  );
  assertEqual(
    again.wave,
    0,
    "the wave counter of a replayed run (specs/campaign.md)",
  );
  assertLength(
    again.structures,
    0,
    "the structures on a replayed run's yard, which is empty " +
      "(specs/campaign.md)",
  );
});
