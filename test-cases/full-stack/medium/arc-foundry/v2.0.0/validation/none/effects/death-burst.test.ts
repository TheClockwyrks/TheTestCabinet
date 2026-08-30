// Arc Foundry — effects/death-burst: a dying unit pops where it died.
//
// THE REQUIREMENT, from `specs/assets.md`: the death burst is spawned when "a unit
// dies", it carries "an electrical pop, scaled up for a Dynamo", and it is spawned
// "where a unit dies".
//
// THE WORLD. One Capacitor and one Mote, held where it stands so it dies at a
// point the reading knows in advance, and one further Mote held at the map's entry
// and out of every range, so the live wave `spawnUnit` opened cannot clear in the
// middle of the reading and change the screen underneath it. Nothing else is on
// the yard.
//
// WHAT IS READ. The disc the unit stood on, frame by frame. The reading is taken
// twice over the same ground: once before the unit is placed, when the ground is
// bare, and once from the frame the unit is removed, when it is bare again. So
// both readings are of empty ground and neither carries the unit's own idle cycle,
// and the only thing that can move the second one is what was played there. The
// unit is killed by a real shot from a real structure rather than by posing its
// health away, because the requirement is about the event the game raises.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertEqual,
  assertGreaterThan,
  assertGreaterThanOrEqual,
} from "../assert";
import { structureCenter } from "../constants";
import {
  captureReplay,
  createHarness,
  holdWaveOpen,
  openYard,
  parkUnit,
  standComponent,
  ticks,
  type Harness,
} from "../harness";
import { lattice, motion } from "./region";

/** Clear ground, well away from the map's waypoint platforms and its chain. */
const ANCHOR = { col: 21, row: 18 };
const HEAD = structureCenter(ANCHOR.col, ANCHOR.row);

/** Eighty units away, inside the Scrap Capacitor's stated range of `100`. */
const AT = { x: HEAD.x + 80, y: HEAD.y };

/** The ground the unit stands on, clear of the structure's own footprint. */
const POINTS = lattice(AT, 18, 3);

const WINDOW = ticks(0.1);
const MOVING = WINDOW / 2;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("sets the ground moving where a unit died", async () => {
  await openYard(h, { wave: 1 });
  await holdWaveOpen(h);
  await h.advance(1);
  const bare = await motion(h, POINTS, WINDOW);

  await standComponent(h, "capacitor", 1, ANCHOR.col, ANCHOR.row);
  const victim = await parkUnit(h, "mote", AT, { hp: 1 });

  const played = await captureReplay(h, "death", async () => {
    const died = await h.until((s) => !s.units.some((u) => u.id === victim), {
      maxFrames: ticks(3),
    });
    return { died: died.hit, moving: await motion(h, POINTS, WINDOW) };
  });

  assertEqual(
    played.died,
    true,
    "a Scrap Capacitor to kill a one-health Mote eighty units away within " +
      "three seconds (specs/components.md)",
  );
  assertGreaterThan(
    played.moving,
    bare,
    "the ground a unit died on to change on more frames than the same ground " +
      `did while it was bare, so a death burst is played there ` +
      `(specs/assets.md); bare ground changed on ${bare} of ${WINDOW} frames`,
  );
  assertGreaterThanOrEqual(
    played.moving,
    MOVING,
    "the ground to keep changing across the tenth of a second after the kill, " +
      "as a live particle system does (specs/assets.md)",
  );
});
