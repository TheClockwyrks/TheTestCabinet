// press/keep-harvests — KEEP turns the selected candidate into a permanent
// component at exactly the type and quality it rolled, and that component fires.
//
// It is the plainest of the three harvests `specs/scrap-press.md` lists, and the
// one the whole level structure rests on: each level yields exactly one new
// firing structure, and KEEP is how the player takes the roll they were given
// rather than trading it down or folding it away. A build that shifts the tier,
// or that leaves the piece a candidate under a different name, has a level that
// produced nothing.
//
// AND IT REALLY FIRES. A candidate does not fire (`specs/hud.md` gives it no
// targeting control at all), so "it became a component" and "it fires from then
// on" are one claim: a held target is stood inside its range and the component's
// own damage tally is read.
//
// The tier the harvest lands at is the requirement here; DOWNGRADE's one-tier
// drop is the sibling point `downgrade-one-tier`.

import { afterEach, beforeEach, it } from "vitest";

import { assertEqual, assertGreaterThan } from "../assert";
import {
  captureStill,
  componentRange,
  createHarness,
  openYard,
  parkUnit,
  standCandidate,
  structureById,
  structureCenter,
  type Harness,
} from "../harness";

/** The roll that is kept, and where it lands. */
const ROLLS = { type: "capacitor", quality: 3 } as const;
const AT = { col: 20, row: 10 };

/** How far inside the component's range the target is held. */
const TARGET_INSET = 40;

/** How long the component is given to land a shot, in frames of the 120 Hz clock. */
const FIRE_FRAMES = 600;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("keeps the roll at its own tier, standing a component that fires", async () => {
  openYard(h, { wave: 1 });
  const candidate = standCandidate(
    h,
    ROLLS.type,
    ROLLS.quality,
    AT.col,
    AT.row,
  );

  h.debug.select(candidate);
  h.debug.keep(candidate);
  const harvested = h.snapshot();
  await h.advance(1);
  captureStill(h, "kept");

  const component = structureById(harvested, candidate);
  assertEqual(component.kind, "component", "what KEEP leaves standing");
  assertEqual(
    component.type,
    ROLLS.type,
    "the type the kept component carries",
  );
  assertEqual(
    component.quality,
    ROLLS.quality,
    "the quality the kept component carries, which KEEP does not move",
  );

  // And it fires: one held target inside its range, and nothing else on the yard.
  h.debug.clearUnits();
  const centre = structureCenter(AT.col, AT.row);
  const reach = componentRange(ROLLS.type, ROLLS.quality);
  parkUnit(h, "overload", {
    x: centre.x + reach - TARGET_INSET,
    y: centre.y,
  });

  const fired = await h.until(
    (s) => (s.structures.find((x) => x.id === candidate)?.damageDealt ?? 0) > 0,
    { maxFrames: FIRE_FRAMES },
  );
  assertEqual(
    fired.hit,
    true,
    `the kept component to land a shot on a target held inside its range ` +
      `within ${FIRE_FRAMES} frames`,
  );
  assertGreaterThan(
    structureById(fired.snapshot, candidate).damageDealt,
    0,
    "the damage the kept component has dealt",
  );
});
