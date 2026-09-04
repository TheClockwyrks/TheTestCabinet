// presentation/evolved-effects-drawn-from-own-files — an evolved weapon's shape
// carries the evolution's own produced effect, not the base weapon's.
//
// WHERE THE THRESHOLD COMES FROM. `specs/assets.md` — "The weapon effects": "Each
// of the six evolved weapons has an effect of the same form, frame count, and
// canvas as its base's, at the path below, visibly distinct from its base's so a
// player sees at a glance that the tool has transformed", over the table naming
// `assets/sprites/effects/pyre.png`, `beacon.png`, `hail.png`, `chandelier.png`,
// `corona.png`, and `blaze.png`. `specs/overview.md` names the same thing among
// what a player reads at a glance: "an evolved weapon's effect is visibly distinct
// from its base's."
//
// WHY THIS IS ONE POINT OVER SIX SHAPES. The requirement is that the six
// evolutions have effects of their own at all, and a build that wired one of them
// back to its base's file has missed it exactly once. Each evolution is posed
// alone on its own emptied night, so the shape a reading is taken over is
// unambiguous, and the reading names which evolution it was taken for.
//
// HOW EACH SHAPE IS REACHED. Each through the route its own section of
// `specs/evolutions.md` gives it: Pyre's slashes and Hail's darts fire without a
// target, Beacon "needs at least one enemy to fire" so a hound stands `300` units
// out, Blaze's puddles land on the scatter disk wherever the seeded generator puts
// them, and Chandelier's lanterns and Corona's aura are created "on the first
// `playing` tick" their weapon is held, by the placement phase of
// `specs/world.md`, which `specs/instrumentation.md` puts outside the driver
// switches. Every other faculty stays held, so nothing else is on any of the six
// frames.
//
// WHAT IS READ. The image drawn at the shape's own place, and which produced file
// it is, decided by the file's own pixels. Nothing here reads the base's file: a
// build that drew the base's picture has drawn something that is not the
// evolution's file, and that is the miss. Where the effect is drawn and how large
// is each base weapon's own point; this one is about which file arrives.
//
// THE TOLERANCE. `BLIT_TOL`, one logical unit on the centre, which is one device
// pixel at the harness's fit: a build is free to round a fractional world position
// to the pixel grid. The identity of the file has no tolerance.

import { afterEach, beforeEach, it } from "vitest";
import { type EvolutionId } from "../constants";
import { assertGreaterThan } from "../assert";
import {
  captureStill,
  createHarness,
  disable,
  fireWeapon,
  holdWeapon,
  isolate,
  placeEnemy,
  stagePoint,
  zonesOfKind,
  type Harness,
  type WickSnapshot,
  type XY,
} from "../harness";
import { drawFromAt, effectFiles } from "./readouts";
import { primeSources } from "./sources";

/** Where the one enemy Beacon needs stands. */
const TARGET_AT = { dx: 300, dy: 0 };

/** One evolution, the shape it is read over, and how that shape is reached. */
interface Case {
  id: EvolutionId;
  shape: string;
  reach(): Promise<{ snapshot: WickSnapshot; at: XY }>;
}

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

/** Fire `id` once on an emptied night and answer the first shape it made. */
async function fired(
  id: EvolutionId,
  pick: "zones" | "projectiles",
  what: string,
  target = false,
): Promise<{ snapshot: WickSnapshot; at: XY }> {
  const posed = await isolate(h);
  if (target) {
    const stood = posed.run.player;
    await placeEnemy(
      h,
      "hound",
      stood.x + TARGET_AT.dx,
      stood.y + TARGET_AT.dy,
    );
  }
  const firing = await fireWeapon(h, id, 1);
  await disable(h, "weaponFire");
  const made = pick === "zones" ? firing.zones : firing.projectiles;
  assertGreaterThan(
    made.length,
    0,
    `the ${what} ${id}'s firing tick created (specs/evolutions.md)`,
  );
  const shape = made[0]!;
  return {
    snapshot: firing.after,
    at: stagePoint(firing.after, shape.x, shape.y),
  };
}

/** Hold `id` and run the tick the placement phase creates its zone on. */
async function placed(
  id: EvolutionId,
  kind: "lantern" | "aura",
  what: string,
): Promise<{ snapshot: WickSnapshot; at: XY }> {
  await isolate(h);
  await holdWeapon(h, id, 1);
  const snapshot = await h.step(1);
  const made = zonesOfKind(snapshot, kind);
  assertGreaterThan(
    made.length,
    0,
    `the ${what} the first playing tick ${id} is held creates ` +
      "(specs/evolutions.md)",
  );
  const shape = made[0]!;
  return { snapshot, at: stagePoint(snapshot, shape.x, shape.y) };
}

const CASES: readonly Case[] = [
  {
    id: "pyre",
    shape: "slash",
    reach: () => fired("pyre", "zones", "slashes"),
  },
  {
    id: "beacon",
    shape: "bolt",
    reach: () => fired("beacon", "projectiles", "bolts", true),
  },
  {
    id: "hail",
    shape: "dart",
    reach: () => fired("hail", "projectiles", "darts"),
  },
  {
    id: "chandelier",
    shape: "lantern",
    reach: () => placed("chandelier", "lantern", "lanterns"),
  },
  {
    id: "corona",
    shape: "aura",
    reach: () => placed("corona", "aura", "aura"),
  },
  {
    id: "blaze",
    shape: "puddle",
    reach: () => fired("blaze", "zones", "puddles"),
  },
];

it("draws each evolved weapon's shape from the evolution's own effect file", async () => {
  await primeSources(
    h,
    CASES.flatMap((entry) => [...effectFiles(entry.id)]),
  );

  for (const entry of CASES) {
    const { at } = await entry.reach();
    await drawFromAt(
      h,
      await h.lastCalls(),
      effectFiles(entry.id),
      at,
      `${entry.id}'s own produced effect over its live ${entry.shape} ` +
        `(${effectFiles(entry.id).join(", ")})`,
    );
  }
  await captureStill(h, "evolved");
});
