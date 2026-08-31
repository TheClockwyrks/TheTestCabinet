// hud/shop-hover-panel — hovering a shop entry shows that TYPE's information at
// level I, and not a live tower's.
//
// THE RULE. specs/hud.md, The info panel and the inspector: the information area
// shows, "With a shop entry hovered, that type's information at level I", and
// "Both the hover panel and the inspector draw the tower's size, its range, its
// damage or its effect, its fire rate, its targeting, its mass, and its radiator
// faces." The four things the hover panel does NOT draw are the inspector's:
// "the tower's level, its live heat read, its kill tally, and its total damage
// dealt." specs/towers.md tabulates the figures and specs/controls.md fixes that
// "Hovering arms nothing and selects nothing."
//
// THE DISTINGUISHING POSE. A Bloom already stands on the floor, at LEVEL III and
// pinned at heat `70`, and it is the Bloom's shop entry that is hovered. So every
// figure has two candidate values — the type's at level I, which specs/towers.md
// tabulates, and the live tower's at level III, which specs/towers.md's Levels
// section derives — and each wrong model reads as a different number:
//
//   - a panel showing the type at level I reads range `6.0`, damage `10` and
//     rate `1.20`;
//   - a panel showing the live tower instead reads range `8.0`, damage `25.6`
//     and rate `1.59`, every one of which is required ABSENT;
//   - a panel showing the live tower's heat reads `70`, also required absent,
//     which is the "no live heat bar" half of this point.
//
// THE DAMAGE READ IS ACCEPTED EITHER WAY, on purpose. specs/hud.md's damage read
// "shows its live per-shot damage beside its live heat multiplier", and a hovered
// TYPE has no live heat, so a build may equally draw the level-I base damage `10`
// that specs/towers.md tabulates or that figure at the cold multiplier
// `MIN_HEAT_MULT`, `10 * 0.35 = 3.5`. Both are the Bloom's damage at level I;
// neither is the level-III figure.
//
// WHAT IS NOT DECIDED HERE. The kill and damage TALLIES cannot be read as absent:
// a type has no tallies, so a panel wrongly drawing them would draw two zeroes,
// and no colour-free reading tells a drawn zero from an absent field.
// `hud/inspector-fields` decides that the inspector draws them, and this point
// decides the half that can be measured — that the hover panel answers for the
// type and not for the tower on the floor. The three-way targeting read is
// `hud/targeting-read`'s; what is required here is only that a targeting read is
// drawn at all.
//
// THE FOOTPRINT SIDE IS THE ONE WEAK READING HERE, and it is weak by the shop's
// own doing: a panel is free to draw a type's footprint side in its shop entry
// too, so a `3` may be on the strip whether or not the hover panel drew one. It
// is asserted anyway, because the field is required, and a panel drawing no size
// at all still fails every other field above.
//
// NOTHING IS ARMED AND NOTHING IS SELECTED, which the point reads back off the
// snapshot before it reads the panel: `setHoverShop` sets the shop entry
// currently hovered and nothing else (specs/instrumentation.md), so a build that
// armed a placement or selected a tower on a hover fails here.

import { afterEach, beforeEach, it } from "vitest";
import { MIN_HEAT_MULT } from "../../src/constants";
import { assertEqual, assertNull, assertTrue } from "../assert";
import {
  captureStill,
  createHarness,
  posePinnedTower,
  startRun,
  type Harness,
} from "../harness";
import { statsAt } from "./figures";
import { emitterDef, readPanel, reads, saysFace, saysWord } from "./panel";
import { FREE_SITE } from "./sites";

/** The type hovered. Its figures at level I and level III are far apart. */
const TYPE = "bloom" as const;
const DEF = emitterDef(TYPE);

/** The level the live tower on the floor is raised to, which must not be read. */
const LIVE_LEVEL = 3;

/** The heat the live tower is pinned at, which must not be read either. */
const LIVE_HEAT = 70;

/** The type's figures at level I, from specs/towers.md's own table. */
const LEVEL_I = statsAt(DEF, 1);

/** And at the level the live tower stands at, which the panel must not read. */
const LEVEL_III = statsAt(DEF, LIVE_LEVEL);

/**
 * How far a drawn figure may sit from the one it must be: a twentieth.
 *
 * Every figure read here is tabulated to a tenth or is a whole number, and a
 * build is free to draw it with more decimal places than that, so the window is
 * only wide enough to carry `1.2`, `1.20` and `1.200` onto the same figure. It is
 * far narrower than the gap between any level-I figure and its level-III
 * counterpart, which is what the point turns on.
 */
const ROUNDED = 0.05;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("shows the Bloom's level-I figures on a hover, not the level-III tower's", async () => {
  startRun(h);
  const live = posePinnedTower(
    h,
    TYPE,
    FREE_SITE.col,
    FREE_SITE.row,
    LIVE_HEAT,
  );
  h.debug.setTowerLevel(live, LIVE_LEVEL);
  h.debug.setHoverShop(TYPE);

  const runs = await readPanel(h);
  captureStill(h, "hover");
  const posed = h.snapshot();

  assertEqual(
    posed.hoverShop,
    TYPE,
    "precondition: the Bloom's entry is hovered",
  );
  assertNull(posed.build, "precondition: hovering armed no placement");
  assertNull(posed.selected, "precondition: hovering selected no tower");

  // The seven fields both panels draw.
  assertTrue(
    saysWord(runs, TYPE),
    "the hover panel to name the hovered tower (specs/hud.md)",
  );
  assertTrue(
    reads(runs, DEF.size, ROUNDED),
    `the hover panel to draw the Bloom's footprint side of ${DEF.size}`,
  );
  assertTrue(
    reads(runs, LEVEL_I.range, ROUNDED),
    `the hover panel to draw the Bloom's level-I range of ${LEVEL_I.range}`,
  );
  assertTrue(
    reads(runs, LEVEL_I.fireRate, ROUNDED),
    `the hover panel to draw the Bloom's level-I fire rate of ` +
      `${LEVEL_I.fireRate}`,
  );
  assertTrue(
    reads(runs, LEVEL_I.baseDamage, ROUNDED) ||
      reads(runs, LEVEL_I.baseDamage * MIN_HEAT_MULT, ROUNDED),
    `the hover panel to draw the Bloom's level-I damage, ` +
      `${LEVEL_I.baseDamage} or that at the cold multiplier ` +
      `${LEVEL_I.baseDamage * MIN_HEAT_MULT}`,
  );
  assertTrue(
    reads(runs, DEF.mass, ROUNDED),
    `the hover panel to draw the Bloom's mass of ${DEF.mass}`,
  );
  for (const face of DEF.radiators) {
    assertTrue(
      saysFace(runs, face),
      `the hover panel to name the Bloom's ${face} radiator face`,
    );
  }
  assertTrue(
    saysWord(runs, "air"),
    "the hover panel to draw a targeting read, the Bloom hitting ground and air",
  );

  // At level I, which is what makes every figure above the TYPE's and not the
  // live tower's.
  assertTrue(
    !reads(runs, LEVEL_III.range, ROUNDED),
    `the hover panel not to draw the live tower's level-III range of ` +
      `${LEVEL_III.range}`,
  );
  assertTrue(
    !reads(runs, LEVEL_III.baseDamage, ROUNDED),
    `the hover panel not to draw the live tower's level-III damage of ` +
      `${LEVEL_III.baseDamage}`,
  );
  assertTrue(
    !reads(runs, LEVEL_III.fireRate, ROUNDED),
    `the hover panel not to draw the live tower's level-III fire rate of ` +
      `${LEVEL_III.fireRate.toFixed(3)}`,
  );
  assertTrue(
    !reads(runs, LIVE_HEAT, ROUNDED),
    `the hover panel to carry no live heat read, and so not to draw the live ` +
      `tower's heat of ${LIVE_HEAT}`,
  );
});
