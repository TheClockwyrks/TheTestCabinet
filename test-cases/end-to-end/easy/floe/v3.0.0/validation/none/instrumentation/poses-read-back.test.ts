// Floe — instrumentation/poses-read-back: SCAFFOLD STUB, NOT A VALIDATOR.
//
// The Validators stage of the Floe v3.0.0 rework replaces this file with the
// real suite for the `instrumentation.poses-read-back` review item, written
// against the `none` engine. Until then it FAILS, deliberately and loudly: a
// stub that passed would score the item a point the build never earned, and a
// stub the Validators stage forgot would be indistinguishable from a passing
// check.
//
// The item this file decides, from test-case.toml:
//
//   Every pose is reported by the snapshot
//
//   Each pose operation's value is read back by snapshot: screen, phase, phase
//   timer, menu index, score, lives, level, reached level, timer, the
//   critter's tile, centre, facing, hop cooldown and best row, a bear's tile,
//   centre, committed step, target and three faculties, a vehicle's and a
//   floe's position, a lane's speed and direction, a bay's filled flag, the
//   fish's bay, and the four world gates. Mute is not in the list: there is no
//   setMuted. The auto-step bit is not in it either: the clock operations pose
//   no state, so nothing is set to read back (section 2).
//
// Its declared media: image `read-back`.

import { it } from "vitest";

const NOT_WRITTEN =
  "Floe: this validator is a scaffold stub and has not been implemented. " +
  "It fails by design; the Validators stage replaces it.";

it("instrumentation/poses-read-back has not been written yet", () => {
  throw new Error(NOT_WRITTEN);
});
