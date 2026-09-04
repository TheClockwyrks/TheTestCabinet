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
// THE PREDATOR IS SCENERY, AND IT IS THE ONLY ONE. `poseMaze` clears the roster,
// the drifters and the plankton, this check spawns back the one hunter it is
// about, and `setPredatorMind(index, false)` holds it exactly where it stands
// while the rest of the simulation runs (specs/instrumentation.md). So the only
// thing that changes between "not drawn" and "drawn" is where the forager is
// standing — rather than where a patrol happened to wander mid-clip. The bare
// board also keeps `G` the one this check posed rather than one a swim down a
// corridor of pellets kept topping up.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertGreaterThan, assertLessThan } from "../assert";
import { BRIGHT_HOLD, VISION_GAIN, VISION_MIN } from "../constants";
import { poseMaze, spawnPredator } from "../fixtures";
import {
  captureReplay,
  createHarness,
  DIR_KEY,
  poseBrightness,
  requireForagerMotion,
  startPlaying,
  ticks,
  type Harness,
} from "../harness";
import {
  fromForager,
  parkForager,
  requireSceneHeld,
  sceneGuard,
} from "../scene";
import { FathomSnapshot } from "../surface";

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
 * never gets there fails rather than being waited for.
 */
const LEG_MAX_TICKS = ticks(2);

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
  await startPlaying(h);
  const board = await poseMaze(h, BLIND_CORNER);
  const start = board.mark("S");
  const junction = board.mark("J");
  const post = board.mark("P");

  h.debug.setForagerTile(start.tx, start.ty);
  h.debug.setForagerDir("right");
  // Facing the junction it will be revealed from, so the reveal is head-on, and
  // held there for the whole drive.
  const gloamfin = await spawnPredator(h, "gloamfin", post, {
    dir: "up",
    state: "wander",
    mind: false,
  });
  // The widest light in the game, so the predator is inside `V` throughout.
  await poseBrightness(h, 1, BRIGHT_HOLD);
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
      gap: fromForager(s, hunter.x, hunter.y),
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
    // tile, and specs/movement.md honors a perpendicular direction at the next
    // tile center the forager reaches, which is the junction's own.
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

  // The drive reached the arm, which is the reveal this point is about: a forager
  // that never rounded the corner never crossed from blind to clear.
  requireForagerMotion(
    end.before,
    end.settled,
    "round the corner the predator waits behind",
  );
  assertEqual(
    end.arrived && end.onArm,
    true,
    `the forager reached the junction and then the arm below it within ` +
      `${LEG_MAX_TICKS} ticks a leg, which is the crossing this point reads`,
  );

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

  // The fixture's own geometry: the predator was inside the light's reach the
  // whole time it was hidden, so "not lit" is about the rock and not the range.
  const furthest = Math.max(...blind.map((s) => s.gap));
  assertLessThan(
    furthest,
    VISION_MAX,
    "the furthest the predator ever stood while judged blind, in logical " +
      `units, against V at G = 1 (VISION_MIN + VISION_GAIN = ${VISION_MAX})`,
  );
  // And inside the light the BUILD reports, so a build whose radius is wrong is
  // reported by the point that owns the radius rather than by this one.
  const narrowest = Math.min(...blind.map((s) => s.radius));
  assertGreaterThan(
    narrowest,
    furthest,
    `the narrowest light radius the build reported across the blind stretch, ` +
      `against the ${furthest.toFixed(1)} units the predator stood at its ` +
      "furthest — a predator outside the pocket is out of range rather than " +
      "behind rock, and this point reads the rock",
  );

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
    `ticks on which the same predator reported lit once the forager was on ` +
      `the arm with open water between them, of ${clear.length} judged clear`,
  );
});
