// hud/shop-lists-eight — the shop carries one entry per tower type, in shop
// order, each drawing that tower's name and its build cost.
//
// THE RULE. specs/hud.md, The shop: "The shop lists all eight towers, one entry
// per type, in the shop order of `TOWER_TYPES`: Arc, Stutter, Rime, Flak, Bloom,
// Lance, Forge, Sink. Each entry draws that tower's name and its build cost."
// specs/towers.md gives the eight names and the eight costs.
//
// THREE THINGS ARE READ, AND EACH IS A DIFFERENT WAY THE SHOP CAN BE WRONG. That
// there are eight entries and no more; that they are in the order the
// specification lists, which specs/instrumentation.md has the panel report as
// `controls.shop`, "one per shop entry, in shop order"; and that each entry
// carries its own name and its own cost, drawn ON that entry.
//
// AN ENTRY'S CONTENTS ARE ATTRIBUTED TO THE RECTANGLE THE BUILD ITSELF REPORTED,
// which is what lets specs/hud.md fix WHAT the shop holds and leave WHERE
// entirely to the build. A run of text anchored on the Arc's rectangle is the
// Arc's caption; a `150` anywhere in the strip is not the Bloom's cost. Reading
// them panel-wide would pass a build that drew all eight names in one entry and
// nothing in the other seven, and would be unable to tell the Bloom's `150` from
// the Lance's or the Forge's `20` from the Sink's.
//
// THE NAMES ARE READ AS SUBSTRINGS, IGNORING CASE, because the words are the
// specification's and the framing is the build's: "ARC", "Arc" and "ARC  x1" all
// draw the tower's name.
//
// THE MONEY IS FAR ABOVE EVERY COST, so no entry is drawn disabled while this
// reading is taken. What a disabled entry looks like is
// `hud.shop-disabled-when-unaffordable`; that it still shows its name and its
// cost is not this point's business either way, and posing every entry affordable
// keeps this reading about the list.
//
// WHAT IT DOES NOT DECIDE. What pressing an entry does is
// `controls.pointer-arms-from-the-shop`, what an entry's information panel holds
// is `hud.shop-hover-panel`, and how big an entry must be is `hud.touch-targets`.

import { afterEach, beforeEach, it } from "vitest";
import { TOWER_DEFS, TOWER_TYPES } from "../../src/constants";
import { assertDeepEqual, assertLength, assertTrue } from "../assert";
import {
  captureStill,
  createHarness,
  shopEntry,
  startRun,
  type Harness,
} from "../harness";
import { panelRuns, readsNumber, readsText, runsInside, textsOf } from "./read";

/**
 * The name specs/towers.md gives each tower, which is what its shop entry draws.
 *
 * The specification's own words for the eight, in its own tables: the roster of
 * `specs/towers.md` and the shop order of `specs/hud.md`.
 */
const NAMES: Readonly<Record<string, string>> = {
  arc: "Arc",
  stutter: "Stutter",
  rime: "Rime",
  flak: "Flak",
  bloom: "Bloom",
  lance: "Lance",
  forge: "Forge",
  sink: "Sink",
};

/** Far above the dearest tower, so no entry is drawn disabled under the reading. */
const PURSE = 9999;

/** The wave posed under the reading, and the run it is read on. */
const MODE = "containment";
const DIFFICULTY = "hard";
const WAVE = 7;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("lists all eight towers in shop order, each with its name and its cost", async () => {
  startRun(h, MODE, DIFFICULTY);
  h.debug.setPhase("wave");
  h.debug.setMoney(PURSE);
  h.debug.setWave(WAVE);

  const runs = await panelRuns(h);
  captureStill(h, "shop");
  const { controls } = h.snapshot();

  assertLength(
    controls.shop,
    TOWER_TYPES.length,
    "shop entries in snapshot().controls.shop, one per tower type " +
      "(specs/hud.md, The shop)",
  );
  assertDeepEqual(
    controls.shop.map((entry) => entry.type),
    [...TOWER_TYPES],
    "the shop's entries in the shop order of TOWER_TYPES (specs/hud.md, The " +
      "shop; specs/instrumentation.md, controls)",
  );

  for (const type of TOWER_TYPES) {
    const entry = shopEntry(controls, type);
    const drawn = runsInside(runs, entry);

    assertTrue(
      readsText(drawn, NAMES[type]),
      `the name "${NAMES[type]}" drawn on the ${type} shop entry ` +
        `(specs/hud.md, The shop; specs/towers.md); that entry drew ` +
        `${JSON.stringify(textsOf(drawn))} and the whole panel drew ` +
        `${JSON.stringify(textsOf(runs))}`,
    );
    assertTrue(
      readsNumber(drawn, TOWER_DEFS[type].cost),
      `the ${type}'s build cost of ${TOWER_DEFS[type].cost} drawn on its own ` +
        `shop entry (specs/hud.md, The shop; specs/towers.md); that entry ` +
        `drew ${JSON.stringify(textsOf(drawn))}`,
    );
  }
});
