// instrumentation/remove-mote — `removeMote` takes one mote off the field with
// its filaments and its grips, and leaves the rest of its constellation standing.
//
// THE RULE. "`removeMote(mote)` | Removes that mote and every filament and grip
// touching it. A wheel's unwanted fixtures come off the field this way."
// (`specs/instrumentation.md`, The run). What is left behind is a constellation
// in its own right: "A constellation is a maximal group of motes connected by
// filaments" (`specs/field.md`), so removing one end of a chain leaves the rest
// joined as they were, and "A mote held by nothing rests on its hex for the whole
// cycle" (`specs/simulation.md`).
//
// THE WORLD IS POSED, NOT SEARCHED. A bare run with one arm, then a chain of
// three `dust` on `(-2, 0)`, `(-2, 1)` and `(-2, 2)`, joined end to end, with the
// arm's gripper closed on the first of them through `setGrip`, "which takes hold
// with no `grab` ever running" — so exactly one grip touches the mote that is
// removed. A wheel is placed while the run is live, which raises its six
// fixtures, and one of those is removed too: the fixtures clause of the rule.
// Nothing on the field moves, so nothing but the two calls can change it.
//
// THE VERDICT. The removed mote is gone from `sim.motes`; the filament that
// touched it is gone and the one that did not still joins the other two; the grip
// that held it is gone from `sim.grips`; and the two motes left stand on the
// hexes they stood on, still one constellation. The removed fixture leaves its
// wheel with five.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertDeepEqual,
  assertEqual,
  assertLength,
  assertNotNull,
  assertNull,
} from "../assert";
import { at } from "../field";
import { armPart, solution } from "../formats";
import { BARE, ORIGIN, WEST } from "../fixtures";
import {
  captureStill,
  constellationOf,
  createHarness,
  filamentBetween,
  fixturesOf,
  gripsOf,
  moteById,
  openBareRun,
  partIds,
  placePart,
  spawnConstellation,
  takeGrip,
  type Harness,
} from "../harness";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("removes one mote with its filaments and grips, leaving its constellation resting", async () => {
  await openBareRun(h, {
    challenge: BARE,
    machine: solution([armPart("arm", WEST.q, WEST.r, 0, 1, [])]),
  });
  const arm = (await partIds(h))[0] ?? -1;
  const wheel = await placePart(h, "wheel", ORIGIN, 0);
  const chain = await spawnConstellation(
    h,
    [
      { hex: at(-2, 0), type: "dust" },
      { hex: at(-2, 1), type: "dust" },
      { hex: at(-2, 2), type: "dust" },
    ],
    [
      { a: 0, b: 1 },
      { a: 1, b: 2 },
    ],
  );
  const [held, middle, far] = [chain[0] ?? -1, chain[1] ?? -1, chain[2] ?? -1];
  await takeGrip(h, arm, 0, held);
  const before = await h.snapshot();

  await h.debug.removeMote(held);
  const after = await h.snapshot();

  const fixture = fixturesOf(after, wheel)[0]?.id ?? -1;
  await h.debug.removeMote(fixture);
  const unfixed = await h.snapshot();
  await h.advance(1);
  await captureStill(h, "removed");

  assertNotNull(before.sim, "the run is live before the removals");
  assertLength(
    before.sim?.filaments ?? [],
    2,
    "the chain is joined by two filaments, one of which touches the removed mote",
  );
  assertLength(
    gripsOf(before, arm),
    1,
    "the arm holds the constellation, so one grip touches the removed mote",
  );
  assertNull(moteById(after, held), "the named mote is out of sim.motes");
  assertNull(
    filamentBetween(after, held, middle),
    "the filament touching the removed mote went with it",
  );
  assertNotNull(
    filamentBetween(after, middle, far),
    "the filament that did not touch it still joins the two motes left",
  );
  assertLength(
    gripsOf(after, arm),
    0,
    "the grip holding the removed mote went with it",
  );
  assertEqual(
    `${moteById(after, middle)?.q},${moteById(after, middle)?.r}`,
    "-2,1",
    "the rest of the constellation rests where it stood",
  );
  assertEqual(
    `${moteById(after, far)?.q},${moteById(after, far)?.r}`,
    "-2,2",
    "the rest of the constellation rests where it stood",
  );
  assertDeepEqual(
    constellationOf(after, middle),
    [middle, far].sort((a, b) => a - b),
    "what is left is one constellation of the two motes the filament still joins",
  );
  assertLength(
    fixturesOf(unfixed, wheel),
    5,
    "a wheel's unwanted fixture comes off the field the same way",
  );
  assertNull(
    moteById(unfixed, fixture),
    "the removed fixture is out of sim.motes",
  );
});
