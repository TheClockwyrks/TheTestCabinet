// lamplighter/key-d-moves-like-arrow-right — KeyD moves the lamplighter like
// ArrowRight.
//
// WHERE THE THRESHOLD COMES FROM. specs/controls.md ("Actions and bindings")
// binds `right` to "ArrowRight, KeyD", read "held on playing", and states: "The
// two keys bound to an action are interchangeable: KeyW does exactly what
// ArrowUp does wherever up is read." specs/world.md ("Movement") gives a held
// `right` the unit vector (1, 0) and moves the lamplighter by it times
// moveSpeed times TICK_DT on every tick, so KeyD held alone must leave player.x
// rising tick over tick, and over the same count of ticks must move the
// lamplighter exactly as far as ArrowRight does.
//
// THE WORLD. An isolated playing run (`isolate`): nothing on the field, no
// weapon held, every driver switch off, so the held key is the only thing that
// can move the lamplighter.
//
// WHAT IS READ, AND WHY IT IS COMPARED TO THE ARROW. Two holds of HELD_TICKS
// each, ArrowRight first and KeyD after it, with an idle frame between so the
// first release has landed before the second press. This point decides that
// the second key is the FIRST key's twin: its displacement over the hold equals
// the arrow's, and player.x rises. The rate itself belongs to
// `move-speed`, so a build whose walk is the wrong speed on both keys loses
// that point once rather than once per key, and a build that never bound KeyD
// moves nothing under it and fails here.
//
// TOLERANCE. MOTION_TOLERANCE (1e-6) on the displacement, the case's tolerance
// for a position integrated tick by tick: the two holds run the same arithmetic
// for the same count of ticks, so they agree to rounding. The direction
// reading is strict.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertGreaterThan, assertWithin } from "../assert";
import { BINDINGS, MOTION_TOLERANCE } from "../constants";
import {
  captureReplay,
  createHarness,
  hold,
  isolate,
  type Harness,
} from "../harness";

/** The two keys specs/controls.md binds to `right`: the arrow, then the letter. */
const ARROW = BINDINGS.right[0];
const KEY = BINDINGS.right[1];

/** Ticks each key is held: half a second. */
const HELD_TICKS = 30;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("moves the lamplighter under KeyD exactly as under ArrowRight", async () => {
  const posed = isolate(h);
  assertEqual(posed.screen, "playing", "the screen the keys are held on");
  assertEqual(KEY, "KeyD", "the second key specs/controls.md binds to right");

  // The arrow first, outside the capture: the displacement this point compares
  // the letter against.
  const beforeArrow = h.snapshot().run.player;
  const afterArrow = (await hold(h, ARROW, HELD_TICKS)).run.player;
  const arrow = {
    x: afterArrow.x - beforeArrow.x,
    y: afterArrow.y - beforeArrow.y,
  };
  await h.tick(1);

  const beforeKey = h.snapshot().run.player;
  const afterKey = (await captureReplay(h, "d", () => hold(h, KEY, HELD_TICKS)))
    .run.player;
  const key = { x: afterKey.x - beforeKey.x, y: afterKey.y - beforeKey.y };

  assertGreaterThan(
    key.x,
    0,
    `player.x's change over ${HELD_TICKS} ticks of ${KEY}`,
  );
  assertWithin(
    key.x,
    arrow.x,
    MOTION_TOLERANCE,
    `player.x's change over ${HELD_TICKS} ticks of ${KEY}, against the same hold of ${ARROW}`,
  );
  assertWithin(
    key.y,
    arrow.y,
    MOTION_TOLERANCE,
    `player.y's change over ${HELD_TICKS} ticks of ${KEY}, against the same hold of ${ARROW}`,
  );
});
