// Wick — screens/levelup-shows-description: the overlay draws the highlighted
// offer's line of copy beneath the offer list.
//
// WHAT THE SPECIFICATION FIXES, AND WHERE. `specs/ui.md`, "`levelup`":
// "Beneath the offer list the overlay draws one more line: the description of
// the offer at `menuIndex`, on one line. A weapon's is its line in
// `WEAPON_DESCRIPTIONS`, a passive's is its line in `PASSIVE_DESCRIPTIONS`,
// and lamp oil's is `LAMP_OIL_DESCRIPTION`." `specs/ui.md`, "Descriptions",
// holds those strings: "the lines below are those strings exactly".
// `specs/progression.md`, "The draw": "When the pool is empty the overlay
// offers exactly one item, `LAMP_OIL_ID`", which is how the third of the three
// carriers is reached.
//
// WHAT IS READ, AND WHY. The strings the overlay drew, and where it drew the
// line against the offers' own names. `specs/ui.md`, Presentation, leaves the
// palette, the font and the layout to the build, so the reading is that the
// line appeared and that it sits below every name in the list; a run of text
// is matched as a SUBSTRING, so padding around the line reads the same. That
// the line CHANGES with the highlight is
// `screens/levelup-description-follows-highlight`'s point.
//
// THE DRIVE. Three overlays, because three loadouts are needed to reach all
// three carriers. First an isolated `playing` run holding nothing, with a
// weapon and two passives queued by name through `setNextOffers` — all three
// are candidates of the pool over an empty loadout, and
// `specs/instrumentation.md` says "the overlay then presents exactly that list
// in that order" — so the offer at `menuIndex` `0` is the weapon. Then the
// same with a passive queued first. Then an isolated run with every weapon
// slot at `MAX_WEAPON_LEVEL` and every passive slot at its own max, whose pool
// is empty, so the overlay draws the lamp-oil offer. Every driver switch is
// off in all three, and nothing is pressed: the line is what the overlay draws
// on opening.
//
// THE TOLERANCE. Each line is exact, ignoring case and surrounding characters.
// The placement is strict: the line's topmost anchor is BELOW the lowest
// anchor any offer's name was drawn at, with no slack, since a line drawn at
// the height of the list is not beneath it.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertDeepEqual,
  assertEqual,
  assertGreaterThan,
  assertLength,
  assertNotNull,
  assertTrue,
} from "../assert";
import {
  LAMP_OIL_DESCRIPTION,
  LAMP_OIL_ID,
  PASSIVES,
  PASSIVE_DESCRIPTIONS,
  WEAPON_DESCRIPTIONS,
  WEAPON_NAMES,
  type OfferId,
} from "../constants";
import {
  captureStill,
  createHarness,
  drewText,
  isolate,
  openLevelUp,
  textDraws,
  type Harness,
} from "../harness";
import { anchorY, fillEverySlot, lowestAnchorY } from "./stage";

/** Three candidates of the pool over an empty loadout, the weapon first. */
const WEAPON_FIRST: readonly OfferId[] = ["ember", "tallow", "lure"];

/** The names those three are listed under (specs/ui.md, levelup). */
const NAMES: readonly string[] = [
  WEAPON_NAMES.ember,
  PASSIVES.tallow.name,
  PASSIVES.lure.name,
];

/** The same three with the passive first, so a passive's line is highlighted. */
const PASSIVE_FIRST: readonly OfferId[] = ["tallow", "lure", "ember"];

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("draws a weapon's, a passive's, and lamp oil's line beneath the offers", async () => {
  isolate(h);
  h.debug.setNextOffers(WEAPON_FIRST);
  const overlay = await openLevelUp(h, 1);
  assertEqual(overlay.screen, "levelup", "the screen the frame is read on");
  assertDeepEqual(
    overlay.run.offers,
    WEAPON_FIRST,
    "the offers the overlay presents",
  );
  assertEqual(overlay.menuIndex, 0, "the highlighted offer on opening");

  const { calls } = await h.frameDraw();
  captureStill(h, "description");
  const line = WEAPON_DESCRIPTIONS.ember;
  assertTrue(
    drewText(calls, line),
    `the overlay drew the highlighted weapon's line ${JSON.stringify(line)} (specs/ui.md, levelup)`,
  );

  const draws = textDraws(calls);
  const listBottom = NAMES.map((name) => {
    const at = lowestAnchorY(draws, name);
    assertNotNull(at, `where the offer ${name} was drawn`);
    return at as number;
  });
  const drawnAt = anchorY(draws, line);
  assertNotNull(drawnAt, "where the description was drawn");
  assertGreaterThan(
    drawnAt as number,
    Math.max(...listBottom),
    "the description drawn beneath the offer list, in device pixels down the stage",
  );

  isolate(h);
  h.debug.setNextOffers(PASSIVE_FIRST);
  const second = await openLevelUp(h, 1);
  assertDeepEqual(
    second.run.offers,
    PASSIVE_FIRST,
    "the offers the second overlay presents",
  );
  const passive = await h.frameDraw();
  assertTrue(
    drewText(passive.calls, PASSIVE_DESCRIPTIONS.tallow),
    `the overlay drew the highlighted passive's line ${JSON.stringify(PASSIVE_DESCRIPTIONS.tallow)} (specs/ui.md, levelup)`,
  );

  isolate(h);
  fillEverySlot(h);
  const oil = await openLevelUp(h, 1);
  assertLength(
    oil.run.pool,
    0,
    "the candidate pool with every slot filled and maxed",
  );
  assertDeepEqual(
    oil.run.offers,
    [LAMP_OIL_ID],
    "the offers over an empty pool",
  );
  const third = await h.frameDraw();
  assertTrue(
    drewText(third.calls, LAMP_OIL_DESCRIPTION),
    `the overlay drew ${JSON.stringify(LAMP_OIL_DESCRIPTION)} for the lamp-oil offer (specs/ui.md, levelup)`,
  );
});
