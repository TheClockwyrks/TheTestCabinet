// hud/weapon-slots-drawn — six weapon slots, drawn in slot order.
//
// THE REQUIREMENT. `specs/ui.md` — "`playing`", the HUD table: "Weapon slots |
// `WEAPON_SLOTS` (`6`) slots in slot order, each held weapon as its icon with one
// pip per level held, and an empty slot visibly empty". This point decides the
// six slots, the order, and the empty ones; the pips are `hud/level-pips`.
//
// WHERE THE SIX SLOTS ARE. `specs/ui.md` fixes no layout, so the slots are found
// rather than looked for: a night holding six weapons draws six icons, and where
// those six landed is where the six slots are. Because the specification has the
// HUD carry six slots whatever is held, those places do not move when three of
// them empty. "In slot order" is read the way a reader reads a row, a column, or
// a grid: down the rows a build laid them in, left to right within a row.
//
// WHICH ICON IS WHOSE. `specs/assets.md` — "The icons": each item's icon is its
// own produced `24 x 24` file, reached through the bundler, which inlines a small
// PNG as a `data:` URI — so an icon is never recognized by a path. Each of the
// three is named by holding that weapon ALONE and reading the one icon the frame
// then drew; the three names are what the ordered frame is checked against.
//
// THE READING, AND THE TOLERANCE. Three weapons held draws exactly three icons,
// which is what "an empty slot visibly empty" says about the other three: a slot
// carrying no icon. Each of the three sits within `BLIT_TOL` (one unit) of the
// slot it belongs to, which is the whole of the allowance, since both frames are
// the same build drawing the same six slots and a build is free to round a
// position to the pixel grid.

import { afterEach, beforeEach, it } from "vitest";
import { BLIT_TOL, WEAPON_SLOTS, type WeaponId } from "../constants";
import { assertEqual, assertLessThanOrEqual } from "../assert";
import {
  captureStill,
  createHarness,
  holdWeapon,
  type Harness,
} from "../harness";
import { iconDraws, iconKey, readingOrder } from "./readouts";
import { drawnCalls, poseNight } from "./stage";

/** The three the point is about, in the order they are held. */
const HELD: readonly WeaponId[] = ["taper", "ember", "pin"];

/** Six weapons whose slots stand for the six the HUD carries. */
const SIX: readonly WeaponId[] = [
  "taper",
  "ember",
  "pin",
  "spark",
  "shard",
  "sconce",
];

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("draws the held weapons' icons in the first three of six slots", async () => {
  /** The icon a weapon is drawn with, read off a night holding it alone. */
  const iconOf = async (id: WeaponId): Promise<string> => {
    await poseNight(h);
    await holdWeapon(h, id, 1);
    const alone = iconDraws(await drawnCalls(h));
    assertEqual(alone.length, 1, `the icons drawn with ${id} held alone`);
    return iconKey(alone[0]!);
  };
  const wanted: string[] = [];
  for (const id of HELD) wanted.push(await iconOf(id));

  await poseNight(h);
  for (const id of SIX) await holdWeapon(h, id, 1);
  const filled = iconDraws(await drawnCalls(h)).sort(readingOrder);
  assertEqual(
    filled.length,
    WEAPON_SLOTS,
    `the icons drawn with all ${WEAPON_SLOTS} weapon slots held`,
  );

  await poseNight(h);
  for (const id of HELD) await holdWeapon(h, id, 1);
  const drawn = iconDraws(await drawnCalls(h)).sort(readingOrder);
  await captureStill(h, "slots");

  assertEqual(
    drawn.length,
    HELD.length,
    `the icons drawn with ${HELD.join(", ")} held, the other ${
      WEAPON_SLOTS - HELD.length
    } slots empty`,
  );
  for (const [slot, id] of HELD.entries()) {
    const icon = drawn[slot]!;
    const at = filled[slot]!;
    assertLessThanOrEqual(
      Math.hypot(icon.cx - at.cx, icon.cy - at.cy),
      BLIT_TOL,
      `how far the icon in weapon slot ${slot} sits from that slot, in units`,
    );
    assertEqual(
      iconKey(icon),
      wanted[slot],
      `the icon in weapon slot ${slot}, which holds ${id}`,
    );
  }
});
