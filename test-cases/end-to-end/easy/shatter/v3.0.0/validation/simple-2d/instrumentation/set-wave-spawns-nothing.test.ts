// instrumentation/set-wave-spawns-nothing — `setWave(n)` changes the reported wave
// number and leaves the rock roster exactly as it stood.
//
// THE FAULT THIS HUNTS. `specs/instrumentation.md` says of `setWave` only that it
// "Sets the current wave number. It spawns no rocks and clears none." The natural
// wrong implementation is the one that reaches for the routine the game already
// has — "begin wave N" — which `specs/progression.md` defines as putting up
// `WAVE_BASE_ROCKS + N` Large rocks over an emptied field. A build that wires the
// pose to that routine reports the right number and puts eleven rocks on a field
// the caller was holding for something else, which is precisely the kind of pose
// that fabricates an outcome instead of arranging one.
//
// SO THE FIELD IS POSED FULL FIRST, AND READ BACK BY ID. Three rocks of three
// sizes stand on the field when the wave is posed. A build that spawned would be
// caught by the count; a build that cleared and respawned the same number would be
// caught by the ids; and a build that left the roster alone but moved the rocks
// would be caught by the positions, which are compared with no tick in between —
// under this engine the state the reading is taken against IS the state the pose
// returned, so nothing but the pose can have touched them.
//
// AND THE WAVE IS POSED BOTH WAYS. Up first, from the wave `startPlaying` opened
// on to a much later one, and then back DOWN to an earlier one. A build that only
// ever advances its wave counter — because the only mover it has is the wave-clear
// transition — reads back the wrong number on the second pose, and a build that
// treats a lowered wave as the start of a fresh run is caught spawning there.
//
// NO BANNER EITHER. `specs/progression.md` raises the `WAVE N` banner on the tick a
// wave CLEARS, which is a rock being destroyed and not a number being written, so a
// pose that raised one has announced a wave that never turned over.

import { afterEach, beforeEach, it } from "vitest";
import { assertCloseTo, assertDeepEqual, assertEqual } from "../assert";
import {
  captureStill,
  createHarness,
  poseRock,
  startPlaying,
  ticksFor,
  type Harness,
} from "../harness";
import type { ShatterSnapshot } from "../surface";

/** Where the three rocks stand: spread, at rest, and well clear of the star. */
const PLACES = [
  { size: "large", x: 200, y: 160 },
  { size: "medium", x: 1080, y: 160 },
  { size: "small", x: 200, y: 620 },
] as const;

/**
 * The waves posed, in order: a long way up from wave 1, and then back down.
 *
 * Neither is the wave `startPlaying` opened on, and neither is `0`, so a build
 * that ignored the pose entirely reads back a number that is not the one asked
 * for on both legs.
 */
const POSED_WAVES = [9, 4] as const;

/** The game time each posed wave is left to stand before the field is reread. */
const SETTLE_FRAMES = ticksFor(0.5);

/**
 * The decimal places a rock's position is held to across the pose.
 *
 * Six, which is to say exactly. No tick runs between the pose and the reading, so
 * a rock that has not been touched reports the bits it reported a moment ago.
 */
const HELD_DIGITS = 6;

let h: Harness;

/** The roster as a comparable list: every rock's id and size, in roster order. */
function rosterOf(snapshot: ShatterSnapshot): [number, string][] {
  return snapshot.rocks.map((rock) => [rock.id, rock.size]);
}

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("changes the wave number and leaves the rocks exactly as they stood", async () => {
  startPlaying(h);
  for (const place of PLACES) poseRock(h, place.size, place.x, place.y);
  await h.advance(1);

  const roster = rosterOf(h.snapshot());
  assertEqual(roster.length, PLACES.length, "the rocks the field held");

  for (const wave of POSED_WAVES) {
    // The field as it stands on the tick the pose is made. It is read afresh for
    // each leg rather than once at the top: the rocks are falling toward the star
    // between the legs, which is the game doing exactly what it should, and what
    // this check is about is the difference the POSE made across no time at all.
    const held = h.snapshot();
    h.debug.setWave(wave);

    // Read with NO tick between the pose and the reading: the state read here is
    // the state `setWave` returned, so a roster that changed was changed by it.
    const posed = h.snapshot();
    assertEqual(posed.wave, wave, `setWave(${wave}) reads back`);
    assertDeepEqual(
      rosterOf(posed),
      roster,
      `the rock roster setWave(${wave}) left, by id and size`,
    );
    for (const [index, rock] of held.rocks.entries()) {
      assertCloseTo(
        posed.rocks[index].x,
        rock.x,
        HELD_DIGITS,
        `rocks[${index}].x across setWave(${wave})`,
      );
      assertCloseTo(
        posed.rocks[index].y,
        rock.y,
        HELD_DIGITS,
        `rocks[${index}].y across setWave(${wave})`,
      );
    }
    assertCloseTo(
      posed.waveBanner,
      0,
      HELD_DIGITS,
      `the banner setWave(${wave}) raised (specs/progression.md raises one on a ` +
        `wave CLEARING, which is a rock destroyed)`,
    );

    // And half a second on, which catches a build that defers its spawn to the
    // next update rather than doing it inside the pose.
    await h.advance(SETTLE_FRAMES);
    const settled = h.snapshot();
    assertEqual(settled.wave, wave, `the posed wave still reads ${wave}`);
    assertDeepEqual(
      rosterOf(settled),
      roster,
      `the rock roster half a second after setWave(${wave})`,
    );
  }

  captureStill(h, "posed");
});
