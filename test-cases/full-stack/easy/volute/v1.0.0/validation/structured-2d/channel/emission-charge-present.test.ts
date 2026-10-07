// channel/emission-charge-present — a core placed at the inlet carries a charge
// already standing on the channel.
//
// THE SPEC LINE. `specs/channel.md`, "Emission": "An emitted core's charge is
// drawn at random, uniformly over the set of distinct charges on the channel at
// the moment of emission, and uniformly over the level's charge set when the
// channel carries no core." The half this point decides is the first, which is
// what the item's own wording names. The empty-channel fallback belongs to
// `progression/charge-set-table`, where the level's set is what a draw is read
// against.
//
// THE POSE, AND WHY IT LEAVES THE RULE WITH ONE OUTCOME. Level 5, whose charge
// set is all five charges, with the channel posed as a run of three halide cores
// whose tail stands well clear of `SPACING`. `specs/channel.md`'s emission
// condition — "While the level's quota is not exhausted, the inlet emits a core
// at `s = 0` on a tick where the tail core's arc position is at least `SPACING`,
// one core at most per tick" — is therefore already met, so the tick stepped
// after the pose is a tick the inlet emits on, and it emits exactly one core.
// At the moment it does, the distinct charges on the channel are exactly
// `{ halide }`, and a draw uniform over a one-member set has one outcome. The
// specification fixes the emitted charge exactly here, with no probability left
// in it, while a build reaching for the level's set instead lands outside four
// times in five.
//
// SIX DRAWS, EACH POSED. Every draw is read off its own posed hall: the hall is
// re-posed and one tick stepped, six times over. Nothing accumulates between
// them, so no merge extracts, no machinery is granted, and the drive costs six
// ticks whatever a build's generator does. Six independent draws leave a build
// drawing from level 5's five charges one chance in 15625 of looking right.
//
// WHERE THE EMITTED CORE IS READ. The inlet "emits a core at `s = 0`", and
// `specs/instrumentation.md` has the snapshot report the train head first
// ("the train orders them by descending `s`"), so the core the inlet placed is
// the last one reported. The tick is required to have placed exactly one, so the
// reading is of the emitted core rather than of nothing.
//
// THE TOLERANCE. None: a charge id is exact, and one stray charge fails the
// point.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertLength } from "../assert";
import { type ChargeId } from "../constants";
import {
  captureStill,
  createHarness,
  poseHall,
  spacedBlock,
  type Harness,
} from "../harness";

/** The level: five charges in play, so a wrong draw is four times as likely. */
const LEVEL = 5;

/** The single-charge run the channel is posed with. */
const POSED_CHARGE: ChargeId = "halide";
const POSED_HEAD_S = 300;
const POSED_COUNT = 3;

/** Cores left in the quota, so the inlet has one to place on every draw. */
const QUOTA = 12;

/** Emissions read, each off its own posed hall. */
const DRAWS = 6;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("draws an emitted core's charge from the charges on the channel", async () => {
  const emitted: ChargeId[] = [];

  for (let draw = 0; draw < DRAWS; draw += 1) {
    await poseHall(h, {
      level: LEVEL,
      // The requirement IS what the inlet emits, so its gate is the one left
      // open (`specs/instrumentation.md`, `setEmission`).
      emission: true,
      quotaRemaining: QUOTA,
      cores: spacedBlock(POSED_HEAD_S, POSED_COUNT, POSED_CHARGE),
    });

    const standing = (await h.step(1)).train;
    assertLength(
      standing,
      POSED_COUNT + 1,
      `the cores standing after the tick draw ${draw + 1} was emitted on`,
    );
    emitted.push(standing[standing.length - 1]!.charge);
  }

  captureStill(h, "emitted");

  for (const [index, charge] of emitted.entries()) {
    assertEqual(
      charge,
      POSED_CHARGE,
      `the charge of the core the inlet placed onto a halide channel on draw ${index + 1}`,
    );
  }
});
