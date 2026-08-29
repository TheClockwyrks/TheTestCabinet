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
// predator is a still of nothing; a clip of a corridor swim that ends in a hunter
// appearing is the evidence a reviewer can read.
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
// THE PREDATOR IS SCENERY. `setCreatureAI(false)` holds every creature exactly
// where it stands and leaves the rest of the simulation running
// (specs/instrumentation.md), so the only thing that changes between "not drawn"
// and "drawn" is where the forager is standing — rather than where a patrol
// happened to wander mid-clip.

import { afterEach, beforeEach } from "vitest";
import { VISION_GAIN, VISION_MIN } from "../../src/constants";
import { assertEqual, assertGreaterThan, assertLessThan } from "../assert";
import { poseMaze } from "../fixtures";
import {
  DIR_KEY,
  captureReplay,
  createHarness,
  startPlaying,
  ticksFor,
  type Harness,
} from "../harness";
import {
  check,
  denAll,
  failPrecondition,
  indexOfKind,
  parkForager,
  requireSceneHeld,
  requireSwim,
  sceneGuard,
} from "../scene";
import type { FathomSnapshot } from "../surface";

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
 * How long each leg of the swim is given, in ticks.
 *
 * Three tiles is `96` logical units, which `FORAGER_SPEED` (`128`) covers in
 * `0.75 s`. Two seconds is a wide margin and still a hard ceiling, so a build that
 * never gets there is stood down rather than waited for.
 */
const LEG_MAX_TICKS = ticksFor(2);

/** Ticks the clip lingers on the revealed predator before the recording ends. */
const TAIL_TICKS = 36;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

check("The light does not bend around corners", async () => {
  startPlaying(h);
  const board = await poseMaze(h, BLIND_CORNER);
  const start = board.mark("S");
  const junction = board.mark("J");
  const post = board.mark("P");
  const gloamfin = indexOfKind(h.snapshot(), "gloamfin");
  if (gloamfin < 0) {
    failPrecondition(
      "the roster to carry a Gloamfin for this scenario to pose behind the rock",
      "scoring/depth-scaling",
      "no gloamfin on the roster",
    );
  }
  const quiet = await denAll(h, [gloamfin]);

  h.debug.setForagerTile(start.tx, start.ty);
  h.debug.setForagerDir("right");
  h.debug.setPredatorTile(gloamfin, post.tx, post.ty);
  // Facing the junction it will be revealed from, so the reveal is head-on.
  h.debug.setPredatorDir(gloamfin, "up");
  h.debug.setPredatorState(gloamfin, "wander");
  h.debug.setCreatureAI(false);
  // No plankton to graze, so `G` is the one this check posed rather than one a
  // swim down a corridor of pellets kept topping up.
  h.debug.clearPlankton();
  // The widest light in the game, so the predator is inside `V` throughout.
  h.debug.setBrightness(1);
  const watch = await sceneGuard(h, quiet, { foragerParked: false });

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

  const end = await captureReplay(h, "los", async () => {
    const before = h.snapshot();
    // Along the corridor, judging every tick by where the forager stands.
    h.hold(DIR_KEY.right);
    let arrived = false;
    for (let i = 0; i < LEG_MAX_TICKS && !arrived; i += 1) {
      await h.advance(1);
      arrived = take().forager.tx >= junction.tx;
    }
    // The buffered turn: `down` is set while the forager is inside the junction
    // tile, and specs/movement.md honors a perpendicular direction at the next tile
    // center the forager reaches, which is the junction's own.
    h.release(DIR_KEY.right);
    h.hold(DIR_KEY.down);
    let onArm = false;
    for (let i = 0; i < LEG_MAX_TICKS && !onArm; i += 1) {
      await h.advance(1);
      onArm = take().forager.ty >= junction.ty + 1;
    }
    h.release(DIR_KEY.down);
    // Parked rather than merely released, so the clip ends on the reveal instead
    // of on the forager drifting into the hunter three tiles below.
    await parkForager(h);
    await h.advance(TAIL_TICKS);
    const settled = h.snapshot();
    return { before, settled, arrived, onArm };
  });

  requireSceneHeld(end.settled, watch);

  // Whether the forager travels is `controls/*` and `maze-movement/*`'s verdict.
  if (!end.arrived || !end.onArm) {
    requireSwim(
      end.before.forager,
      end.settled.forager,
      "round the corner the predator waits behind",
    );
    failPrecondition(
      `the forager to reach ${end.arrived ? "the arm below the junction" : "the junction"} ` +
        `within ${LEG_MAX_TICKS} ticks a leg, so the reveal this point is about ` +
        "happens at all",
      "maze-movement/turn-at-center and maze-movement/constant-speed",
      `it ended at (${end.settled.forager.tx}, ${end.settled.forager.ty})`,
    );
  }

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
    failPrecondition(
      `the build's own light radius to cover the ${furthest.toFixed(1)} units ` +
        "the predator stood at while it was hidden, so it was behind rock rather " +
        "than out of range",
      "brightness/widens-vision",
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
