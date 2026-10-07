// presentation/evolved-effects-drawn-from-own-files — each of the six evolved
// weapons draws its own produced effect, and its base weapon's file is drawn
// nowhere.
//
// WHERE THE THRESHOLD COMES FROM. specs/assets.md ("The weapon effects"): "Each
// of the six evolved weapons has an effect of the same form, frame count, and
// canvas as its base's, at the path below, visibly distinct from its base's so
// a player sees at a glance that the tool has transformed", with the table
// giving Pyre `assets/sprites/effects/pyre.png`, Beacon `beacon.png`, Hail
// `hail.png`, Chandelier `chandelier.png`, Corona `corona.png`, and Blaze
// `blaze.png`. The same section fixes where each lands: "Each weapon has one
// effect the game draws wherever the weapon's shape is live", "Each is
// produced on the canvas its row states and scaled in code to the live shape
// ... so the effect's drawn extent is the hitbox's extent on every tick it is
// drawn", and specs/world.md ("The camera and the view") fixes the stage point
// a world position is drawn at. specs/evolutions.md gives each evolved shape:
// Pyre's two `width × height` rectangles, Beacon's and Hail's circles of
// `radius`, Chandelier's lanterns and Corona's aura, and Blaze's puddles.
// Nothing holds a base weapon here, so no base shape is live and, by the same
// sentence, no base effect is drawn.
//
// THE WORLD. An isolated playing run (`isolate`): nothing on the field but one
// hound, no base weapon held, every driver switch off but the one the firing
// needs. All six evolved weapons are held at once, one to a slot, and each is
// armed, so the next tick creates every one of their shapes and one frame
// carries all six pictures. That is the point's own subject rather than a
// bystander: the claim is about the six as a set, and a build that draws one
// evolution's file for another's shape fails here and would pass six separate
// nights. The hound stands 500 units out because "Beacon needs at least one
// enemy to fire", far outside every shape a firing at the lamplighter's center
// creates, and `enemyMotion` and `enemyContact` are off, so it neither moves,
// hits, nor dies.
//
// WHAT IS READ. One frame's blits. For each of the six evolutions, every live
// shape that weapon put in the world, and a blit of that evolution's own
// produced file centered on the camera formula's point for it and covering its
// extent; then that its base weapon's produced file is not blitted anywhere on
// the frame.
//
// TOLERANCE. DRAWN_POINT_TOLERANCE (1 unit) on each drawn center and
// DRAWN_EXTENT_TOLERANCE (2 units) on each extent, the case's tolerances for a
// bitmap a build may snap to whole device pixels. The base file check carries
// none: a file was blitted or it was not.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertGreaterThan } from "../assert";
import {
  EVOLUTIONS,
  EVOLUTION_IDS,
  WEAPON_SLOTS,
  type EvolutionId,
} from "../constants";
import {
  armWeapon,
  captureStill,
  createHarness,
  holdWeapon,
  isolate,
  projectilesOf,
  spawnEnemyAt,
  zonesOf,
  type Harness,
  type WickSnapshot,
} from "../harness";
import {
  assertEffectOverEachShape,
  circleOf,
  rectangleOf,
  type Live,
} from "./effects";
import { assertNoEffect } from "./drawn";

/** Where the hound stands: Beacon's target, clear of every shape. */
const HOUND_AT = { x: 500, y: 0 };

/** The shapes each evolved weapon has live, as a frame must draw them. */
const SHAPES: Readonly<
  Record<EvolutionId, (snapshot: WickSnapshot) => Live[]>
> = {
  pyre: (snapshot) => zonesOf(snapshot, "pyre").map(rectangleOf),
  beacon: (snapshot) => projectilesOf(snapshot, "beacon").map(circleOf),
  hail: (snapshot) => projectilesOf(snapshot, "hail").map(circleOf),
  chandelier: (snapshot) => zonesOf(snapshot, "chandelier").map(circleOf),
  corona: (snapshot) => zonesOf(snapshot, "corona").map(circleOf),
  blaze: (snapshot) => zonesOf(snapshot, "blaze").map(circleOf),
};

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("draws each evolved weapon's effect from its own file and no base's", async () => {
  const posed = isolate(h);
  assertEqual(posed.screen, "playing", "the screen the frame is drawn on");
  assertEqual(
    EVOLUTION_IDS.length <= WEAPON_SLOTS,
    true,
    "the six evolutions against the weapon slots they are held in",
  );
  spawnEnemyAt(h, "hound", HOUND_AT.x, HOUND_AT.y);
  for (const id of EVOLUTION_IDS) {
    armWeapon(h, holdWeapon(h, id, 1));
  }

  const blits = await h.frameBlits();
  captureStill(h, "evolved");
  const snapshot = h.snapshot();

  for (const id of EVOLUTION_IDS) {
    const shapes = SHAPES[id](snapshot);
    assertGreaterThan(
      shapes.length,
      0,
      `the live shapes ${id} put in the world`,
    );
    assertEffectOverEachShape(h, blits, id, snapshot, shapes, `${id}'s shape`);
    assertNoEffect(
      blits,
      EVOLUTIONS[id].from,
      `the frame ${id} drew, on which its base weapon is not held`,
    );
  }
});
