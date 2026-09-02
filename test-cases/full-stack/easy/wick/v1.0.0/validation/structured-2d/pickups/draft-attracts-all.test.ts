// pickups/draft-attracts-all — a draft attracts every gem on the field.
//
// WHERE THE THRESHOLD COMES FROM. `specs/world.md` ("Pickups") gives the
// draft's effect: "| `draft` | A common enemy, by the roll below. | Every gem
// on the field becomes attracted. |", and ("Attraction and flight") says the
// same from the gem's side: "A draft attracts every gem on the field at once".
// "Every gem on the field" carries no distance, so the three gems posed
// `DISTANCES` (`500`, `1500`, and `3000`) units out, all far beyond
// `PICKUP_RADIUS` (`48`) and the farthest two and a half times
// `DESPAWN_DISTANCE` (`1200`), all read `attracted` `true` after the tick that
// collected the draft. `specs/world.md` ("One tick") puts the collection in
// phase 8 and the gems in phase 9, so the attraction lands on the collecting
// tick rather than the one after it.
//
// WHY THE WORLD IS POSED AS IT IS. An isolated night: every driver switch off,
// nothing alive, nothing else dropped, and no slot held, so no Lure widens the
// radius that would attract a gem on its own and nothing else can attract one.
// Every posed distance is far outside `pickupRadius`, so a build that attracts
// only what the radius reaches leaves all three unattracted and fails; that is
// what makes the draft the only thing that could have set the flags. The three
// gems are posed along `+x` and the draft on the lamplighter's own center, at
// distance `0`, so one tick collects it under the collection rule without any
// movement. No key is pressed, so the lamplighter holds the origin.
//
// THE TOLERANCE. None on `attracted`, a boolean, nor on whether the draft was
// collected, a count.

import { afterEach, beforeEach, it } from "vitest";
import { assertDefined, assertEqual } from "../assert";
import { PICKUP_RADIUS } from "../constants";
import {
  advanceTicks,
  captureStill,
  createHarness,
  gemById,
  isolate,
  placeGem,
  placePickup,
  type Harness,
} from "../harness";

/** Where the three gems stand: all far outside `PICKUP_RADIUS` (`48`). */
const DISTANCES = [500, 1500, 3000] as const;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("leaves all three distant gems attracted on the tick the draft is collected", async () => {
  const opened = isolate(h);
  const at = opened.run.player;
  const ids = DISTANCES.map((away) => placeGem(h, "small", at.x + away, at.y));
  for (const id of ids) {
    assertEqual(
      gemById(h.snapshot(), id)?.attracted,
      false,
      `the posed gem ${id}'s attracted flag`,
    );
  }
  placePickup(h, "draft", at.x, at.y);

  const after = await advanceTicks(h, 1);
  captureStill(h, "draft");

  assertEqual(
    after.run.pickups.length,
    0,
    "the pickups left after the tick, so the draft was collected",
  );
  ids.forEach((id, index) => {
    const seen = gemById(after, id);
    assertDefined(seen, `the gem ${DISTANCES[index]} units out after the tick`);
    assertEqual(
      seen?.attracted,
      true,
      `the attracted flag of the gem ${DISTANCES[index]} units out, far beyond pickupRadius ${PICKUP_RADIUS} (specs/world.md, Pickups)`,
    );
  });
});
