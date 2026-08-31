// Meltdown — screens/pause-resume: RESUME returns to the match with the floor
// exactly as it was left.
//
// THE RULE. specs/screens.md, `paused`: the `RESUME` row leads to "`playing`,
// with the floor exactly as it was left."
//
// TWO READINGS, AND THE SECOND IS THE ONE THAT BITES. That the screen goes back to
// `playing` is the easy half. "Exactly as it was left" is the half a wrong build
// fails: a build that resumes by STARTING a run — the same code path its restart
// row uses — lands on `playing` with an empty floor and a purse full of starting
// money, and the player's maze is gone. So the tower and the unit posed before the
// pause are read back afterwards, field by field, and every one of them must be
// what it was.
//
// WHY THE CAP IS `broken` AND WHY IT NAMES `run`. This is the one item in the
// group whose failure strands a run the player has already started: pausing is
// something a player does in the middle of every match, and a resume that throws
// the floor away ends the match. It is not `presentation` alone, because the
// wreckage is the run rather than the picture.
//
// THE FLOOR IS POSED WITH ONLY THE FACULTIES THE READING NEEDS. The tower's guns
// and its thermal model are both held off and the unit's motion is off, so nothing
// on the floor can move of its own accord across the frames the press takes — and
// what is read afterwards is what the RESUME did, not what a sixtieth of a second
// of play did. Their heat, position and hp are posed to values nothing in the game
// would land on by accident, so a build that rebuilt the floor from scratch reads
// different numbers rather than the same ones.
//
// WHETHER THE FLOOR RUNS AGAIN AFTERWARDS IS NOT READ HERE. That the game resumes
// advancing is `waves.resume-continues-the-run`, measured there on the build's own
// clock, because a question about whether time passes belongs on the clock the
// player's game runs on. This item reads the state the resume left behind, which
// reads the same however the clock is driven.
//
// THE PAUSE SCREEN IS POSED OUTRIGHT over a live run, because how it is REACHED is
// `controls.pause-key`'s and `controls.esc-pauses`'s requirement; and the row is
// posed rather than walked, so a build whose arrow keys are broken still gets a
// fair reading of what its RESUME row does.

import { afterEach, beforeEach, it } from "vitest";
import { PAUSE_ITEMS } from "../../src/constants";
import { assertEqual, assertLength } from "../assert";
import {
  captureStill,
  createHarness,
  poseTarget,
  poseTower,
  startRun,
  tapAction,
  tileCenter,
  type Harness,
} from "../harness";

/** The row confirmed: `RESUME`, the first of the three `PAUSE_ITEMS`. */
const RESUME_ROW = PAUSE_ITEMS.indexOf("RESUME");

/** Where the tower stands: clear of both vent-to-exhaust corridors. */
const TOWER_SITE = { type: "arc", col: 6, row: 6 } as const;

/**
 * The heat the tower is left carrying: an ordinary mid-scale figure, and not the
 * `0` a freshly built tower starts at (specs/instrumentation.md).
 *
 * A build that threw the floor away and laid a new tower down would read `0`, so
 * the posed figure is what tells "the tower that was there" from "a tower".
 */
const TOWER_HEAT = 37;

/** Where the unit stands, and the hp it carries: neither a default nor a boundary. */
const UNIT_SITE = { type: "mote", col: 30, row: 24 } as const;
const UNIT_HP = 23;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("returns to the match with the tower and the unit exactly as the pause left them", async () => {
  startRun(h);

  const towerId = poseTower(h, TOWER_SITE.type, TOWER_SITE.col, TOWER_SITE.row);
  h.debug.setTowerFiring(towerId, false);
  h.debug.setTowerThermal(towerId, false);
  h.debug.setTowerHeat(towerId, TOWER_HEAT);
  const unitId = poseTarget(
    h,
    UNIT_SITE.type,
    UNIT_SITE.col,
    UNIT_SITE.row,
    UNIT_HP,
  );

  h.debug.setScreen("paused");
  h.debug.setMenuIndex(RESUME_ROW);
  await h.advance(1);

  const before = h.snapshot();
  assertEqual(before.screen, "paused", "the screen the scenario is posed on");
  assertEqual(before.menuIndex, RESUME_ROW, "the row the scenario is posed on");
  assertLength(before.towers, 1, "the towers the pause was taken over");
  assertLength(before.surge, 1, "the units the pause was taken over");

  await tapAction(h, "confirm");
  captureStill(h, "resumed");

  const after = h.snapshot();
  assertEqual(after.screen, "playing", "the screen confirming RESUME leads to");
  assertEqual(after.phase, before.phase, "the phase the resumed match is in");

  assertLength(
    after.towers,
    1,
    "the towers still on the floor after the resume",
  );
  const tower = after.towers[0];
  assertEqual(
    tower.id,
    towerId,
    "the id of the tower the resume left standing",
  );
  assertEqual(tower.type, TOWER_SITE.type, "the type of that tower");
  assertEqual(tower.col, TOWER_SITE.col, "the column that tower stands on");
  assertEqual(tower.row, TOWER_SITE.row, "the row that tower stands on");
  assertEqual(tower.heat, TOWER_HEAT, "the heat that tower was carrying");

  assertLength(after.surge, 1, "the units still on the floor after the resume");
  const unit = after.surge[0];
  const posed = tileCenter(UNIT_SITE.col, UNIT_SITE.row);
  assertEqual(unit.id, unitId, "the id of the unit the resume left standing");
  assertEqual(unit.type, UNIT_SITE.type, "the type of that unit");
  assertEqual(unit.x, posed.x, "the x that unit was standing at");
  assertEqual(unit.y, posed.y, "the y that unit was standing at");
  assertEqual(unit.hp, UNIT_HP, "the hp that unit was carrying");
});
