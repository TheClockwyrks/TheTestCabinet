// maze-movement/no-wall — rock is solid: a held direction into it leaves the
// forager at rest against the face.
//
// specs/movement.md: "Rock is solid to every body. A body's center stays on
// corridor tiles, so it enters a tile only when that tile is open to it, and a
// body standing on a tile whose neighbors are all closed to it stays where it
// stands", and, of the turning rule, "it carries on along its current heading
// while the tile ahead is open, and comes to rest at the center when that tile
// is closed to it". `moving` is `false` while it is at rest (specs/state.md).
//
// SO THE FORAGER SWIMS INTO THE DEAD END RATHER THAN BEING POSED AT IT. Posed
// already against the face, the check would only ask whether a standing forager
// starts; swimming in asks the harder and more useful question — whether a
// forager already travelling is stopped by the rock — and it is the picture the
// clip is of.
//
// THE DEAD END IS POSED. Which tiles of a board have rock on which side is the
// build's own design (specs/maze.md forbids dead ends outright, so no generated
// board offers this shape at all), and specs/instrumentation.md makes a posed
// fixture exempt from those rules: dead ends "are all legal in a fixture, and the
// game keeps running on one". The corridor is one tile wide, so the rock the
// forager meets is the only tile ahead of it and there is nowhere to turn aside
// to.
//
// THE WHOLE DRIVE IS SAMPLED, not just its two ends. What the point forbids is the
// forager EVER standing on the rock tile, and a pair of readings taken at either
// end of the window would miss one that slipped through and came back.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertEqual,
  assertGreaterThanOrEqual,
  assertLessThanOrEqual,
} from "../assert";
import { TILE } from "../constants";
import { poseMaze } from "../fixtures";
import {
  captureReplay,
  centerOf,
  createHarness,
  DIR_KEY,
  startPlaying,
  type Harness,
} from "../harness";
import { MOTION_EPS, requireSceneHeld, sceneGuard } from "../scene";

/**
 * The dead end: the forager starts on `S` and the corridor stops at `W`, with
 * rock beyond it and rock on both flanks. The posed board carries no plankton, so
 * nothing the forager does along it can clear the maze.
 */
const DEAD_END = ["S...W"];

/** The heading the forager runs on, straight into the rock past `W`. */
const INTO = "right" as const;

/**
 * How long the drive is watched, in ticks.
 *
 * The four tiles from `S` to `W` are `120` ticks at `FORAGER_SPEED`, and the key
 * stays down for sixty more — half a second of a forager that should be going
 * nowhere. A hard bound, so a build whose forager never arrives FAILS on the
 * resting-place reading rather than being waited on.
 */
const WATCH_TICKS = 180;

/**
 * How far from the last open tile's center the forager may come to rest, in
 * logical units.
 *
 * The point's own bound: half a tile. A forager stopped at the center of `W` is
 * exactly on it; one stopped a whole tile short never reached the face at all.
 */
const REST_TOLERANCE = TILE / 2;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("stops the forager against rock rather than letting it in", async () => {
  startPlaying(h);
  const board = await poseMaze(h, DEAD_END);
  const start = board.mark("S");
  const last = board.mark("W");
  await h.debug.setForagerTile(start.tx, start.ty);
  await h.debug.setForagerDir(INTO);
  // The forager is the SUBJECT, so it is not held to staying put; the guard still
  // catches a life lost, a predator loose, or the dive leaving live play.
  const guard = await sceneGuard(h, { foragerParked: false });

  const face = centerOf(h.snapshot(), last);
  /** The rock tile the held direction points into. */
  const rock = { tx: last.tx + 1, ty: last.ty };

  const drive = await captureReplay(h, "blocked", async () => {
    const resting = h.snapshot();
    h.hold(DIR_KEY[INTO]);
    const trespass: string[] = [];
    let reach = resting.forager.x;
    for (let tick = 0; tick < WATCH_TICKS; tick += 1) {
      await h.advance(1);
      const snap = h.snapshot();
      const { tx, ty, x } = snap.forager;
      reach = Math.max(reach, x);
      const kind = snap.tiles[ty]?.[tx];
      const where = `(${tx}, ${ty})`;
      if (kind !== "." && !trespass.includes(where)) trespass.push(where);
    }
    const settled = h.snapshot();
    h.release(DIR_KEY[INTO]);
    return { resting, trespass, reach, settled };
  });

  // The scene held: nothing else is on the board, so a life lost, a screen left
  // or a forager somewhere it was never carried is this point's own finding.
  requireSceneHeld(h.snapshot(), guard);

  // The travel this point is about. Nothing else is on the board to have
  // stopped it, so a forager that covered no ground did not do what
  // specs/movement.md has it do while a movement action is held.
  assertGreaterThanOrEqual(
    Math.hypot(
      drive.settled.forager.x - drive.resting.forager.x,
      drive.settled.forager.y - drive.resting.forager.y,
    ),
    MOTION_EPS,
    "the logical units the forager travelled, which it had to to " +
      "swim the corridor up to the rock that closes it",
  );

  assertEqual(
    drive.trespass.join("; "),
    "",
    "tiles the forager stood on that are not corridor, over the whole drive — " +
      `the rock this check drives it into is (${rock.tx}, ${rock.ty})`,
  );

  assertLessThanOrEqual(
    drive.reach,
    face.x + TILE / 2,
    "the furthest the forager's center reached along the corridor, against the " +
      `far edge of the last open tile (${last.tx}, ${last.ty}) — a body's ` +
      "center stays on corridor tiles",
  );

  assertLessThanOrEqual(
    Math.hypot(
      drive.settled.forager.x - face.x,
      drive.settled.forager.y - face.y,
    ),
    REST_TOLERANCE,
    `logical units between where the forager came to rest and the center of ` +
      `the last open tile (${last.tx}, ${last.ty})`,
  );

  assertEqual(
    drive.settled.forager.moving,
    false,
    "the forager reads as travelling after the key has been held into rock for " +
      `${WATCH_TICKS} ticks`,
  );
});
