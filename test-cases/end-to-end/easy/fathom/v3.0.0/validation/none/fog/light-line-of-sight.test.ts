// fog/light-line-of-sight — the light does not bend around corners.
//
// `specs/sensing.md`: "The light travels straight. A tile is lit by it when the
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
// and nothing in `specs/sensing.md` settles that either way. So a tick is judged
// blind only while the forager is `BLIND_MARGIN_TILES` back along the corridor,
// and judged clear only once it is on the arm. What happens in between is the
// build's business.
//
// THE PREDATOR IS SCENERY. `setCreatureAI(false)` holds every creature exactly
// where it stands and leaves the rest of the simulation running
// (`specs/instrumentation.md`), so the only thing that changes between "not drawn"
// and "drawn" is where the forager is standing — rather than where a patrol
// happened to wander mid-clip.

import { afterEach, beforeEach } from "vitest";
import { assertEqual, assertGreaterThan, assertLessThan } from "../assert";
import { ARROW_KEY, VISION_GAIN, VISION_MIN } from "../constants";
import {
  placeForager,
  placePredator,
  poseMaze,
  predatorIndex,
} from "../fixtures";
import {
  captureReplay,
  createHarness,
  ticks,
  type FathomSnapshot,
  type Harness,
  startPlaying,
} from "../harness";
import {
  check,
  denAll,
  parkForager,
  requireSceneHeld,
  requireSwim,
  sceneGuard,
  unmetPrecondition,
} from "../scene";

/**
 * The blind corner: the forager starts at `S` and swims right to the junction `J`,
 * and the Gloamfin waits at `P` three tiles down the arm.
 *
 * `S` to `P` is three tiles across and three down, `135.8` logical units, which is
 * inside the `160` the light reaches at `G = 1`, and every line between them
 * crosses the solid block of rock the arm is cut through. The corridor runs on past
 * `J` so a forager that fails to turn is not stopped by rock.
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
const LEG_MAX_TICKS = ticks(2);

/** Ticks the clip lingers on the revealed predator before the recording ends. */
const TAIL_TICKS = 36;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

check(
  "leaves a predator behind rock unlit and lights it once the corner is rounded",
  async () => {
    await startPlaying(h);
    const board = await poseMaze(h, BLIND_CORNER);
    const start = board.mark("S");
    const junction = board.mark("J");
    const post = board.mark("P");
    const gloamfin = predatorIndex(await h.snapshot(), "gloamfin");
    if (gloamfin === null) {
      unmetPrecondition(
        "the roster carries no gloamfin for this scenario to pose behind the rock — " +
          "what the roster holds is the progression checks' verdict, not this one's",
      );
    }
    const quiet = await denAll(h, [gloamfin]);

    await placeForager(h, start, "right");
    // Facing the junction it will be revealed from, so the reveal is head-on.
    await placePredator(h, gloamfin, post, { dir: "up", state: "wander" });
    await h.debug.setCreatureAI(false);
    // No plankton to graze, so `G` is the one this check posed rather than one a swim
    // down a corridor of pellets kept topping up.
    await h.debug.clearPlankton();
    // The widest light in the game, so the predator is inside `V` throughout.
    await h.debug.setBrightness(1);
    const guard = await sceneGuard(h, quiet, { foragerParked: false });

    interface Sample {
      lit: boolean;
      gap: number;
      radius: number;
    }
    const blind: Sample[] = [];
    const clear: Sample[] = [];
    const take = async (): Promise<FathomSnapshot> => {
      const snap = await h.snapshot();
      const hunter = snap.predators[gloamfin];
      if (hunter === undefined) return snap;
      const sample: Sample = {
        lit: hunter.lit,
        gap: Math.hypot(hunter.x - snap.forager.x, hunter.y - snap.forager.y),
        radius: snap.visionRadius,
      };
      if (snap.forager.ty === junction.ty) {
        if (snap.forager.tx <= junction.tx - BLIND_MARGIN_TILES) {
          blind.push(sample);
        }
      } else if (snap.forager.ty > junction.ty) {
        clear.push(sample);
      }
      return snap;
    };

    const end = await captureReplay(h, "los", async () => {
      const before = await h.snapshot();
      // Along the corridor, judging every tick by where the forager stands.
      await h.hold(ARROW_KEY.right);
      let arrived = false;
      for (let i = 0; i < LEG_MAX_TICKS && !arrived; i += 1) {
        await h.advance(1);
        arrived = (await take()).forager.tx >= junction.tx;
      }
      // The buffered turn: `down` is set while the forager is inside the junction
      // tile, and `specs/movement.md` honors a perpendicular direction at the next
      // tile center the forager reaches, which is the junction's own.
      await h.release(ARROW_KEY.right);
      await h.hold(ARROW_KEY.down);
      let onArm = false;
      for (let i = 0; i < LEG_MAX_TICKS && !onArm; i += 1) {
        await h.advance(1);
        onArm = (await take()).forager.ty >= junction.ty + 1;
      }
      await h.release(ARROW_KEY.down);
      // Parked rather than merely released, so the clip ends on the reveal instead of
      // on the forager drifting into the hunter three tiles below.
      await parkForager(h);
      await h.advance(TAIL_TICKS);
      const settled = await h.snapshot();
      return { before, settled, arrived, onArm };
    });

    requireSceneHeld(end.settled, guard);

    // Whether the forager travels is `controls/*` and `maze-movement/*`'s verdict.
    if (!end.arrived || !end.onArm) {
      requireSwim(
        end.before.forager,
        end.settled.forager,
        "round the corner the predator waits behind",
      );
      unmetPrecondition(
        `the forager did not reach ` +
          `${end.arrived ? "the arm below the junction" : "the junction"} within ` +
          `${LEG_MAX_TICKS} ticks a leg, so the reveal this point is about never ` +
          `happened — how the forager travels and turns is maze-movement's verdict, ` +
          `not this one's`,
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
    const furthest = Math.max(...blind.map((sample) => sample.gap));
    assertLessThan(
      furthest,
      VISION_MAX,
      `the furthest the predator ever stood while judged blind, in logical units, ` +
        `against V at G = 1 (VISION_MIN + VISION_GAIN = ${VISION_MAX})`,
    );
    // And inside the light the BUILD reports, so a build whose radius is wrong is
    // reported by the point that owns the radius rather than by this one.
    const narrowest = Math.min(...blind.map((sample) => sample.radius));
    if (narrowest <= furthest) {
      unmetPrecondition(
        `the build's own light radius fell to ${narrowest} while the predator stood ` +
          `${furthest.toFixed(1)} units away, so it was out of range rather than ` +
          `behind rock — the radius is brightness/widens-vision's verdict`,
      );
    }

    assertEqual(
      blind.filter((sample) => sample.lit).length,
      0,
      `ticks on which the predator behind rock reported lit, of ${blind.length} ` +
        `judged blind — the light travels straight (specs/sensing.md)`,
    );
    // The control: without it, "never lit" is satisfied by a build that draws no
    // predator anywhere.
    assertGreaterThan(
      clear.filter((sample) => sample.lit).length,
      0,
      `ticks on which the same predator reported lit once the forager was on the ` +
        `arm with open water between them, of ${clear.length} judged clear`,
    );
  },
);
