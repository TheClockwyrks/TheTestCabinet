// progression/respawn-spawns-worm — the level's worm enters afresh when play
// resumes.
//
// `specs/progression.md`, Losing a life: "When that timer runs out, the phase
// becomes `active`, the cursor is given `RESPAWN_INVULN` (`2.0` s) of spawn-in
// invulnerability, and the level's worm enters afresh at the level's own
// length." The level's own length is `specs/worm.md`'s
// `wormLength(level) = WORM_BASE_LENGTH + WORM_LENGTH_PER_LEVEL * (level - 1)`.
//
// So the run is posed at a level whose worm is NOT the base length — level `3`,
// which carries `14` segments rather than `10` — and the roster is read on the
// frame play resumes. A build that brings in no worm answers with an empty
// board; one that brings in the level-1 worm whatever the level answers `10`;
// one that brings the CONTACT's worm back rather than a fresh one answers `1`,
// since the worm this scenario lost the life to is a single segment; a correct
// build answers one worm of `14`.
//
// `setWormEntry(true)` is the gate this point is about, and it is the reason the
// gate exists: `startPlaying` shuts it so that no scenario in this suite has a
// worm materialize inside it, and the points whose requirement IS the entry open
// it again. Nothing enters at the moment it is opened — a worm enters as a
// banner or a respawn gives way to live play, and this board is already
// `active` — so the only entry the sweep can see is the respawn's.
//
// The sweep's bound is not a tolerance on the respawn's length: it only has to
// reach the frame play resumes.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertLength } from "../assert";
import { RESPAWN_TIME, wormLength } from "../constants";
import {
  captureStill,
  createHarness,
  framesFor,
  startPlaying,
  type Harness,
} from "../harness";
import { contactCursor } from "./run";

/** The level posed, chosen so its worm is longer than the base length. */
const LEVEL = 3;

/** The segments `specs/worm.md`'s formula gives that level: 14. */
const EXPECTED_LENGTH = wormLength(LEVEL);

/** How far the sweep to the resumption of play may run, in seconds. */
const SWEEP_LIMIT = RESPAWN_TIME + 0.5;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h?.dispose();
});

it("brings in a worm of the level's length when play resumes", async () => {
  await startPlaying(h, { level: LEVEL });
  await h.debug.setWormEntry(true);

  await contactCursor(h);
  const resumed = await h.until((snapshot) => snapshot.phase === "active", {
    maxFrames: framesFor(SWEEP_LIMIT),
    poll: 1,
  });

  await captureStill(h, "entered");
  assertEqual(
    resumed.snapshot.phase,
    "active",
    `precondition: play resumed within ${SWEEP_LIMIT}s of the contact`,
  );
  assertLength(
    resumed.snapshot.worms,
    1,
    "the worms on the board as play resumed",
  );
  assertLength(
    resumed.snapshot.worms[0].segments,
    EXPECTED_LENGTH,
    `the segments the level-${LEVEL} worm entered with`,
  );
});
