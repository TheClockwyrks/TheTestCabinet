// audio/place-cue — a real press and release on a valid footprint sounds a cue on
// the frame the tower lands, and the same press on an invalid one sounds nothing.
//
// `specs/audio.md`'s cue table: `place` answers "A tower is placed on the floor",
// and a cue "always names one real frame: ... the frame the tower was placed on".
// The other half is the same sentence read backwards: "An event that does not
// resolve raises nothing, so a placement refused as invalid plays no `place`
// cue." `specs/controls.md` fixes what the press means — "The floor, with a
// placement armed on a valid footprint | The tower is placed", and "with a
// placement armed on an invalid footprint | Nothing is built and nothing is
// spent" — and `specs/building.md` what landing does: "The money falls by exactly
// the type's build cost", "A tower of the held type appears on the held
// footprint".
//
// THE PRESSES ARE MADE WITH CHROMIUM'S OWN MOUSE, and they have to be.
// `specs/instrumentation.md`: "No operation on this surface plays a cue, and none
// can ... Every cue is reached the way a player reaches it." A placement posed
// through `place()` is entitled to be silent in a perfectly good build, so this
// point drives the whole path a player drives: the type is armed by pressing the
// shop entry the PANEL reported (`specs/hud.md` leaves where it sits to the build
// and reports the rectangle it chose), and the floor is pressed at a logical point
// mapped through the harness's own fit. `mousePress` runs one frame after each of
// the three pointer events, so the frame an interaction lands on is exactly the
// one frame run after the RELEASE — which is where the cue falls whether the
// build resolves the press in its own event handler and plays the cue from the
// next frame, or reads the pointer inside its update.
//
// WHAT MAKES THE SECOND FOOTPRINT INVALID, AND WHY THAT ONE. `specs/building.md`
// requires of a valid footprint that "Every tile of the footprint is open", and
// `specs/mazing.md` has a tower block "every tile of its footprint from the frame
// it lands". So the second press lands on the footprint of the tower the FIRST
// press just placed: the pointer sits on that footprint's own centre, which
// `specs/building.md`'s clamp puts the held preview back on exactly, tile for
// tile. It is invalid for one stated reason and no other — the money is still
// well above the Arc's cost, so the placement is still armed and the press is
// still a placement press; the floor is not sealed; there is no build zone in
// Containment; and no unit is on the floor at all.
//
// THE ARM IS PART OF THE SILENCE. Arming resolves no event of the cue table
// (`specs/controls.md` gives it no cue, and `specs/audio.md`'s table has none), so
// the shop press, the quiet stretch after it, both frames of the valid press
// before its release, and every frame of the invalid press must all be silent.
// Only one frame of this whole drive is allowed to sound.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertDeepEqual,
  assertEqual,
  assertGreaterThan,
  assertNotNull,
} from "../assert";
import {
  captureStill,
  createHarness,
  framesFor,
  startRun,
  watchCues,
  type Harness,
} from "../harness";
import { TOWER_DEFS, footprintCentre } from "../constants";
import { FREE_SITE } from "../fixtures";
import { armFromShop, framesOtherThan, mousePress, soundsOn } from "./cues";

/** The type placed: the cheapest emitter, `2x2` at `15` (`specs/towers.md`). */
const TYPE = "arc" as const;
const SIZE = TOWER_DEFS[TYPE].size;
const COST = TOWER_DEFS[TYPE].cost;

/** Quiet play driven after the arm and again between the two presses, in frames. */
const QUIET_FRAMES = framesFor(0.3);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h?.dispose();
});

it("sounds on the frame the tower lands, and not on a refused placement", async () => {
  await startRun(h);
  await h.armAudio();

  // Watched from before the arm, so the shop press and every frame of the two
  // floor presses are inside what is read.
  const played = watchCues(h);

  const armed = await armFromShop(h, TYPE);
  assertNotNull(
    armed.snapshot.build,
    "the held preview after a press on the shop entry the panel reported",
  );
  assertEqual(
    armed.snapshot.build?.type,
    TYPE,
    "the type the shop press armed",
  );

  await h.advance(QUIET_FRAMES);
  const moneyBefore = (await h.snapshot()).money;

  // The valid press: the pointer on a quiet anchor, clear of both corridors and
  // of every opening.
  const site = footprintCentre(FREE_SITE.col, FREE_SITE.row, SIZE);
  const good = await mousePress(h, site.x, site.y);
  const placeFrame = good.frame;

  assertEqual(
    good.moved.build?.valid,
    true,
    "the held footprint's validity, with the pointer on the open anchor",
  );
  assertEqual(
    good.snapshot.towers.length,
    1,
    "the towers on the floor once the press and release resolved",
  );
  assertEqual(
    good.snapshot.money,
    moneyBefore - COST,
    `the money left after a ${TYPE} at ${COST} landed, from ${moneyBefore}`,
  );

  await h.advance(QUIET_FRAMES);
  await captureStill(h, "place");

  // The invalid press: the same armed type, the same kind of press, on the
  // footprint the first one just blocked.
  const placed = good.snapshot.towers[0];
  const taken = footprintCentre(placed.col, placed.row, placed.size);
  const refused = await mousePress(h, taken.x, taken.y);

  assertEqual(
    refused.moved.build?.valid,
    false,
    "the held footprint's validity, with the pointer on the placed tower",
  );
  assertEqual(
    refused.snapshot.towers.length,
    1,
    "the towers on the floor once the refused press resolved",
  );
  assertEqual(
    refused.snapshot.money,
    good.snapshot.money,
    "the money left after a refused placement, which spends nothing",
  );

  assertGreaterThan(
    soundsOn(played, placeFrame),
    0,
    `sounds emitted on frame ${placeFrame}, the frame the tower landed`,
  );
  assertDeepEqual(
    framesOtherThan(played, placeFrame),
    [],
    "the frames of every sound emitted away from the placement: the shop " +
      "press, the quiet stretches, and the refused placement",
  );
});
