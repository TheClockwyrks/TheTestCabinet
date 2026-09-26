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
//     which is the "no live heat bar" half of this point.//
// AND THEN A SECOND ENTRY IS HOVERED, because the area shows THAT type's
// information. One hover decides only that some tower's figures appeared; the
// Stutter's entry, whose every figure differs from the Bloom's, separates a panel
// that answers the hover from one that letters a single card once and leaves it.
// The Bloom's range and rate must be GONE.
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
// type and not for the tower on the floor. Which of the three readings a type's
// targeting is given is `hud/targeting-read`'s; what is required here is only
// that a targeting read is drawn at all, in any of the case's own words.
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
import { assertEqual, assertNull, assertTrue, fail } from "../assert";
import { MIN_HEAT_MULT } from "../constants";
import {
  captureStill,
  createHarness,
  movePointerTo,
  posePinnedTower,
  startRun,
  type Harness,
  type TowerType,
} from "../harness";
import { statsAt } from "./figures";
import {
  emitterDef,
  infoRuns,
  readPanel,
  reads,
  saysFace,
  saysTargeting,
  saysWord,
} from "./panel";
import { FREE_SITE } from "./sites";

/** The type hovered. Its figures at level I and level III are far apart. */
const TYPE = "bloom" as const;
const DEF = emitterDef(TYPE);

/** The second entry hovered, whose every figure differs from the Bloom's. */
const OTHER = "stutter" as const;

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

/**
 * Hover a shop entry the way a player hovers one: a real pointer move into the
 * rectangle the build reported for it.
 *
 * POSED AND POINTED AT BOTH, because this point reads what the panel DRAWS and
 * drawing needs a frame. `setHoverShop` alone does not survive one: nothing in
 * `specs/instrumentation.md` says a pose does, and `specs/controls.md` writes
 * the hover as a fact about where the pointer is, so a build that re-derives it
 * from the pointer on every frame is reading that sentence rather than breaking
 * it — and it would be left hovering nothing. So the entry is posed AND the
 * pointer is moved onto it: a build that keeps the pose keeps it, and a build
 * that re-derives the hover derives the same entry. The rectangle is the
 * build's own (`specs/instrumentation.md`), so nothing here fixes where the shop
 * sits.
 */
async function hoverEntry(h: Harness, type: TowerType): Promise<void> {
  h.debug.setHoverShop(type);
  const { shop } = h.snapshot().controls;
  const entry = shop.find((each) => each.type === type);
  if (entry === undefined) {
    fail(
      `the panel to report a shop entry for the ${type} (specs/hud.md)`,
      shop,
    );
  }
  await movePointerTo(h, entry.x + entry.w / 2, entry.y + entry.h / 2);
}

/** One run's text, normalized so two readings of one line compare equal. */
function textOf(run: { text: string }): string {
  return run.text.trim().replace(/\s+/g, " ").toUpperCase();
}

it("shows the Bloom's level-I figures on a hover, not the level-III tower's", async () => {
  startRun(h);

  // THE PANEL'S OWN CHROME, READ FIRST, ON AN EMPTY FLOOR WITH NOTHING HOVERED.
  // specs/hud.md draws the shop "at all times", with all eight entries and their
  // build costs, and specs/controls.md letters those entries `1` to `8`; a build
  // may draw a legend saying so, and the three readouts are always there too. So
  // a bare figure is on the panel whatever is hovered, and a check asserting a
  // figure is ABSENT would read the chrome and fail a build that never drew the
  // figure at all. What such a check is about is what the HOVER put on the
  // panel, so the chrome is read once here and subtracted from the reading
  // below.
  const chrome = new Set(
    infoRuns(await readPanel(h), h.snapshot().controls).map(textOf),
  );

  const live = posePinnedTower(
    h,
    TYPE,
    FREE_SITE.col,
    FREE_SITE.row,
    LIVE_HEAT,
  );
  h.debug.setTowerLevel(live, LIVE_LEVEL);
  await hoverEntry(h, TYPE);

  const panel = await readPanel(h);
  captureStill(h, "hover");
  const posed = h.snapshot();

  // READ OFF THE INFORMATION AREA, NOT THE WHOLE STRIP. specs/hud.md draws the
  // shop "at all times" with all eight entries and their build costs, and
  // specs/controls.md letters those entries `1` to `8`, so a bare figure is
  // always somewhere on the panel — a check asserting that a figure is ABSENT
  // reads the shop and fails a build that never drew it. `infoRuns` subtracts
  // the rectangles the build itself reported for its controls, which is how the
  // area specs/hud.md calls "one area of the panel" is read without the
  // specification fixing where it sits.
  const runs = infoRuns(panel, posed.controls);

  /** What the hover ADDED to the panel: the reading every negative is over. */
  const hovered = runs.filter((run) => !chrome.has(textOf(run)));

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
    saysTargeting(runs),
    "the hover panel to draw a targeting read (specs/hud.md, The targeting read)",
  );

  // At level I, which is what makes every figure above the TYPE's and not the
  // live tower's.
  assertTrue(
    !reads(hovered, LEVEL_III.range, ROUNDED),
    `the hover panel not to draw the live tower's level-III range of ` +
      `${LEVEL_III.range}`,
  );
  assertTrue(
    !reads(hovered, LEVEL_III.baseDamage, ROUNDED),
    `the hover panel not to draw the live tower's level-III damage of ` +
      `${LEVEL_III.baseDamage}`,
  );
  assertTrue(
    !reads(hovered, LEVEL_III.fireRate, ROUNDED),
    `the hover panel not to draw the live tower's level-III fire rate of ` +
      `${LEVEL_III.fireRate.toFixed(3)}`,
  );
  assertTrue(
    !reads(hovered, LIVE_HEAT, ROUNDED),
    `the hover panel to carry no live heat read, and so not to draw the live ` +
      `tower's heat of ${LIVE_HEAT}`,
  );

  // And THAT type's information: the second entry replaces the first's figures.
  await hoverEntry(h, OTHER);
  const second = infoRuns(await readPanel(h), h.snapshot().controls).filter(
    (run) => !chrome.has(textOf(run)),
  );

  assertTrue(
    !reads(second, LEVEL_I.range, ROUNDED),
    `no Bloom range of ${LEVEL_I.range} left in the panel once the ${OTHER} ` +
      `is the hovered entry: the area shows THAT type's information ` +
      `(specs/hud.md)`,
  );
  assertTrue(
    !reads(second, LEVEL_I.fireRate, ROUNDED),
    `no Bloom fire rate of ${LEVEL_I.fireRate} left in the panel once the ` +
      `${OTHER} is the hovered entry (specs/hud.md)`,
  );
});
