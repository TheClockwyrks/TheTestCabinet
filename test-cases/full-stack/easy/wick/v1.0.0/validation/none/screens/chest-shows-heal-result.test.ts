// screens/chest-shows-heal-result — the chest overlay says, in the build's own
// words, that the lamplighter was healed.
//
// WHERE THE THRESHOLD COMES FROM. specs/ui.md ("`chest`"), the result table:
// "`heal` | That the lamplighter was healed `CHEST_HEAL` (`30`), in words of
// your own." The words are the build's, so what can be decided is that the heal
// is REPORTED and reported as itself: the overlay shows something beneath its
// heading on a heal that it shows on neither of the other two results, which is
// what "shows the result in `chestResult`" (specs/ui.md) asks of the screen.
// specs/evolutions.md ("Opening a chest") is what makes each of the three
// results happen: rule 1 evolves, rule 2 levels, rule 3 heals.
//
// WHY THE WORLD IS POSED AS IT IS. Three chests over one isolated night, each
// reached the real way and each posed to a different one of the three rules: an
// empty loadout for the heal, Taper at level `3` with Brass for the level, and
// Taper at `MAX_WEAPON_LEVEL` with Wick for the evolution. The health is posed
// so that all three frames report the SAME health — `CHEST_HEAL` below the cap
// before the heal, at the cap for the other two — because the HUD draws it, and
// a difference there would read as words of the heal's own. Each overlay is
// closed through the surface between scenarios, which "Closes the overlay
// exactly as `confirm` does" without deciding anything this check reads.
//
// THE TOLERANCE. A run of text counts as the heal's own when it is drawn below
// the heading's row and its folded text appears on neither of the other two
// frames, which is the widest reading that still tells a build that names the
// heal from one that shows an empty panel.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertGreaterThan } from "../assert";
import { BASE_MAX_HP, CHEST_HEAL, CHEST_TEXT } from "../constants";
import { captureStill, createHarness, player, type Harness } from "../harness";
import {
  closeChest,
  mustRowY,
  night,
  openEvolveChest,
  openHealChest,
  openLevelChest,
  ownTextBelow,
  shown,
} from "./stage";

/** The health the heal is read from: `CHEST_HEAL` below the cap, so it lands under it. */
const HURT_HP = BASE_MAX_HP - CHEST_HEAL;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("draws text under the heading on a heal that neither other result draws", async () => {
  await night(h);
  await h.debug.setHp(HURT_HP);
  const healed = await openHealChest(h);
  assertEqual(player(healed).hp, BASE_MAX_HP, "hp after the chest healed");
  const healPage = await shown(h);
  await captureStill(h, "heal");

  await closeChest(h);
  await h.debug.setHp(BASE_MAX_HP);
  await openLevelChest(h);
  const levelPage = await shown(h);

  await closeChest(h);
  await h.debug.setHp(BASE_MAX_HP);
  await openEvolveChest(h);
  const evolvePage = await shown(h);

  const heading = mustRowY(healPage, CHEST_TEXT, "the chest overlay's heading");
  const own = ownTextBelow(healPage, heading, [levelPage, evolvePage]);
  assertGreaterThan(
    own.length,
    0,
    "runs of text the heal draws under the heading that the level and evolve results do not",
  );
});
