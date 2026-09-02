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
// particular string can be required. What CAN be required is that the heal
// frame carries copy OF ITS OWN: at least one run of text drawn beneath the
// heading that neither the level frame nor the evolve frame drew. So all three
// results are opened in turn, the runs of text each drew below its heading are
// collected, and the heal's are taken less the other two's.
//
// WHY A DIFFERENCE RATHER THAN AN INEQUALITY. Copy the overlay draws whatever
// the result is — a footer, an instruction to press on — lands beneath the
// heading too, so a heal frame carrying only that footer is a NON-EMPTY list,
// and it is UNEQUAL to the other two results' lists as soon as either of them
// adds a line of its own on top of the same footer. Both of those readings pass
// a build that reports the heal with no words at all. What the shared copy
// cannot do is survive the difference, so the difference is what is read.
//
// THE THREE POSES, each an isolated `playing` run with every driver switch
// off. Heal: nothing held at all, so neither of the first two rules applies.
// Level: Ember at level `3` alone, the only item below a maximum. Evolve:
// Taper at `MAX_WEAPON_LEVEL` (`8`) beside Wick, the recipe of Pyre. Each
// opens its overlay through a chest posed at the lamplighter's own centre and
// the one tick that collects it, and each result is read off the snapshot
// before its frame is compared.
//
// THE TOLERANCE. The comparison is set-wise and exact: a run of text the heal
// drew counts as its own when neither other result drew that same string, and
// nothing about where or how the words are drawn is read.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertDeepEqual,
  assertEqual,
  assertGreaterThanOrEqual,
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

  const own = heal.below.filter(
    (line) => !level.below.includes(line) && !evolve.below.includes(line),
  );
  assertGreaterThanOrEqual(
    own.length,
    1,
    `runs of text the heal drew beneath ${CHEST_TEXT} that the level and evolve results did not (specs/ui.md, chest)`,
  );
});
