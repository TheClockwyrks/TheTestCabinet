// Wick — screens/chest-shows-heal-result: a heal is reported in the build's
// own words, and those words are not the ones the other two results carry.
//
// WHAT THE SPECIFICATION FIXES, AND WHERE. `specs/ui.md`, "`chest`", the
// result table: for `kind` `heal` the overlay shows "That the lamplighter was
// healed `CHEST_HEAL` (`30`), in words of your own", beneath the heading
// `CHEST_TEXT` (`A CHEST OPENS`) the same table sits under.
// `specs/evolutions.md`, "Opening a chest", reaches that result third, when
// nothing can evolve and no held item is below its max.
//
// WHAT IS READ, AND WHY IT IS READ THIS WAY. The wording is the build's, so no
// particular string can be required. What CAN be required is that the screen
// says something, and that what it says is not what the other two results say:
// a build that drew the heading and nothing else, or that drew one line
// whatever the chest did, is a build whose overlay does not report the result.
// So all three results are opened in turn and the runs of text each drew BELOW
// its heading are compared as sets, the heading's own runs left out.
//
// THE THREE POSES, each an isolated `playing` run with every driver switch
// off. Heal: nothing held at all, so neither of the first two rules applies.
// Level: Ember at level `3` alone, the only item below a maximum. Evolve:
// Taper at `MAX_WEAPON_LEVEL` (`8`) beside Wick, the recipe of Pyre. Each
// opens its overlay through a chest posed at the lamplighter's own centre and
// the one tick that collects it, and each result is read off the snapshot
// before its frame is compared.
//
// THE TOLERANCE. The comparison is set-wise and exact: two results whose
// below-the-heading text is the same set of strings are not told apart, and
// nothing about where or how the words are drawn is read.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertDeepEqual,
  assertEqual,
  assertGreaterThanOrEqual,
  assertNotDeepEqual,
  assertNotNull,
} from "../assert";
import { CHEST_TEXT, MAX_WEAPON_LEVEL } from "../constants";
import {
  captureStill,
  createHarness,
  holdPassive,
  holdWeapon,
  isolate,
  openChest,
  textDraws,
  type Harness,
  type WickSnapshot,
} from "../harness";
import { lowestAnchorY, textBelow } from "./stage";

/** What one posed chest left: its result, and the copy beneath its heading. */
interface Opened {
  snapshot: WickSnapshot;
  below: string[];
}

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

/** Pose a loadout, open a chest over it, and read the copy beneath the heading. */
async function open(pose: () => void, still: boolean): Promise<Opened> {
  isolate(h);
  pose();
  const snapshot = await openChest(h);
  const { calls } = await h.frameDraw();
  if (still) captureStill(h, "heal");
  const draws = textDraws(calls);
  const heading = lowestAnchorY(draws, CHEST_TEXT);
  assertNotNull(heading, `where ${CHEST_TEXT} was drawn`);
  return { snapshot, below: textBelow(draws, heading as number, CHEST_TEXT) };
}

it("reports a heal in text of its own that the other results do not carry", async () => {
  const heal = await open(() => undefined, true);
  assertEqual(
    heal.snapshot.screen,
    "chest",
    "the screen the heal frame is read on",
  );
  assertDeepEqual(
    heal.snapshot.run.chestResult,
    { kind: "heal" },
    "the chest's result over a loadout with nothing to evolve or level",
  );
  assertGreaterThanOrEqual(
    heal.below.length,
    1,
    `runs of text the heal drew beneath ${CHEST_TEXT} (specs/ui.md, chest)`,
  );

  const level = await open(() => {
    holdWeapon(h, "ember", 3);
  }, false);
  assertEqual(
    level.snapshot.run.chestResult?.kind,
    "level",
    "the chest's result over one item below its maximum",
  );

  const evolve = await open(() => {
    holdWeapon(h, "taper", MAX_WEAPON_LEVEL);
    holdPassive(h, "wick", 1);
  }, false);
  assertEqual(
    evolve.snapshot.run.chestResult?.kind,
    "evolve",
    "the chest's result over a weapon at its top level beside its recipe passive",
  );

  assertNotDeepEqual(
    heal.below,
    level.below,
    "the heal's copy beneath the heading, against the level result's",
  );
  assertNotDeepEqual(
    heal.below,
    evolve.below,
    "the heal's copy beneath the heading, against the evolve result's",
  );
});
