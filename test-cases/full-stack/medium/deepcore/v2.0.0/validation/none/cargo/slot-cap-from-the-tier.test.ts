// cargo/slot-cap-from-the-tier — the bay capacity is the cargo tier's.
//
// specs/upgrades.md: the cargo track "sets the cargo capacity in ore slots",
// `15`, `25`, `40`, `70` and `120` across its five tiers, and weight is a separate
// limit set by the jetpack. specs/instrumentation.md has the snapshot report that
// capacity as `cargo.slotCap`.
//
// So each tier is posed in turn and the capacity read against the table. The
// jetpack tier is left where a fresh expedition opens it, so nothing here moves
// the weight limit alongside the slot one.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { CARGO_CAPACITY, JETPACK_LIFT_LIMIT, MAX_TIER } from "../constants";
import {
  captureStill,
  createHarness,
  layCamp,
  openScene,
  pinDrill,
  pinMiner,
  stageTiers,
  standAtCamp,
  type Harness,
} from "../harness";

/** The tier the still is taken at: a raised one, so it is not the opening bay. */
const SHOWN_TIER = 4;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("reports the capacity the cargo tier gives, tier by tier", async () => {
  await openScene(h);
  await layCamp(h);
  await standAtCamp(h);
  await pinMiner(h);
  await pinDrill(h);

  const opening = await h.snapshot();
  assertEqual(opening.tiers.cargo, 1, "specs/expedition.md");
  assertEqual(opening.cargo.slotCap, CARGO_CAPACITY[0], "specs/upgrades.md");

  for (let tier = 1; tier <= MAX_TIER.cargo; tier += 1) {
    await stageTiers(h, { cargo: tier });
    const snapshot = await h.snapshot();
    assertEqual(
      snapshot.cargo.slotCap,
      CARGO_CAPACITY[tier - 1],
      `cargo tier ${tier} (specs/upgrades.md)`,
    );
    // And the weight limit, which the jetpack sets, did not move with it.
    assertEqual(
      snapshot.cargo.liftLimitKg,
      JETPACK_LIFT_LIMIT[0],
      `cargo tier ${tier} (specs/upgrades.md)`,
    );
  }

  await stageTiers(h, { cargo: SHOWN_TIER });
  await h.debug.setPanel("inventory");
  await h.advance(1);
  await captureStill(h, "cap");
  assertEqual(
    (await h.snapshot()).cargo.slotCap,
    CARGO_CAPACITY[SHOWN_TIER - 1],
    "specs/upgrades.md",
  );
});
