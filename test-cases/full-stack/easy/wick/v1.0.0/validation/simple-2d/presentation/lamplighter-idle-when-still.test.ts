// presentation/lamplighter-idle-when-still — a tick with no movement direction
// draws the produced idle sprite.
//
// WHERE THE THRESHOLD COMES FROM. specs/assets.md ("Animation"): "The
// lamplighter draws the walk sheet on a tick with a non-zero movement direction
// and the idle sprite on every other tick." Its sprite table fixes the two
// files: "Lamplighter, idle | assets/sprites/lamplighter/idle.png" and
// "Lamplighter, walk | assets/sprites/lamplighter/walk/0.png to 5.png".
//
// THE WORLD. An isolated playing run (`isolate`): nothing on the field, no
// weapon held, every driver switch off, so nothing but the keyboard can move
// the lamplighter. ArrowRight is held for WALKED_TICKS first and released, so
// the run has moved ticks behind it and the idle frame is being asserted
// against a walk cycle that is already running rather than against one that
// never started.
//
// WHAT IS READ. The one frame after the release, which is a tick with no key
// held and so no movement direction: the produced file every blit under
// `sprites/lamplighter/` painted. The idle sprite is drawn and no walk frame
// is, which is the whole of the requirement in this direction.
//
// TOLERANCE. None: a file is drawn or it is not.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertLength } from "../assert";
import {
  BINDINGS,
  LAMPLIGHTER_IDLE_PATH,
  LAMPLIGHTER_WALK_DIR,
} from "../constants";
import {
  assetPath,
  blitsUnderDir,
  captureStill,
  createHarness,
  hold,
  isolate,
  type Harness,
} from "../harness";
import { LAMPLIGHTER_DIR, drawnUnder } from "./drawn";

/** The first key specs/controls.md binds to `right`: ArrowRight. */
const KEY = BINDINGS.right[0];

/** Ticks walked before the release, so a walk cycle is already running. */
const WALKED_TICKS = 10;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("draws the idle sprite on a tick with no movement direction", async () => {
  const posed = isolate(h);
  assertEqual(posed.screen, "playing", "the screen the frames are drawn on");

  const walked = await hold(h, KEY, WALKED_TICKS);
  assertEqual(
    walked.run.player.x > 0,
    true,
    `the lamplighter to have moved over ${WALKED_TICKS} held ticks`,
  );

  // The release dispatched above lands on this frame, so it runs a tick with
  // no movement action held at all.
  const blits = await h.frameBlits();
  captureStill(h, "idle");

  const drawn = drawnUnder(blits, LAMPLIGHTER_DIR, "lamplighter");
  assertEqual(
    drawn.id,
    assetPath(LAMPLIGHTER_IDLE_PATH),
    "the produced file drawn as the lamplighter on a still tick",
  );
  assertLength(
    blitsUnderDir(blits, LAMPLIGHTER_WALK_DIR),
    0,
    "walk frames drawn on a still tick",
  );
});
