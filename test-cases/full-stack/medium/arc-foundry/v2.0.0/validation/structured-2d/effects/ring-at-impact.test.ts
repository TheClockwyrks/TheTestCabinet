// Arc Foundry — effects/ring-at-impact: an Arc-Node's shot lands a ring that
// reaches its splash.
//
// THE REQUIREMENT, from `specs/assets.md`: the discharge ring is spawned when "an
// Arc-Node's shot lands", it carries "an expanding ring covering the splash
// radius", and it is spawned "at the position of the event that raised it: ... the
// ring centered on an Arc-Node's impact point". `specs/components.md` fixes that
// radius: `ARCNODE_SPLASH` is `42` at Scrap.
//
// THE PRODUCED SYSTEMS REACH THE LOADER THROUGH THE HARNESS, which stands the
// committed `assets/` tree up for every check it builds, so what plays is the
// file the build committed.
//
// WHAT IS READ, AND AT WHAT RADIUS. The BAND from four fifths of the Scrap splash
// radius out to the radius itself, sampled on a lattice. The requirement is that
// the ring covers the splash, and the band's inner edge sits a little inside the
// radius rather than on it, because a ring's particles have width of their own
// and an expansion that eases toward its radius is still a ring covering it:
// reading at the radius exactly would fail a build for where its outermost spark
// happened to stop.
//
// A BAND AND NOT A CIRCLE OF POINTS. `./region.ts` states the doctrine — "a
// system spawns its particles at random within its emitters' shapes, so one pixel
// is a coin toss and a lattice over the whole place the specification names is
// not" — and a ring of two dozen sample points is that coin toss: it finds a
// sparse ring only where a spark happens to land on one of them. The band is the
// whole of the ground the specification names, so what decides the point is
// whether anything was drawn out there rather than whether it was drawn at one of
// twenty-four angles. Nothing else can be in it: the structure stands eighty
// units from the impact point, its `2` by `2` footprint nowhere near the band; the
// unit is held at the centre and its `20 x 20` frame is well inside the band's
// inner edge; and `specs/components.md` removes the projectile at the moment it
// applies its damage, so the shot is gone from the frame the reading starts on.
//
// THE COMPARISON IS AGAINST THE SAME BAND BEFORE THE SHOT, which is the second
// half of the requirement.
//
// THE WINDOW IS A SECOND, because a ring expands and NOTHING FIXES HOW FAST. The
// reading runs from the frame of the impact until well past any pace a ring
// covering the splash could plausibly take, and asks that the band be drawn on at
// some point in it. A third of a second is not that: a ring easing out to its
// radius over half a second is a ring covering the splash, and the specification
// gives a build every right to play one.
//
// A MOTE SURVIVES THE HIT. A Scrap Arc-Node deals `5` against the ten health
// `specs/enemies.md` scales a Mote to on wave one at Medium, so no death burst can
// stand in for the ring.

import { afterEach, beforeEach, it } from "vitest";
import { ARCNODE_SPLASH, structureCenter } from "../constants";
import { assertEqual, assertGreaterThan } from "../assert";
import {
  captureReplay,
  createHarness,
  type Harness,
  openYard,
  parkUnit,
  standComponent,
  unitById,
} from "../harness";
import { annulus, read, scan } from "./region";

/** Clear ground, well away from the map's waypoint platforms and its chain. */
const ANCHOR = { col: 21, row: 17 };
const HEAD = structureCenter(ANCHOR.col, ANCHOR.row);

/** Eighty units away, inside the Scrap Arc-Node's stated range of `96`. */
const AT = { x: HEAD.x + 80, y: HEAD.y };

/** The band from four fifths of the Scrap splash radius of `42` out to it. */
const POINTS = annulus(AT, 0.8 * ARCNODE_SPLASH[0]!, ARCNODE_SPLASH[0]!, 3);

/**
 * The rate this check is driven at.
 *
 * EVERY FRAME A PIXEL READING IS TAKEN OVER IS A FRAME THE HOST HAS TO RASTERIZE,
 * so the frames a span is cut into are what such a check costs. The specification
 * fixes no frame size and guarantees that "an interval of simulation time reaches
 * the same state however it was divided into frames and whatever frame rate
 * produced it" (specs/instrumentation.md), so each span below is the span it
 * always was and only the number of frames it is divided into is this check's.
 */
const RING_HZ = 60;

/** How long the band is watched for after the shot lands, in seconds. */
const WATCH_SECONDS = 1;

let h: Harness;

beforeEach(async () => {
  h = await createHarness({ hz: RING_HZ });
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
      { maxFrames: h.ticks(4) },
    );
    return {
      hit: hit.hit,
      readings: await scan(h, POINTS, h.ticks(WATCH_SECONDS)),
    };
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
    "the band from four fifths of the Arc-Node's splash radius out to the " +
      "radius itself to be drawn on after its shot lands, having been bare " +
      "before it, so a discharge ring covering the splash is played there " +
      "(specs/assets.md)",
  );
});
