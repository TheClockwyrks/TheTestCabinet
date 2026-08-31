// bullets/fire-cooldown-blocks — the gun refuses a shot inside its gate.
//
// specs/weapons.md fixes the gate as `FIRE_INTERVAL_TICKS` (`22`) whole ticks
// between shots, and specs/instrumentation.md gives it an address:
// `setFireCooldown(ticks)` "sets the whole ticks until the gun may fire again",
// and the snapshot reports the same number back as `ship.fireCooldown`. That is
// the one place the gate can be posed rather than waited out, and this item reads
// what the gun does when it is.
//
// TWO READINGS, AND THE SECOND IS WHAT MAKES THE FIRST MEAN ANYTHING. With the
// gate posed at ten ticks a press adds no round; ten ticks later, with the gate
// run down, the same press adds one. Without the second reading a build that
// ignores the fire key altogether, or that never installed a working
// `setFireCooldown`, would pass the first by doing nothing at all — the failure
// mode this pairing exists to catch. Without the first, a build with no gate at
// all would pass.
//
// TEN TICKS RATHER THAN THE GATE'S OWN TWENTY-TWO, because the number posed is
// the caller's: `setFireCooldown` takes whole ticks and says nothing about which
// ones, and a figure other than `FIRE_INTERVAL_TICKS` reads a gate the build is
// honouring rather than one it happened to reload. The press that is refused
// lands with nine or ten ticks still on the gate, and the press that is allowed
// lands with none, so neither reading sits on the boundary.
//
// THE FIELD IS EMPTY AND THE CAP IS NOWHERE NEAR IT. `startPlaying` leaves no
// rock and no saucer, and at most one round exists at a time here, so the only
// thing that can refuse a shot in this scenario is the gate.

import { afterEach, beforeEach, it } from "vitest";
import { assertLength } from "../assert";
import {
  captureStill,
  createHarness,
  startPlaying,
  type Harness,
} from "../harness";
import { fireOnce } from "./gun";

/** Where the ship is posed, and which way it faces: along the field's bottom lane. */
const LANE_Y = 690;
const SHIP_X = 200;
const FACING = 0;

/** The gate this scenario poses, in whole ticks. */
const GATE_TICKS = 10;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("refuses a shot while the gate is up and takes one once it has run down", async () => {
  startPlaying(h);
  h.debug.setShipPosition(SHIP_X, LANE_Y);
  h.debug.setShipVelocity(0, 0);
  h.debug.setShipAngle(FACING);

  h.debug.setFireCooldown(GATE_TICKS);
  await fireOnce(h);
  const gated = h.snapshot();
  // The gun refusing a shot inside its gate.
  captureStill(h, "gated");

  assertLength(
    gated.bullets,
    0,
    `no round added by a press taken with ${GATE_TICKS} ticks still on the ` +
      `gun's gate (specs/weapons.md, specs/instrumentation.md: ` +
      `setFireCooldown sets the whole ticks until the gun may fire again)`,
  );

  // The press that the gate no longer refuses: the control that says the gun
  // answers to this key at all.
  await h.advance(GATE_TICKS);
  await fireOnce(h);

  assertLength(
    h.snapshot().bullets,
    1,
    `exactly one round added by the same press ${GATE_TICKS} ticks later, ` +
      `with the gate run down (specs/weapons.md, specs/controls.md: one press ` +
      `takes one shot when the gate allows it)`,
  );
});
