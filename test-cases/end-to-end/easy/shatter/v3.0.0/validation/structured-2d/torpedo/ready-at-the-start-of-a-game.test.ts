// torpedo/ready-at-the-start-of-a-game — a game opens with the torpedo charged.
//
// THE RULE. `specs/weapons.md`, "The torpedo", The charge: "The ship holds one
// torpedo charge, a number from `0` to `1`. A game begins with the charge at `1`,
// ready to fire." `specs/instrumentation.md` reports both halves of that — the
// number as `torpedoCharge` and "true exactly when the charge is `1`" as
// `torpedoReady` — so a game just opened must read `1` and `true`.
//
// THE GAME IS OPENED THE WAY A PLAYER OPENS ONE, through `startRun`: `reset` for
// the title screen, then `confirm` on the title's highlighted first entry, `PLAY`
// (`specs/ui.md`). No pose on the surface starts a run and this check reaches for
// none — in particular it never calls `setTorpedoCharge`, because a charge the
// check itself set would say nothing about the charge a NEW GAME begins with.
// `startPlaying` is likewise not the route here: it poses the charge full among
// the rest of its ground, which is exactly the fact this item exists to decide.
//
// EVERY WRONG MODEL READS AS A DIFFERENT NUMBER. A build that begins a game with
// the charge EMPTY and makes the player wait out the first recharge reads `0`. A
// build that carries the charge across from the previous game reads whatever that
// game left. A build that reports the charge as a percentage reads `100`. A build
// that computes `torpedoReady` off something other than the charge reads `1` and
// `false`, and the second assertion is what catches it.
//
// THE READING IS TAKEN ON THE FRAME THE GAME OPENED ON, one tick in, so no wave
// has had time to arrive and nothing has had time to spend the charge. The world
// gates are left exactly as `reset` restored them — ON — because a game a player
// opened is a game with its own wave loop running, and this item is about the
// state that game starts in rather than about a field held artificially still.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertLessThanOrEqual } from "../assert";
import { captureStill, createHarness, startRun, type Harness } from "../harness";
import { requireCharge, requireReady } from "./scenario";

/** The seed the run is opened on. Any would do; a fixed one makes the picture stable. */
const SEED = 1;

/**
 * How far below `1` the charge may read on the frame the game opened on, as a
 * fraction of the bar.
 *
 * `1e-9`, which is not room on the figure: `specs/weapons.md` fixes the opening
 * charge at `1` exactly, and a build that sets it to `1` reports `1`. The margin
 * covers nothing but a build that stores the charge as a sum it clamps, whose
 * last addition can land a few floating-point ulps under the whole. A build that
 * opens a game anywhere else on the bar is at least `1 / 1200` — one tick of the
 * refill — away from it, six orders of magnitude outside this.
 */
const FULL_EPSILON = 1e-9;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("opens a game with torpedoCharge 1 and torpedoReady true", async () => {
  await startRun(h, SEED);
  const opened = h.snapshot();
  // The fresh game with its torpedo charged.
  captureStill(h, "charged");

  assertEqual(
    opened.screen,
    "playing",
    "PLAY on the title menu to open a game, so what follows is read off a " +
      "game rather than off the title screen (specs/ui.md)",
  );

  const charge = requireCharge(opened, "the charge a new game begins with");
  assertLessThanOrEqual(
    Math.abs(charge - 1),
    FULL_EPSILON,
    "torpedoCharge to read 1 on the frame a game opened — a game begins with " +
      "the charge at 1, ready to fire (specs/weapons.md); read " +
      `${String(charge)}`,
  );

  assertEqual(
    requireReady(opened, "the readiness a new game begins with"),
    true,
    "torpedoReady to read true on the frame a game opened, which " +
      "specs/instrumentation.md makes true exactly when the charge is 1 " +
      `(specs/weapons.md); the charge read ${String(charge)}`,
  );
});
