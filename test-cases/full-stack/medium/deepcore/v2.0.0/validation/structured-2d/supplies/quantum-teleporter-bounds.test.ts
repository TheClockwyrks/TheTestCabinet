// Deepcore — supplies/quantum-teleporter-bounds: the drop is inside its stated
// ranges.
//
// `specs/items.md`: the Quantum Teleporter "places the miner above the camp
// ground at a height drawn uniformly from `1` to `8` tiles with a downward speed
// drawn uniformly from `150` to `700` units per second, then lets the normal
// physics carry it down."
//
// The teleporter is used from deep underground over many draws, and each
// placement is read on the call itself, before any frame runs, so what is
// measured is where the item put the miner rather than where gravity had taken it
// by the time it was looked at. The height is the miner's feet above `SURFACE_Y`,
// which is the world `y` `specs/world.md` gives the camp's ground line.
//
// The draws are the game's own, so this reads the RANGE over many draws rather
// than any particular value; `supplies/quantum-teleporter-posed` reads a posed one. Two distinct heights are required
// across them: a build that returns one fixed height every time is not drawing
// from a range. The last draw is then let fall, because the rest of the sentence
// is that ordinary physics takes it down, and it must come to rest on the camp.

import { afterEach, beforeEach, it } from "vitest";
import { assertBetween, assertEqual, assertGreaterThan } from "../assert";
import {
  MINER_H,
  SURFACE_Y,
  TELEPORT_HEIGHT_TILES_MAX,
  TELEPORT_HEIGHT_TILES_MIN,
  TELEPORT_SPEED_MAX,
  TELEPORT_SPEED_MIN,
  TILE,
} from "../constants";
import {
  captureReplay,
  createHarness,
  layFloor,
  openScene,
  pinDrill,
  standOn,
  type Harness,
} from "../harness";

/** How many draws are taken. Enough for a fixed placement to stand out. */
const DRAWS = 16;

/** The floor the miner is teleported away from, well underground. */
const DEEP_COL = 10;
const DEEP_FLOOR_ROW = 30;

/** Frames each draw is left falling for, so the recording shows it. */
const SHOWN_FRAMES = 8;

/** Floating-point slack on a bound the specification states exactly. */
const EPSILON = 0.001;

/** Frames the last draw is let fall for: eight tiles at these speeds land inside this. */
const FALL_FRAMES = 300;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("drops the miner over the camp inside the stated height and speed", async () => {
  openScene(h);
  // The camp's whole width is solid, so a drop anywhere along it lands, and a
  // floor underground is what the miner is teleported away from.
  layFloor(h, 1);
  layFloor(h, DEEP_FLOOR_ROW);
  pinDrill(h);
  h.debug.setItemCount("quantum-teleporter", DRAWS);

  const drops = await captureReplay(h, "drop", async () => {
    const taken: { height: number; vy: number }[] = [];
    for (let i = 0; i < DRAWS; i += 1) {
      standOn(h, DEEP_COL, DEEP_FLOOR_ROW);
      h.debug.useItem("quantum-teleporter");
      const { miner } = h.snapshot();
      taken.push({
        height: (SURFACE_Y - (miner.y + MINER_H)) / TILE,
        vy: miner.vy,
      });
      // The draw is already read; these frames are for the recording.
      await h.advance(SHOWN_FRAMES);
    }
    return taken;
  });

  assertEqual(drops.length, DRAWS, "draws taken");
  for (const [i, drop] of drops.entries()) {
    assertBetween(
      drop.height,
      TELEPORT_HEIGHT_TILES_MIN - EPSILON,
      TELEPORT_HEIGHT_TILES_MAX + EPSILON,
      `tiles above the camp ground on draw ${i + 1}`,
    );
    assertBetween(
      drop.vy,
      TELEPORT_SPEED_MIN - EPSILON,
      TELEPORT_SPEED_MAX + EPSILON,
      `downward speed on draw ${i + 1}`,
    );
  }

  assertGreaterThan(
    new Set(drops.map((drop) => drop.height.toFixed(4))).size,
    1,
    `distinct heights over ${DRAWS} draws`,
  );

  // And the ordinary physics carries it down onto the camp.
  const landing = await h.until((s) => s.miner.grounded, {
    maxFrames: FALL_FRAMES,
    poll: 1,
  });
  assertEqual(landing.hit, true, "the miner reached the camp ground");
});
