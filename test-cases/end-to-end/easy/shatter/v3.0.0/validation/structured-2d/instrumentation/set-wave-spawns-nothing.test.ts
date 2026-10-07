// instrumentation/set-wave-spawns-nothing — `setWave(n)` changes the reported
// wave and leaves the field exactly as it was.
//
// THE RULE. `specs/instrumentation.md`, The screen and the run: "`setWave(n)`
// Sets the current wave number. It spawns no rocks and clears none."
//
// WHY IT MATTERS BEYOND THE OPERATION. `specs/progression.md` makes a wave
// number mean something on the field — wave `N` puts up `3 + N` Large rocks, at
// a drift speed scaled by the wave — so a build that treats `setWave` as "start
// wave n" rather than "the wave number is n" would replace the field under every
// scenario that poses a wave to reach a rule about it, and the item that failed
// would be the one reading the rule.
//
// THE ROSTER IS COMPARED WHOLE, AND AT THE CALL. Under this engine a pose acts on
// the live game the moment it is made (`specs/instrumentation.md`), so the two
// readings are taken with no frame between them and the comparison is of the
// operation alone: the same rocks, with the same ids, at the same places, on the
// same courses. Both failure modes are caught by that one comparison — a build
// that SPAWNED reports more rocks, and a build that CLEARED reports fewer.
//
// THE WORLD GATES STAY SHUT throughout, and deliberately: this item is about
// what the OPERATION does, not about what the game's own wave loop does with a
// number. A gate left open would let the loop write the roster between the two
// readings and the check would be grading the wrong thing.
//
// THE BANNER IS READ TOO. `setWave` sets the wave number, and nothing else: the
// `WAVE N` banner is raised by the wave loop on the tick a wave clears
// (`specs/progression.md`), so a build that raised one here has done something
// its row does not name.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual, assertLength } from "../assert";
import { QUIET_CORNER, QUIET_CORNER_OPPOSITE } from "../fixtures";
import {
  captureStill,
  createHarness,
  poseRock,
  startPlaying,
  type Harness,
} from "../harness";

/** The wave the field is posed on, and the one it is posed to. */
const FROM_WAVE = 1;
const TO_WAVE = 7;

/** The two rocks on the field, on quiet ground and far apart. */
const ROCKS = [
  { size: "large", at: QUIET_CORNER },
  { size: "small", at: QUIET_CORNER_OPPOSITE },
] as const;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("changes the reported wave and leaves the rock roster untouched", async () => {
  startPlaying(h);
  h.debug.setWave(FROM_WAVE);
  for (const rock of ROCKS) poseRock(h, rock.size, rock.at.x, rock.at.y);

  const before = h.snapshot();
  assertLength(before.rocks, ROCKS.length, "the field carries the posed rocks");
  assertEqual(before.wave, FROM_WAVE, "the wave the field is posed on");

  h.debug.setWave(TO_WAVE);
  const after = h.snapshot();

  assertEqual(after.wave, TO_WAVE, "setWave reports the wave it was handed");
  assertDeepEqual(
    after.rocks,
    before.rocks,
    `setWave(${TO_WAVE}) spawns no rock and clears none: the roster is the ` +
      "same rocks, with the same ids, at the same places (specs/instrumentation.md)",
  );
  assertEqual(
    after.waveBanner,
    before.waveBanner,
    "setWave raises no WAVE N banner: the banner is the wave loop's " +
      "(specs/progression.md)",
  );
  assertDeepEqual(
    after.bullets,
    before.bullets,
    "setWave leaves the ship's bullets as they stand",
  );
  assertDeepEqual(
    after.enemyBullets,
    before.enemyBullets,
    "setWave leaves the saucer's bullets as they stand",
  );
  assertDeepEqual(
    after.saucer,
    before.saucer,
    "setWave brings in no saucer and removes none",
  );

  // The posed wave number over an untouched field.
  await h.advance(1);
  captureStill(h, "posed");
});
