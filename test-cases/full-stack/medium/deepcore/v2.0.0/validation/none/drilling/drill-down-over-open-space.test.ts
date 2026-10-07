// drilling/drill-down-over-open-space — a cut over a hollow does not sink.
//
// specs/character.md: with open space or lava below the cell being cut, the
// miner does not sink; when that cell breaks it falls into the opening.
//
// The scene is one rock cell under the miner with one open cell beneath it and a
// floor under that, so the cut is over a hollow and the fall it ends in is
// bounded and lands on solid ground. Two tiles of fall reaches `693` units per
// second, which `specs/hazards.md` leaves under `IMPACT_SAFE_SPEED` (`700`), so
// the landing costs no hull and nothing but the drill is under test.
//
// The feet are read at every hit while the cell still holds health: they must
// stay where the miner started, within a unit, rather than travelling down
// through the cell as they do over solid ground. Then the miner falls, and where
// it comes to rest is the floor under the opening rather than the lip of it.

import { afterEach, beforeEach, it } from "vitest";
import { assertBetween, assertEqual, assertGreaterThan } from "../assert";
import { TILE } from "../constants";
import {
  ACTION_KEY,
  captureReplay,
  createHarness,
  minerFeet,
  openScene,
  standOn,
  type Harness,
} from "../harness";
import { SAMPLE_FRAMES } from "./hits";

/** A column and a row well clear of the camp, the cave mouth, and the Core. */
const COL = 8;
const ROW = 12;

/** The row the miner lands on: one open cell below the one being cut. */
const FLOOR_ROW = ROW + 2;

/** How far the feet may stray while the cut runs, in world units. */
const HELD = 1;

/** Frames the cut and the fall together may spend. */
const MAX_FRAMES = 600;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("holds the miner up over a hollow, then drops it in", async () => {
  await openScene(h);
  await h.debug.setTile(COL, ROW, "rock");
  await h.debug.setTile(COL, FLOOR_ROW, "rock");
  await standOn(h, COL, ROW);

  const start = await h.snapshot();
  assertEqual(minerFeet(start.miner), ROW * TILE, "specs/character.md");
  assertEqual((await h.tileAt(COL, ROW + 1)).kind, "tunnel", "specs/world.md");

  const cut = await captureReplay(h, "hollow", async () => {
    const held: number[] = [];
    await h.hold(ACTION_KEY.down);
    let broke = false;
    try {
      for (let frames = 0; frames < MAX_FRAMES; frames += SAMPLE_FRAMES) {
        await h.advance(SAMPLE_FRAMES);
        const tile = await h.tileAt(COL, ROW);
        if (tile.kind === "tunnel") {
          broke = true;
          break;
        }
        held.push(minerFeet((await h.snapshot()).miner));
      }
    } finally {
      await h.release(ACTION_KEY.down);
    }
    // The fall the break opens, run to the ground under the hollow.
    const landed = await h.until((s) => s.miner.grounded, {
      maxFrames: MAX_FRAMES,
    });
    await h.advance(1);
    return { held, broke, landed: landed.hit, snapshot: await h.snapshot() };
  });

  assertEqual(cut.broke, true, "specs/character.md");
  assertGreaterThan(cut.held.length, 1, "specs/character.md");
  for (const feet of cut.held) {
    assertBetween(
      feet,
      ROW * TILE - HELD,
      ROW * TILE + HELD,
      "specs/character.md",
    );
  }

  assertEqual(cut.landed, true, "specs/character.md");
  assertBetween(
    minerFeet(cut.snapshot.miner),
    FLOOR_ROW * TILE - HELD,
    FLOOR_ROW * TILE + HELD,
    "specs/character.md",
  );
});
