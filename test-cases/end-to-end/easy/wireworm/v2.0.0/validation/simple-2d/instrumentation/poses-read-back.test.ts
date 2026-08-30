// Wireworm — instrumentation.poses-read-back, under the `simple-2d` engine. CASE-PROVIDED.
//
// PLACEHOLDER. The scaffold stage created this file so the manifest resolves; the
// validation stage replaces it with the suite that decides the point. It fails
// deliberately, so an unwritten validator can never read as a passing one.
//
// The point it decides, from `test-case.toml`:
//
// Every pose is reported by the snapshot
//
// Each pose operation's value is read back by snapshot: screen, phase, phase
// timer, menu index, score, lives, level, reached level, cursor position and
// invulnerability, fire cooldown, a node's charge, a worm's headings, diving
// flag and two faculties, a foe's velocity, hit flag and two faculties, a
// bolt's position, and the three world gates. Mute is not in the list: there
// is no setMuted, and muted is a live read of the runtime's bit (section 2).

import { test } from "vitest";

test("instrumentation.poses-read-back", () => {
  throw new Error(
    "wireworm v2.0.0: validation/simple-2d/instrumentation/poses-read-back.test.ts has not been written yet",
  );
});
