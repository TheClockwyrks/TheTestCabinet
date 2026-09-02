// hud/shop-lists-eight — the shop lists all eight towers, in shop order, each
// entry drawing that tower's name and its build cost.
//
// THE RULE. specs/hud.md, The shop: "The shop lists all eight towers, one entry
// per type, in the shop order of `TOWER_TYPES`: Arc, Stutter, Rime, Flak, Bloom,
// Lance, Forge, Sink. Each entry draws that tower's name and its build cost."
// specs/towers.md gives the eight costs.
//
// HOW ONE ENTRY IS READ WITHOUT FIXING THE LAYOUT. The panel reports where it
// drew each entry — `controls.shop`, one per entry in shop order — so the name
// and the cost are looked for in the rectangle the build itself says the entry
// occupies, rather than anywhere on the panel. That is what makes this a
// per-entry reading: a panel that drew all eight names in one corner and all
// eight costs in another would fail, and a panel that drew the Lance's `150`
// inside the Bloom's box would fail on the Bloom.
//
// The order is read off `controls.shop` because that is the sequence the surface
// defines as the shop order. Where the boxes then sit on the strip — two columns,
// one column, some other arrangement — is the build's layout choice, which
// specs/hud.md does not take away, so no reading order is demanded of the
// rectangles themselves.
//
// THE NAME IS READ AS THE TYPE'S OWN WORD. specs/hud.md names the eight towers in
// prose — Arc, Stutter, Rime, Flak, Bloom, Lance, Forge, Sink — and fixes no
// display string, so what is required is that the entry's box carries that word,
// ignoring case, as a standalone token. A build spelling it in capitals, in
// lower case, or with a label beside it all read the same.
//
// THE MONEY IS POSED WELL ABOVE EVERY COST, so no entry is drawn disabled. What
// an unaffordable entry looks like is `hud/shop-disabled-when-unaffordable`'s
// requirement, and an entry drawn faint is still an entry drawing its name and
// its cost; posing the plain case keeps this point to the listing.

import { afterEach, beforeEach, it } from "vitest";
import { TOWER_DEFS, TOWER_TYPES } from "../constants";
import { assertDeepEqual, assertLength, assertTrue } from "../assert";
import {
  captureStill,
  createHarness,
  startRun,
  type Harness,
} from "../harness";
import { readPanel, reads, runsIn, saysWord } from "./panel";

/** Money well above the dearest tower, so no entry is drawn disabled. */
const PURSE = 1000;

/**
 * How far outside its own box a run may be anchored and still read inside it:
 * six logical units.
 *
 * A run of text is placed by its baseline anchor, which sits a few units below
 * the glyphs it carries, so a name drawn to read inside a box can be anchored a
 * little outside it. Six units is under a fifth of `MIN_TOUCH_TARGET`, the
 * shortest side specs/hud.md allows a control, so it cannot reach across a
 * neighbouring entry.
 */
const MARGIN = 6;

/** A build cost is a whole number of money; only a trailing point is allowed. */
const EXACT = 0.05;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("lists one entry per type in shop order, each with its name and cost", async () => {
  startRun(h);
  h.debug.setMoney(PURSE);
  const runs = await readPanel(h);
  captureStill(h, "shop");
  const { shop } = h.snapshot().controls;

  assertLength(shop, TOWER_TYPES.length, "the entries the shop reports");
  assertDeepEqual(
    shop.map((entry) => entry.type),
    [...TOWER_TYPES],
    "the shop's entries, in the shop order of TOWER_TYPES (specs/hud.md)",
  );

  for (const entry of shop) {
    const inside = runsIn(runs, entry, MARGIN);
    assertTrue(
      saysWord(inside, entry.type),
      `the ${entry.type} entry to draw the tower's name inside its own box ` +
        `(specs/hud.md)`,
    );
    assertTrue(
      reads(inside, TOWER_DEFS[entry.type].cost, EXACT),
      `the ${entry.type} entry to draw its build cost of ` +
        `${TOWER_DEFS[entry.type].cost} inside its own box (specs/towers.md)`,
    );
  }
});
