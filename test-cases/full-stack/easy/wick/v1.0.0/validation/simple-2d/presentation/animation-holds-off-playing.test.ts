// presentation/animation-holds-off-playing — every animation holds still on a
// screen that does not tick.
//
// WHERE THE THRESHOLD COMES FROM. specs/assets.md ("Animation"): "Every
// animation runs on ticks, so it holds still on every screen but playing."
// specs/ui.md ("What advances on each screen") fixes that `paused` ticks
// nothing: "levelup, chest, paused | Nothing. The world beneath holds exactly
// the tick it was at", and ("paused") that the world is still drawn: "The world
// held still, with the HUD, under PAUSED_TEXT."
//
// THE WORLD. An isolated playing run (`isolate`): every driver switch off, so
// no enemy moves or is hit while the pause is watched. One moth and one beetle
// are spawned clear of the lamplighter, each with an age posed a few ticks into
// a frame of its sheet, and ArrowRight is held for WALKED_TICKS so the
// lamplighter is mid-walk when the pause arrives. `setScreen("paused")` poses
// the pause "exactly as pause does", and HELD_FRAMES frames are drawn on it.
//
// WHAT IS READ. On every one of the HELD_FRAMES paused frames, the produced
// file drawn for the lamplighter and for each enemy. Each is the file the first
// paused frame drew. A build whose animations run off wall-clock time, or off
// the frame counter rather than the tick, changes at least one of them within
// HELD_FRAMES frames, which is a full second of frames.
//
// TOLERANCE. None: a frame drew a file or it drew another one.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { BINDINGS } from "../constants";
import {
  blitsOf,
  captureStill,
  createHarness,
  isolate,
  spawnEnemyAt,
  type Harness,
} from "../harness";
import { LAMPLIGHTER_DIR, drawnUnder, enemyDir } from "./drawn";

/** The first key specs/controls.md binds to `right`: ArrowRight. */
const KEY = BINDINGS.right[0];

/** Ticks walked before the pause, so the walk cycle is running. */
const WALKED_TICKS = 8;

/** Frames drawn on the pause: a full second of them. */
const HELD_FRAMES = 60;

/** The two enemies posed, each with an age a few ticks into a frame. */
const POSED = [
  { type: "moth", at: { x: 260, y: -120 }, age: 0.25 },
  { type: "beetle", at: { x: -260, y: 140 }, age: 0.05 },
] as const;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("holds every drawn frame still across a second of paused frames", async () => {
  const posed = isolate(h);
  assertEqual(posed.screen, "playing", "the screen the run is paused from");
  for (const enemy of POSED) {
    const id = spawnEnemyAt(h, enemy.type, enemy.at.x, enemy.at.y);
    h.debug.setEnemyAge(id, enemy.age);
  }

  h.holdKey(KEY);
  try {
    await h.tick(WALKED_TICKS);
  } finally {
    h.releaseKey(KEY);
  }

  h.debug.setScreen("paused");
  assertEqual(
    h.snapshot().screen,
    "paused",
    "the screen the frames are drawn on",
  );

  const read = (): Record<string, string> => {
    const blits = blitsOf(h.lastCalls());
    const drawn: Record<string, string> = {
      lamplighter: drawnUnder(blits, LAMPLIGHTER_DIR, "lamplighter").id,
    };
    for (const enemy of POSED) {
      drawn[enemy.type] = drawnUnder(
        blits,
        enemyDir(enemy.type),
        enemy.type,
      ).id;
    }
    return drawn;
  };

  await h.frameDraw();
  captureStill(h, "held");
  const first = read();

  for (let frame = 2; frame <= HELD_FRAMES; frame += 1) {
    await h.frameDraw();
    const now = read();
    for (const [what, file] of Object.entries(first)) {
      assertEqual(
        now[what],
        file,
        `the file drawn for the ${what} on paused frame ${frame}`,
      );
    }
  }
});
