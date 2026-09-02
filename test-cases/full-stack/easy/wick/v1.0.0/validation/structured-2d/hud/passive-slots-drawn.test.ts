// hud/passive-slots-drawn — the passive slots carry the held passives' icons, in
// slot order, and carry nothing where no passive is held.
//
// THE REQUIREMENT. `specs/ui.md` — "`playing`", the HUD table: "Passive slots |
// `PASSIVE_SLOTS` (`6`) slots, the same way", which is the weapon slots' row:
// "slots in slot order, each held weapon as its icon with one pip per level
// held, and an empty slot visibly empty". The pips are `hud/level-pips`; this
// point is about the icons and the order.
//
// THE LOADOUT, AND WHY IT IS TWO OF SIX. `specs/progression.md`: "An item enters
// the first free slot of its kind at level `1` and keeps that slot for the rest
// of the run, so slot order is acquisition order." So Brass and Lure taken in
// that order sit in slots `0` and `1`, and slots `2` to `5` are empty.
//
// HOW A SLOT IS READ. `specs/assets.md` produces one icon file per passive and
// `specs/ui.md` has the slot draw it, so the icons are found by the PRODUCED
// FILE each blit's bytes came from, never by a colour or a coordinate.
//
// WHAT "VISIBLY EMPTY" IS READ AS. `specs/ui.md` fixes no styling, so what a
// build draws for an empty slot cannot be asserted. What the spec sentence does
// decide is that no passive's icon is in a slot no passive is in, so the four
// empty slots are read as: the frame drew no passive icon but the two held.
//
// THE ORDER. The two icons are laid out in slot order along whichever axis the
// build ranged the slots on, increasing in the direction a player reads
// (`hud/slots.ts`).

import { afterEach, beforeEach, it } from "vitest";
import { PASSIVE_IDS, PASSIVE_SLOTS, type PassiveId } from "../constants";
import {
  assertDeepEqual,
  assertEqual,
  assertNotNull,
  assertTrue,
} from "../assert";
import {
  captureStill,
  createHarness,
  holdPassive,
  isolate,
  type Harness,
} from "../harness";
import { iconAt, iconsDrawn, inOrder } from "./slots";

/** The passives held, in the order they are taken, which is slot order. */
const HELD: readonly PassiveId[] = ["brass", "lure"];

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("draws the held passives' icons in slot order and no others", async () => {
  isolate(h);
  HELD.forEach((id, slot) => {
    assertEqual(holdPassive(h, id), slot, `the slot ${id} took`);
  });

  const blits = await h.frameBlits();
  captureStill(h, "slots");

  const posed = h.snapshot();
  assertEqual(posed.screen, "playing", "the screen the posed run is on");
  assertDeepEqual(
    posed.run.passives.map((passive) => passive.id),
    [...HELD],
    "the passives the run holds, in slot order",
  );
  assertTrue(
    HELD.length < PASSIVE_SLOTS,
    `a loadout leaving some of the ${PASSIVE_SLOTS} passive slots empty`,
  );

  assertDeepEqual(
    iconsDrawn(blits, PASSIVE_IDS),
    PASSIVE_IDS.filter((id) => HELD.includes(id)),
    "the passive icons the frame drew",
  );

  const places = HELD.map((id) => {
    const at = iconAt(blits, id);
    assertNotNull(at, `where the frame drew ${id}'s icon`);
    return at as { x: number; y: number };
  });
  assertTrue(
    inOrder(places),
    "the held passives' icons laid out in slot order",
  );
});
