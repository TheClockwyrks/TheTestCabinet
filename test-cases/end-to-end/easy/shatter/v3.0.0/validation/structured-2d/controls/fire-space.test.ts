// controls/fire-space — `Space` fires one shot.
//
// `specs/controls.md` binds `Space` to the `a` button and gives `a` its meaning
// while playing — Fire the gun — and `specs/weapons.md` says what one press is
// worth: "One press of the fire key takes one shot when the gate allows it."
//
// THE SHOT IS TAKEN, NOT POSED. `specs/instrumentation.md` is explicit that
// "There is no operation that fires. A caller that wants a round places one; a
// caller checking firing itself drives the fire key and reads the bullets that
// appear." A round placed with `addBullet` would prove nothing about the binding,
// so the key really goes down and what is read is the roster the build's own gun
// code appended to.
//
// THE PRESS IS ONE FRAME LONG, AND THAT IS DELIBERATE. `specs/controls.md` reads
// firing "as a press and as a hold", so a build is free to read either. The
// harness's `tap` holds the key down across exactly one frame, which presents an
// edge to a build reading the press and a non-zero value to a build reading the
// hold, and neither reading can see a second press inside it.
//
// EXACTLY ONE ROUND, AND WHY THE WINDOW IS SHORT. `specs/weapons.md` gates the gun
// at `FIRE_INTERVAL_TICKS` (`22`) whole ticks between shots. The roster is read
// four ticks after the key went down — well inside that gate — so a build that
// answered one press with two rounds is caught, while a build that reads its
// keyboard a tick behind the press still gets its shot in. `startPlaying` poses
// `fireCooldown` at `0`, which is the "gate allows it" the item names.
//
// AND THE ROUND IS THE KEY'S DOING. A quarter second is driven on the posed field
// FIRST, which is longer than the whole of the gun's gate: a build whose gun fires
// on its own clock rather than on the key puts a round up inside it and is caught
// by the reading taken at the end of it.
//
// THE SHIP IS TURNED ACROSS THE FIELD FIRST. `startPlaying` leaves it at the safe
// point facing `FACE_UP`, which points it at the star: the round would fly into
// the core and be absorbed (`specs/collision.md`), so the roster this check counts
// could empty again before it read it. Facing `+x`, the round crosses empty field.
//
// WHAT THIS DOES NOT DECIDE. Where the round leaves from and how fast
// (`bullets/fires-from-the-nose`, `bullets/muzzle-speed`,
// `bullets/inherits-ship-velocity`), the gate itself (`bullets/fire-rate`,
// `bullets/fire-cooldown-blocks`), the four-round cap (`bullets/max-four`), and
// the cue the shot sounds (`audio/fire-cue`).

import { afterEach, beforeEach, it } from "vitest";
import { FIRE_INTERVAL_TICKS } from "../../src/constants";
import { assertLength } from "../assert";
import {
  captureStill,
  createHarness,
  startPlaying,
  ticksFor,
  type Harness,
} from "../harness";

/** The key this point is about, as `specs/controls.md`'s table names it. */
const KEY = "Space";

/**
 * The facing the shot is taken along: `+x`, across the field and clear of the
 * star, which the safe point's own `FACE_UP` would put the round straight into.
 */
const ACROSS_THE_FIELD = 0;

/**
 * The quiet stretch driven before the key goes down, in ticks.
 *
 * A quarter second, which is longer than `FIRE_INTERVAL_TICKS` (`22` ticks, under
 * a fifth of a second — `specs/weapons.md`): a build whose gun runs off its own
 * clock rather than off the key takes at least one shot inside it. The field is
 * empty and the ship is at rest through the whole of it, so nothing else could put
 * a round in the roster either.
 */
const QUIET_LEAD_TICKS = ticksFor(0.25);

/**
 * The ticks driven after the press, on top of the one the press itself is worth.
 *
 * Three, so the whole window from the key going down is four ticks — long enough
 * for a build that reads its keyboard a tick behind the press to get its shot in,
 * and far short of `FIRE_INTERVAL_TICKS` (`22`), so no second shot could be taken
 * inside it even had the key stayed down. A round that appears here is the press's
 * one round, and a second one is a build answering one press with two.
 */
const SETTLE_TICKS = 3;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("puts exactly one round in flight for one press of Space", async () => {
  // Live play on the empty, quiet field, with the ship at the safe point at rest,
  // its fire gate clear, and turned across the field so the round flies clear of
  // the star's core.
  startPlaying(h);
  h.debug.setShipAngle(ACROSS_THE_FIELD);

  await h.advance(QUIET_LEAD_TICKS);
  const unfired = h.snapshot().bullets;

  await h.tap(KEY);
  await h.advance(SETTLE_TICKS);
  const fired = h.snapshot().bullets;
  captureStill(h, "shot");

  assertLength(
    unfired,
    0,
    `rounds in flight after ${String(QUIET_LEAD_TICKS)} ticks of play with ` +
      `no key down — longer than the gun's own ${String(FIRE_INTERVAL_TICKS)}` +
      "-tick gate, and the gun fires on the key rather than on a clock " +
      "(specs/weapons.md)",
  );
  assertLength(
    fired,
    1,
    `rounds in flight ${String(SETTLE_TICKS + 1)} ticks after ${KEY} went ` +
      "down, from a ship whose fire gate was posed clear — one press of the " +
      "fire key takes ONE shot when the gate allows it (specs/weapons.md), " +
      "and Space is the key bound to it (specs/controls.md)",
  );
});
