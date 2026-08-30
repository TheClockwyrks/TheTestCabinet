// Arc Foundry — effects/ring-at-impact: an Arc-Node's shot lands a ring that
// reaches its splash.
//
// THE REQUIREMENT, from `specs/assets.md`: the discharge ring is spawned when "an
// Arc-Node's shot lands", it carries "an expanding ring covering the splash
// radius", and it is spawned "at the position of the event that raised it: ... the
// ring centered on an Arc-Node's impact point". `specs/components.md` fixes that
// radius: `ARCNODE_SPLASH` is `42` at Scrap.
//
// THE PRODUCED SYSTEMS ARE SERVED TO THE LOADER HERE, by `./produced.ts`, so what
// plays is the file the build committed.
//
// WHAT IS READ, AND AT WHAT RADIUS. A circle of points about the impact point, at
// four fifths of the Scrap splash radius. The requirement is that the ring covers
// the splash, and the reading is taken a little inside it rather than exactly on
// it, because a ring's particles have width of their own and an expansion that
// eases toward its radius is still a ring covering it. Reading at the radius
// exactly would fail a build for where its outermost spark happened to stop.
//
// THE CIRCLE HOLDS NOTHING ELSE. The structure stands eighty units from the impact
// point, so its `2` by `2` footprint is nowhere near the circle; the unit is held
// at the centre and its `20 x 20` frame is well inside it; and
// `specs/components.md` removes the projectile at the moment it applies its damage,
// so the shot is gone from the frame the reading starts on. The comparison is
// against the same circle before the shot, which is the second half of the
// requirement.
//
// THE WINDOW IS A THIRD OF A SECOND, because a ring expands: nothing fixes how
// fast, so the reading runs from the frame of the impact until well past any pace a
// ring covering the splash could plausibly take, and asks that the circle be drawn
// on at some point in it.
//
// A MOTE SURVIVES THE HIT. A Scrap Arc-Node deals `5` against the ten health
// `specs/enemies.md` scales a Mote to on wave one at Medium, so no death burst can
// stand in for the ring.

import { afterEach, beforeEach, it } from "vitest";

import { ARCNODE_SPLASH } from "../../src/constants";
import { assertEqual, assertGreaterThan } from "../assert";
import {
  captureReplay,
  createHarness,
  openYard,
  parkUnit,
  standComponent,
  structureCenter,
  ticks,
  unitById,
  type Harness,
} from "../harness";
import { serveProducedAssets } from "./produced";
import { circle, read, scan } from "./region";

/** Clear ground, well away from the map's waypoint platforms and its chain. */
const ANCHOR = { col: 21, row: 17 };
const HEAD = structureCenter(ANCHOR.col, ANCHOR.row);

/** Eighty units away, inside the Scrap Arc-Node's stated range of `96`. */
const AT = { x: HEAD.x + 80, y: HEAD.y };

/** Four fifths of the Scrap splash radius of `42`. */
const POINTS = circle(AT, 0.8 * ARCNODE_SPLASH[0]!, 24);

let h: Harness;

beforeEach(async () => {
  serveProducedAssets();
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("draws out at the splash radius when an Arc-Node's shot lands", async () => {
  openYard(h, { wave: 1 });
  standComponent(h, "arcnode", 1, ANCHOR.col, ANCHOR.row);
  const unit = parkUnit(h, "mote", AT);
  await h.advance(1);
  const before = read(h, POINTS);
  const full = unitById(h.snapshot(), unit).maxHp;

  const landed = await captureReplay(h, "ring", async () => {
    const hit = await h.until(
      (s) => s.units.some((u) => u.id === unit && u.hp < full),
      { maxFrames: ticks(4) },
    );
    return { hit: hit.hit, readings: await scan(h, POINTS, ticks(0.3)) };
  });

  assertEqual(
    landed.hit,
    true,
    "a Scrap Arc-Node's shot to connect with a Mote eighty units away within " +
      "four seconds, at its stated 0.85 shots per second (specs/components.md)",
  );
  assertGreaterThan(
    landed.readings.filter((reading) => reading !== before).length,
    0,
    "the circle at four fifths of the Arc-Node's splash radius to be drawn on " +
      "after its shot lands, having been bare before it, so a discharge ring " +
      "covering the splash is played there (specs/assets.md)",
  );
});
