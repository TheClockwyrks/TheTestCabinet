// screens/overload-try-again — TRY AGAIN replays the lost run.
//
// THE REQUIREMENT. `specs/ui.md`, of `overload`: "It offers `TRY AGAIN` and `MENU`,
// leading to the same places", and the victory screen's counterpart of `TRY AGAIN`
// "replays the run on the same map at the same difficulty". `specs/campaign.md` says
// what the run it begins is: one that "opens on its first build phase, with
// `START_CHARGE` Charge, `START_INTEGRITY` Grid Integrity, refinement at `R0`, an
// empty yard, and the wave counter at `0`."
//
// HOW IT IS DECIDED. A map and a difficulty that are neither of them the value a
// fresh game opens on are posed, so "the same map at the same difficulty" is a claim
// with something to fail on, and the overload screen is then reached directly.
// `TRY AGAIN` is found by the action it carries rather than by where it was drawn
// and taken at the centre of the rectangle the build itself reported for it. Both
// halves of "replays the run" are read back: the map and the difficulty are the ones
// posed, and every opening value is back where a fresh run starts it.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertLength } from "../assert";
import { START_CHARGE, START_INTEGRITY } from "../constants";
import {
  captureStill,
  createHarness,
  type Harness,
  openMenu,
  pressMenu,
} from "../harness";

/** Neither is the value `reset` restores, so replaying "the same" one can fail. */
const MAP = "switchyard";
const DIFFICULTY = "hard";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("begins a fresh run on the map and difficulty the lost run was played on", async () => {
  h.debug.reset();
  h.debug.setMap(MAP);
  h.debug.setDifficulty(DIFFICULTY);
  openMenu(h, "overload");

  await pressMenu(h, "again");
  captureStill(h, "again");

  const again = h.snapshot();
  assertEqual(
    again.screen,
    "playing",
    "the screen TRY AGAIN begins the replay on (specs/ui.md)",
  );
  assertEqual(
    again.phase,
    "build",
    "the phase a replayed run opens on (specs/campaign.md)",
  );
  assertEqual(
    again.map,
    MAP,
    "the map TRY AGAIN replays on, which is the same one (specs/ui.md)",
  );
  assertEqual(
    again.difficulty,
    DIFFICULTY,
    "the difficulty TRY AGAIN replays at, which is the same one (specs/ui.md)",
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
