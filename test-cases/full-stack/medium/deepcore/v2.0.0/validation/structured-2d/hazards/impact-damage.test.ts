// hazards/impact-damage — a hard landing costs what the rule says.
//
// `specs/hazards.md` states the rule as arithmetic on the landing speed: a
// landing at downward speed `v` deals
// `max(0, v - IMPACT_SAFE_SPEED) * IMPACT_DAMAGE_RATE` hull. So three landings
// are driven at rising speeds and each hull loss is held against the rule at the
// speed the miner actually arrived at.
//
// AGAINST THE SPEED IT ARRIVED AT, NOT THE SPEED POSED. Two things stand between
// the two. `specs/character.md` caps a fall at a terminal speed which rises with
// the load, so an empty miner posed above `FALL_TERMINAL_EMPTY` may be pulled
// back to it; and the last stretch of the drop is still accelerating at
// `GRAVITY`. The sweep watches the fall and keeps the fastest downward speed it
// saw, which is the speed the contact resolved at, and the rule is read against
// that. The last landing is driven with the bay loaded to the lift limit, which
// `specs/character.md` puts the terminal speed at `FALL_TERMINAL_LOADED` for, so
// the 1600 the review item names is a speed the miner can really arrive at.
//
// The tolerance is three hull points, which is a little over two frames of
// `GRAVITY` carried through `IMPACT_DAMAGE_RATE`: the sweep samples once a frame,
// so the speed it saw and the speed the build billed can differ by the travel of
// one frame either way.

import { afterEach, beforeEach, it } from "vitest";
import { assertBetween, assertEqual, assertGreaterThan } from "../assert";
import {
  FALL_TERMINAL_EMPTY,
  FALL_TERMINAL_LOADED,
  IMPACT_SAFE_SPEED,
} from "../../src/constants";
import {
  captureReplay,
  createHarness,
  loadFraction,
  loadToFraction,
  openScene,
  pinDrill,
  type Harness,
} from "../harness";
import {
  armHull,
  bandRow,
  driveLanding,
  HAZARD_COL,
  impactDamageAt,
} from "./scene";

/** The tier whose hull outlasts the heaviest landing. */
const HULL_TIER = 5;

/** The drop left to run under each posed arrival speed. */
const HEIGHT = 8;

/** How far a reading may sit from the rule, in hull points. */
const TOLERANCE = 3;

/** The posed arrival speed of the first, empty landing. */
const BRISK_SPEED = 800;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("deals the impact rule's hull at every landing speed", async () => {
  openScene(h);
  pinDrill(h);
  armHull(h, HULL_TIER);
  const row = bandRow(h.snapshot(), "topsoil");
  for (let col = HAZARD_COL; col <= HAZARD_COL + 8; col += 1) {
    h.debug.setTile(col, row, "rock");
  }

  const landings = await captureReplay(h, "slam", async () => {
    // Two empty landings, the second at the empty terminal speed.
    armHull(h, HULL_TIER);
    const brisk = await driveLanding(h, HAZARD_COL, row, HEIGHT, BRISK_SPEED);
    armHull(h, HULL_TIER);
    const terminal = await driveLanding(
      h,
      HAZARD_COL + 4,
      row,
      HEIGHT,
      FALL_TERMINAL_EMPTY,
    );

    // And one at the loaded terminal speed, which needs the load that raises it.
    const loaded = loadToFraction(h, 1);
    armHull(h, HULL_TIER);
    const heavy = await driveLanding(
      h,
      HAZARD_COL + 8,
      row,
      HEIGHT,
      FALL_TERMINAL_LOADED,
    );
    return { brisk, terminal, heavy, loaded };
  });

  for (const [name, landing] of [
    ["a brisk landing", landings.brisk],
    ["a landing at the empty terminal speed", landings.terminal],
    ["a landing at the loaded terminal speed", landings.heavy],
  ] as const) {
    assertEqual(landing.landed, true, `specs/character.md, ${name}`);
    assertGreaterThan(
      landing.impactSpeed,
      IMPACT_SAFE_SPEED,
      `specs/hazards.md, ${name} is above the safe speed`,
    );
    const expected = impactDamageAt(landing.impactSpeed);
    assertBetween(
      landing.loss,
      expected - TOLERANCE,
      expected + TOLERANCE,
      `specs/hazards.md, ${name} at ${landing.impactSpeed.toFixed(0)} units per second`,
    );
  }

  // The heaviest landing really was a loaded one, which is what let it arrive
  // faster than an empty fall ever could.
  assertGreaterThan(
    loadFraction(landings.heavy.snapshot),
    0.99,
    "specs/character.md, the bay is at the lift limit",
  );
  assertGreaterThan(
    landings.heavy.impactSpeed,
    landings.terminal.impactSpeed,
    "specs/character.md, the terminal speed rises with the load",
  );
  assertGreaterThan(landings.loaded.fraction, 0.99, "specs/character.md");
});
