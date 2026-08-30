// Arc Foundry — effects/combine-flash: a resolving combine flashes at the result.
//
// THE REQUIREMENT, from `specs/assets.md`: the combine flash is spawned when "a
// combine of either kind resolves" and carries "a convergent flash at the
// resulting structure's footprint", spawned "at the position of the event that
// raised it: ... the combine flash at the resulting structure".
// `specs/scrap-press.md` fixes where that is: "The result lands at the footprint
// of the piece the combine was initiated from."
//
// THE COMBINE IS A PLAIN ONE, ON PURPOSE. Two standing Scrap Capacitors fold into
// one Tuned Capacitor, which `specs/scrap-press.md` calls a plain combine —
// "Standing structures only ... Resolves and leaves the phase running" — so no
// wave starts underneath the reading and nothing else on the yard begins to move.
// The item covers a combine "of either kind", and both kinds resolve through the
// same combine; the harvest kind is what `audio/combine` drives.
//
// WHAT IS READ. The same motion reading as the build spark, and for the same
// reason: the fold replaces the initiating structure, so the footprint looks
// different across the fold whether or not anything was played there. A live
// system leaves the footprint changing frame after frame; a Tuned Capacitor
// standing still does not.
//
// THE RESTING READING IS TAKEN BEFORE THE PARTNER IS STOOD UP. `specs/hud.md` has
// the build draw a mark on every structure that could combine right now, "without
// needing to be selected", and a mark the build animates is a legitimate thing for
// a combinable footprint to be doing. So the initiator is read while it stands
// alone and nothing is combinable, and the partner arrives only for the fold — by
// the end of which the result stands alone again and is not combinable either.

import { afterEach, beforeEach, it } from "vitest";
import { assertGreaterThan, assertGreaterThanOrEqual } from "../assert";
import { structureCenter } from "../constants";
import {
  captureReplay,
  createHarness,
  openYard,
  standComponent,
  ticks,
  type Harness,
} from "../harness";
import { lattice, motion } from "./region";

/** The initiating piece, whose footprint the result lands on. */
const ANCHOR = { col: 24, row: 18 };
/** Its matching partner, four tiles below and clear of it. */
const PARTNER = { col: 24, row: 22 };

const POINTS = lattice(structureCenter(ANCHOR.col, ANCHOR.row), 16, 4);

const WINDOW = ticks(0.1);
const MOVING = WINDOW / 2;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("sets the result's footprint moving when a combine resolves", async () => {
  await openYard(h, { wave: 1 });
  const initiator = await standComponent(
    h,
    "capacitor",
    1,
    ANCHOR.col,
    ANCHOR.row,
  );
  await h.advance(1);
  const still = await motion(h, POINTS, WINDOW);

  const played = await captureReplay(h, "flash", async () => {
    await standComponent(h, "capacitor", 1, PARTNER.col, PARTNER.row);
    await h.debug.combine(initiator);
    await h.advance(1);
    return motion(h, POINTS, WINDOW);
  });

  assertGreaterThan(
    played,
    still,
    "the resulting structure's footprint to change on more frames after a " +
      "combine resolves than before it, so a combine flash is played there " +
      `(specs/assets.md); it changed on ${still} of ${WINDOW} frames before`,
  );
  assertGreaterThanOrEqual(
    played,
    MOVING,
    "the footprint to keep changing across the tenth of a second after the " +
      "fold, as a live particle system does (specs/assets.md)",
  );
});
