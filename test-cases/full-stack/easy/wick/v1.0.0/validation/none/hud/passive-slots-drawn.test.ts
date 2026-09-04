// hud/passive-slots-drawn — six passive slots, drawn in slot order.
//
// THE REQUIREMENT. `specs/ui.md` — "`playing`", the HUD table: "Passive slots |
// `PASSIVE_SLOTS` (`6`) slots, the same way", after the weapon row's "`6` slots
// in slot order, each held weapon as its icon ... and an empty slot visibly
// empty". This point decides the six passive slots, the order, and the empty
// ones; the pips are `hud/level-pips`.
//
// WHERE THE SIX SLOTS ARE, AND WHICH ICON IS WHOSE. As in
// `hud/weapon-slots-drawn`, and for the same reasons: `specs/ui.md` fixes no
// layout, so a night holding six passives draws six icons and where those landed
// is where the six slots are, and each of the two the point is about is named by
// holding it ALONE and reading the one icon the frame then drew.
// `specs/assets.md` puts each icon in its own produced `24 x 24` file, reached
// through the bundler, so an icon is recognized by the source drawn and never by
// a path.
//
// THE READING, AND THE TOLERANCE. Two passives held draws exactly two icons,
// which is what "an empty slot visibly empty" says about the other four. Each
// sits within `BLIT_TOL` (one unit) of the slot it belongs to, the allowance a
// build's rounding of a position to the pixel grid needs and no more.

import { afterEach, beforeEach, it } from "vitest";
import { BLIT_TOL, PASSIVE_SLOTS, type PassiveId } from "../constants";
import { assertEqual, assertLessThanOrEqual } from "../assert";
import {
  captureStill,
  createHarness,
  holdPassive,
  type Harness,
} from "../harness";
import { iconDraws, iconKey, readingOrder } from "./readouts";
import { drawnCalls, poseNight } from "./stage";

/** The two the point is about, in the order they are held. */
const HELD: readonly PassiveId[] = ["brass", "lure"];

/** Six passives whose slots stand for the six the HUD carries. */
const SIX: readonly PassiveId[] = [
  "wick",
  "oil",
  "glass",
  "brass",
  "mirror",
  "bellows",
];

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("draws the held passives' icons in the first two of six slots", async () => {
  /** The icon a passive is drawn with, read off a night holding it alone. */
  const iconOf = async (id: PassiveId): Promise<string> => {
    await poseNight(h);
    await holdPassive(h, id, 1);
    const alone = iconDraws(await drawnCalls(h));
    assertEqual(alone.length, 1, `the icons drawn with ${id} held alone`);
    return iconKey(alone[0]!);
  };
  const wanted: string[] = [];
  for (const id of HELD) wanted.push(await iconOf(id));

  await poseNight(h);
  for (const id of SIX) await holdPassive(h, id, 1);
  const filled = iconDraws(await drawnCalls(h)).sort(readingOrder);
  assertEqual(
    filled.length,
    PASSIVE_SLOTS,
    `the icons drawn with all ${PASSIVE_SLOTS} passive slots held`,
  );

  await poseNight(h);
  for (const id of HELD) await holdPassive(h, id, 1);
  const drawn = iconDraws(await drawnCalls(h)).sort(readingOrder);
  await captureStill(h, "slots");

  assertEqual(
    drawn.length,
    HELD.length,
    `the icons drawn with ${HELD.join(", ")} held, the other ${
      PASSIVE_SLOTS - HELD.length
    } slots empty`,
  );
  for (const [slot, id] of HELD.entries()) {
    const icon = drawn[slot]!;
    const at = filled[slot]!;
    assertLessThanOrEqual(
      Math.hypot(icon.cx - at.cx, icon.cy - at.cy),
      BLIT_TOL,
      `how far the icon in passive slot ${slot} sits from that slot, in units`,
    );
    assertEqual(
      iconKey(icon),
      wanted[slot],
      `the icon in passive slot ${slot}, which holds ${id}`,
    );
  }
});
