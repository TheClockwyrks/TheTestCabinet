// maze-movement/no-den-gate — the den gate is the predators' door, and the
// forager is refused at it.
//
// `specs/movement.md`: "The den gate and the den interior are open to predators
// alone. A predator crosses the gate leaving the den and returning to it, and the
// forager's travel is over corridor tiles, so the forager stands neither on the
// gate tile nor inside the den chamber." `specs/maze.md` says the same of the
// chamber: "The forager stands on neither the gate nor a den-interior tile at any
// point."
//
// THE GATE IS POSED, NOT FOUND. The fixture draws its own den: a one-tile-wide
// corridor stub running down onto a gate, with the chamber below that. Posing it
// rather than hunting the build's own den keeps the reading about the gate rule —
// which corridor tiles sit beside a generated den, and whether one can be
// approached in a straight line, is the build's own design, and whether the den it
// laid out is enclosed and has exactly one gate is `maze/den-enclosed` and
// `maze/den-one-exit`'s verdict rather than this one's.
//
// THE FORAGER SWIMS IN rather than being posed against the gate, so the reading is
// of a forager already travelling being refused — which is the harder half, and
// the picture the clip is of. The stub is one tile wide with rock on both flanks,
// so there is nowhere to turn aside to: the only conforming outcome is rest on the
// corridor tile above the gate.
//
// THE CHAMBER IS EMPTY, because the forager is standing on its only way out.
// Posing the fixture takes every predator off the roster, so nothing can come up
// through the gate and turn a reading about the forager's travel into a reading
// about a hunter's.
//
// THE WHOLE DRIVE IS SAMPLED, not just its two ends: what the point forbids is the
// forager EVER standing on the gate or inside the chamber, and a pair of readings
// taken at either end of the window would miss one that slipped through and came
// back.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertNotNull } from "../assert";
import { ARROW_KEY } from "../constants";
import { poseMaze } from "../fixtures";
import {
  captureReplay,
  createHarness,
  type Harness,
  startPlaying,
} from "../harness";
import { requireSceneHeld, sceneGuard } from "../scene";
import type { Tile } from "../maze";

/**
 * How much corridor the stub carries above the gate, in tiles.
 *
 * The anchor sits at the top of it and the gate one tile below the bottom, so the
 * forager has three tiles of run to be under way in before it meets the gate.
 */
const STUB_TILES = 4;

/** The heading the stub runs on, straight into the gate at its foot. */
const INTO = "down" as const;

/**
 * How long the drive is watched, in ticks.
 *
 * The three tiles down the stub are `90` ticks at `FORAGER_SPEED`, and the key
 * stays down for sixty more — half a second of a forager that should be going
 * nowhere. A hard bound, so a build whose forager never arrives FAILS on the
 * resting-place reading rather than being waited on.
 */
const WATCH_TICKS = 150;

/** Where the fixture's gate landed, read off the layout the build reports. */
function gateOf(rows: readonly string[]): Tile | null {
  for (let ty = 0; ty < rows.length; ty += 1) {
    const tx = rows[ty].indexOf("g");
    if (tx >= 0) return { tx, ty };
  }
  return null;
}

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("refuses the forager the den gate and the chamber behind it", async () => {
  await startPlaying(h);
  // The stub, the gate at its foot, and one chamber tile behind that.
  const board = await poseMaze(h, [
    "A",
    ...Array<string>(STUB_TILES - 1).fill("."),
    "g",
    "d",
  ]);
  const start = board.mark("A");
  const posed = await h.snapshot();
  const gate = gateOf(posed.tiles);
  assertNotNull(
    gate,
    "the den gate the fixture posed, read back off the board",
  );
  if (gate === null) return;
  /** The corridor tile the stub ends on, directly above the gate. */
  const outside = { tx: gate.tx, ty: gate.ty - 1 };
  assertEqual(
    posed.tiles[gate.ty]?.[gate.tx],
    "g",
    `the tile below (${outside.tx}, ${outside.ty}) is the den gate the fixture ` +
      "posed — specs/instrumentation.md has a posed layout used exactly as given",
  );

  await h.debug.setForagerTile(start.tx, start.ty);
  await h.debug.setForagerDir(INTO);
  // The forager is the SUBJECT, so it is not held to staying put; the guard still
  // catches a life lost — which is what a predator coming out through the gate
  // under the measurement would cost — a predator loose, or the dive leaving live
  // play.
  const guard = await sceneGuard(h, { foragerParked: false });

  const drive = await captureReplay(h, "blocked", async () => {
    const resting = await h.snapshot();
    await h.hold(ARROW_KEY[INTO]);
    const onGate: string[] = [];
    const inDen: string[] = [];
    for (let tick = 0; tick < WATCH_TICKS; tick += 1) {
      await h.advance(1);
      const snap = await h.snapshot();
      const { tx, ty } = snap.forager;
      const kind = snap.tiles[ty]?.[tx];
      const where = `(${tx}, ${ty})`;
      if (kind === "g" && !onGate.includes(where)) onGate.push(where);
      if (kind === "d" && !inDen.includes(where)) inDen.push(where);
    }
    const settled = await h.snapshot();
    await h.release(ARROW_KEY[INTO]);
    return { resting, onGate, inDen, settled };
  });

  requireSceneHeld(await h.snapshot(), guard);

  assertEqual(
    drive.onGate.join("; "),
    "",
    "gate tiles the forager stood on over the whole drive, holding the " +
      `direction into the gate at (${gate.tx}, ${gate.ty})`,
  );
  assertEqual(
    drive.inDen.join("; "),
    "",
    "den-interior tiles the forager stood on over the whole drive",
  );
  assertEqual(
    `${drive.settled.forager.tx}, ${drive.settled.forager.ty}`,
    `${outside.tx}, ${outside.ty}`,
    "the tile the forager came to rest on, which is the corridor tile outside " +
      "the gate",
  );
  assertEqual(
    drive.settled.forager.moving,
    false,
    "the forager reads as travelling after the key has been held into the gate " +
      `for ${WATCH_TICKS} ticks`,
  );
});
