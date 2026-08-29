// maze-movement/no-den-gate — the den gate is the predators' door, and the
// forager is refused at it.
//
// specs/movement.md: "The den gate and the den interior are open to predators
// alone. A predator crosses the gate leaving the den and returning to it, and the
// forager's travel is over corridor tiles, so the forager stands neither on the
// gate tile nor inside the den chamber." specs/maze.md says the same of the
// chamber: "The forager stands on neither the gate nor a den-interior tile at any
// point."
//
// THE GATE IS POSED, NOT FOUND. Every fixture this suite stamps already carries a
// sealed den — the gate above the chamber with rock on its other three sides — so
// this check draws a one-tile-wide corridor stub down onto that gate's own top
// edge and swims the forager into it. Posing it rather than hunting the build's
// own den keeps the reading about the gate rule: which corridor tiles sit beside a
// generated den, and whether one can be approached in a straight line, is the
// build's own design, and whether the den it laid out is enclosed and has exactly
// one gate is `maze/den-enclosed` and `maze/den-one-exit`'s verdict rather than
// this one's.
//
// THE FORAGER SWIMS IN rather than being posed against the gate, so the reading is
// of a forager already travelling being refused — which is the harder half, and
// the picture the clip is of. The stub is one tile wide with rock on both flanks,
// so there is nowhere to turn aside to: the only conforming outcome is rest on the
// corridor tile above the gate.
//
// EVERY PREDATOR IS HELD IN THE DEN, because the forager is standing on their only
// way out. `setPredatorState(index, "den")` suspends a predator's release time
// (specs/instrumentation.md), and `setMaze` suspends the schedule outright, so
// nothing should come through the gate; the scene guard says so if something does,
// rather than that being read as the forager going somewhere.
//
// THE WHOLE DRIVE IS SAMPLED, not just its two ends: what the point forbids is the
// forager EVER standing on the gate or inside the chamber, and a pair of readings
// taken at either end of the window would miss one that slipped through and came
// back.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { poseMaze, stampLayout } from "../fixtures";
import {
  captureReplay,
  createHarness,
  DIR_KEY,
  startPlaying,
  type Harness,
} from "../harness";
import type { Tile } from "../maze";
import {
  denAll,
  graded,
  requireSceneHeld,
  requireSwim,
  sceneGuard,
} from "../scene";

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

/** Where the sealed den's gate lands, read off the layout the fixture stamps. */
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

afterEach(() => {
  h?.dispose();
});

it("refuses the forager the den gate and the chamber behind it", async (ctx) => {
  await graded(ctx, async () => {
    const opening = await startPlaying(h);
    // Where the sealed den every fixture carries puts its gate, worked out from the
    // stamping rule alone — a pure computation over the grid this build reports,
    // with nothing posed yet — so the stub below can be drawn onto its top edge.
    const gate = gateOf(stampLayout(opening.grid, [], {}).rows);
    assertEqual(
      gate !== null,
      true,
      "the sealed den every posed fixture carries has a gate to swim into",
    );
    if (gate === null) return;

    const board = await poseMaze(
      h,
      ["A", ...Array<string>(STUB_TILES - 1).fill(".")],
      {
        at: { tx: gate.tx, ty: gate.ty - STUB_TILES },
      },
    );
    const start = board.mark("A");
    const posed = h.snapshot();
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
    const quiet = await denAll(h);
    // The forager is the SUBJECT, so it is not held to staying put; the guard still
    // catches a life lost — which is what a predator coming out through the gate
    // under the measurement would cost — a predator loose, or the dive leaving live
    // play.
    const guard = await sceneGuard(h, quiet, { foragerParked: false });

    const drive = await captureReplay(h, "blocked", async () => {
      const resting = h.snapshot();
      h.hold(DIR_KEY[INTO]);
      const onGate: string[] = [];
      const inDen: string[] = [];
      for (let tick = 0; tick < WATCH_TICKS; tick += 1) {
        await h.advance(1);
        const snap = h.snapshot();
        const { tx, ty } = snap.forager;
        const kind = snap.tiles[ty]?.[tx];
        const where = `(${tx}, ${ty})`;
        if (kind === "g" && !onGate.includes(where)) onGate.push(where);
        if (kind === "d" && !inDen.includes(where)) inDen.push(where);
      }
      const settled = h.snapshot();
      h.release(DIR_KEY[INTO]);
      return { resting, onGate, inDen, settled };
    });

    requireSceneHeld(h.snapshot(), guard);

    // A forager that never got under way was never offered the gate; whether a
    // held action moves it at all is `controls/move-*`'s verdict.
    requireSwim(
      drive.resting.forager,
      drive.settled.forager,
      "swim the stub down to the den gate at its foot",
    );

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
});
