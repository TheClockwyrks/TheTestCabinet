// Wick — audio/cue-pickup-bread: the tick bread is collected plays `pickup`.
//
// WHERE THE THRESHOLD COMES FROM. `specs/ui.md`, Audio: the cue table binds
// `pickup` to "Bread or a draft is collected", and "Each is played on the
// tick its event happens ... and at most once on that tick."
// `specs/world.md`, Collection: "A pickup is collected on any tick on which
// the distance between its center and the lamplighter's center is less than
// `PICKUP_ITEM_RADIUS` (`16`) plus `PLAYER_RADIUS`", and bread "Heals
// `BREAD_HEAL` (`30`), capped at `maxHp`". One collection on one tick is
// therefore exactly one `pickup`.
//
// WHY THE WORLD IS POSED AS IT IS. One bread on the lamplighter's own center
// in an isolated run holding nothing else, with every driver switch off. A
// distance of `0` is inside the collection distance whatever the build's
// pickup radius, so the collection lands on the first tick. `hp` is posed
// below `maxHp` so the heal the collection carries is a real one, and the
// isolation leaves no gem on the field and the `progression` switch off, so no
// level-up, no death, no contact hit, and no chest lands on the tick beside
// it.
//
// THE TOLERANCE. None: the specification fixes the cue to the tick of the
// collection and to at most one play on it, and the collector reads whole
// frames.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertGreaterThan } from "../assert";
import { BASE_MAX_HP, CUES } from "../constants";
import {
  advanceTicks,
  captureReplay,
  createHarness,
  placePickup,
  type Harness,
} from "../harness";
import { cuesOf, heard, isolatedRun } from "./cues";

/** Health posed below `maxHp`, so the bread's heal has somewhere to go. */
const WOUNDED_HP = BASE_MAX_HP / 2;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("plays pickup once on the tick bread is collected", async () => {
  const before = await isolatedRun(h);
  h.debug.setHp(WOUNDED_HP);
  const { player } = before.run;
  placePickup(h, "bread", player.x, player.y);

  const { result: after, played } = await captureReplay(h, "bread", () =>
    cuesOf(h, () => advanceTicks(h, 1)),
  );

  // The premise: the bread really was collected on this tick.
  assertEqual(after.run.pickups.length, 0, "the pickups left on the field");
  assertGreaterThan(
    after.run.player.hp,
    WOUNDED_HP,
    "the health the bread restored (specs/world.md, Pickups)",
  );

  assertEqual(
    heard(played, CUES.pickup),
    1,
    "pickup cues on the tick bread was collected (specs/ui.md, Audio)",
  );
});
