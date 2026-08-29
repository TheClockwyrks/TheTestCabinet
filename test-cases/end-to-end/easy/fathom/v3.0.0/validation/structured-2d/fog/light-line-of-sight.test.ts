// fog/light-line-of-sight — the light does not bend around corners.
//
// specs/sensing.md: "The light travels straight. A tile is lit by it when the
// tile's center lies within `V` of the forager's center and the segment joining
// those two centers crosses no rock tile other than that tile itself." A predator
// is drawn only "while it is lit this instant: inside the forager's light", so a
// hunter well inside `V` with rock on the line between them is not drawn, and the
// same hunter is drawn the moment the line opens.
//
// BOTH HALVES ARE READ, AND THE SECOND IS WHAT MAKES THE FIRST WORTH READING.
// "Not lit" is the easiest reading in the game to satisfy by accident: a predator
// out of range, a light that reaches nothing, a build that draws no predators at
// all would each pass it. So the pair is posed inside the light's reach the whole
// way through — the check asserts that of its own fixture — and the forager then
// rounds the corner, where the same predator must be lit.
//
// THE FORAGER MOVES, so the recording carries the whole claim. A still of an unlit
// predator is a still of nothing; a clip of a corridor walk that ends in a hunter
// appearing is the evidence a reviewer can read. It is CARRIED from tile to tile
// through `setForagerTile` rather than driven with a held key: what this point
// reads is where the light reaches from each standing place, and whether a held
// action carries the forager anywhere is the movement points' subject.
//
// THE TRANSITION ITSELF IS NOT JUDGED. Whether a predator is visible from a given
// spot is a question about where the two bodies actually are, and this check knows
// which TILE the forager is on. Those disagree for a few ticks either side of the
// junction: a forager three units short of the junction tile is, to the build,
// already looking down the arm, while a tile-based reading still calls it blocked,
// and nothing in specs/sensing.md settles that either way. So a tick is judged
// blind only while the forager is `BLIND_MARGIN_TILES` back along the corridor,
// and judged clear only once it is on the arm. What happens in between is the
// build's business.
//
// THE PREDATOR IS SCENERY, AND IT IS THE ONLY ONE ON THE BOARD. It is added with
// `mind: false`, which holds it exactly where it stands and leaves everything else
// in the game running (specs/instrumentation.md), so the only thing that changes
// between "not drawn" and "drawn" is where the forager is standing — rather than
// where a patrol happened to wander mid-clip.

import { afterEach, beforeEach, it } from "vitest";
import { BRIGHT_HOLD, VISION_GAIN, VISION_MIN } from "../../src/constants";
import {
  assertEqual,
  assertGreaterThan,
  assertLessThan,
  fail,
} from "../assert";
import { poseMaze, spawnPredator } from "../fixtures";
import {
  captureReplay,
  createHarness,
  startPlaying,
  type Harness,
} from "../harness";
import { parkForager, requireSceneHeld, sceneGuard } from "../scene";
import type { FathomSnapshot } from "../surface";
import type { Tile } from "../maze";

/**
 * The blind corner: the forager starts at `S` and swims right to the junction
 * `J`, and the Gloamfin waits at `P` three tiles down the arm.
 *
 * `S` to `P` is three tiles across and three down, `135.8` logical units, which is
 * inside the `160` the light reaches at `G = 1`, and every line between them
 * crosses the solid block of rock the arm is cut through. The corridor runs on
 * past `J` so a forager that fails to turn is not stopped by rock.
 */
const BLIND_CORNER = ["S..J...", "   .", "   .", "   P"] as const;

/**
 * How far back along the corridor the forager must be for a tick to be judged
 * blind, in tiles.
 *
 * Two, so a whole tile of rock is on the line however either party rounds the
 * corner.
 */
const BLIND_MARGIN_TILES = 2;

/** The widest the light pocket ever opens, in logical units: `V` at `G = 1`. */
const VISION_MAX = VISION_MIN + VISION_GAIN;

/**
 * Ticks the game runs on each standing place before the reading is taken.
 *
 * Four. A build is entitled to recompute its light pocket on the step after the
 * forager is placed rather than during it, and four ticks is past any such beat
 * while the forager is standing still and cannot travel anywhere.
 */
const STAND_TICKS = 4;

/** Ticks the clip lingers on the revealed predator before the recording ends. */
const TAIL_TICKS = 36;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("The light does not bend around corners", async () => {
  startPlaying(h);
  const board = await poseMaze(h, BLIND_CORNER);
  const start = board.mark("S");
  const junction = board.mark("J");
  const post = board.mark("P");
  h.debug.setForagerTile(start.tx, start.ty);
  h.debug.setForagerDir("right");
  // One hunter, on the post, facing the junction it will be revealed from, so the
  // reveal is head-on — and held there, because where it goes next is not what
  // this point reads.
  const gloamfin = await spawnPredator(h, "gloamfin", post, {
    dir: "up",
    mind: false,
  });
  // The widest light in the game, so the predator is inside `V` throughout. The
  // board carries no plankton, so `G` is the one this check posed rather than one
  // a swim down a corridor of pellets kept topping up.
  h.debug.setBrightness(1);
  h.debug.setBrightHold(BRIGHT_HOLD);
  const watch = await sceneGuard(h, { foragerParked: false });

  interface Sample {
    lit: boolean;
    gap: number;
    radius: number;
  }
  const blind: Sample[] = [];
  const clear: Sample[] = [];
  const take = (): FathomSnapshot => {
    const s = h.snapshot();
    const hunter = s.predators[gloamfin];
    if (hunter === undefined) return s;
    const sample: Sample = {
      lit: hunter.lit,
      gap: Math.hypot(hunter.x - s.forager.x, hunter.y - s.forager.y),
      radius: s.visionRadius,
    };
    if (s.forager.ty === junction.ty) {
      if (s.forager.tx <= junction.tx - BLIND_MARGIN_TILES) blind.push(sample);
    } else if (s.forager.ty > junction.ty) {
      clear.push(sample);
    }
    return s;
  };

  // Every standing place, in order: along the corridor to the junction, then down
  // the arm to the tile above the hunter.
  const walk: Tile[] = [];
  for (let tx = start.tx; tx <= junction.tx; tx += 1) {
    walk.push({ tx, ty: junction.ty });
  }
  for (let ty = junction.ty + 1; ty < post.ty; ty += 1) {
    walk.push({ tx: junction.tx, ty });
  }

  const end = await captureReplay(h, "los", async () => {
    for (const tile of walk) {
      h.debug.setForagerTile(tile.tx, tile.ty);
      await h.advance(STAND_TICKS);
      take();
    }
    // Faced into the rock beside it, so the clip ends on the reveal instead of on
    // the forager drifting into the hunter below.
    await parkForager(h);
    await h.advance(TAIL_TICKS);
    return { settled: h.snapshot() };
  });

  requireSceneHeld(end.settled, watch);

  assertGreaterThan(
    blind.length,
    0,
    "ticks spent back along the corridor with rock squarely on the line",
  );
  assertGreaterThan(
    clear.length,
    0,
    "ticks spent on the arm with open water between the two",
  );

  // The fixture's own geometry: the predator was inside the light's reach the whole
  // time it was hidden, so "not lit" is about the rock and not the range.
  const furthest = Math.max(...blind.map((s) => s.gap));
  assertLessThan(
    furthest,
    VISION_MAX,
    "the furthest the predator ever stood while judged blind, in logical units, " +
      `against V at G = 1 (VISION_MIN + VISION_GAIN = ${VISION_MAX})`,
  );
  // And inside the light the BUILD reports, so a build whose radius is wrong is
  // reported by the point that owns the radius rather than by this one.
  const narrowest = Math.min(...blind.map((s) => s.radius));
  if (narrowest <= furthest) {
    fail(
      `the build's own light radius to cover the ${furthest.toFixed(1)} units ` +
        "the predator stood at while it was hidden, so it was behind rock rather " +
        "than out of range",
      `a radius of ${narrowest}`,
    );
  }

  assertEqual(
    blind.filter((s) => s.lit).length,
    0,
    "ticks on which the predator behind rock reported lit, of " +
      `${blind.length} judged blind — the light travels straight ` +
      "(specs/sensing.md)",
  );
  // The control: without it, "never lit" is satisfied by a build that draws no
  // predator anywhere.
  assertGreaterThan(
    clear.filter((s) => s.lit).length,
    0,
    "ticks on which the same predator reported lit once the forager was on the " +
      `arm with open water between them, of ${clear.length} judged clear`,
  );
});
