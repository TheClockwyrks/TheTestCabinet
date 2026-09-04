// instrumentation/edit-acceptance-independent-of-the-renderer — the editor reads
// nothing from the camera.
//
// `specs/instrumentation.md` § A deterministic core: "Render-free core. Game
// state advances from ticks and input alone, independent of the canvas, of the
// renderer, and of wall-clock time. The dependency runs one way: the simulation
// reads nothing from the renderer, and whether an edit is accepted is decided
// from the structure and the site alone."
//
// THE TWO CAMERA POSES ARE THE FARTHEST APART THE SPECIFICATION ALLOWS, so a
// build whose editor leaned on the view — picking against the projection, or
// refusing what it could not draw — is caught by the widest span there is.
// `specs/controls.md` holds "pitch inside its limits and distance inside its",
// giving `CAMERA_PITCH_MIN` (`10`) to `CAMERA_PITCH_MAX` (`80`) and
// `CAMERA_DIST_MIN` (`10`) to `CAMERA_DIST_MAX` (`80`), and lets the yaw run
// free: one pose stands close and low at yaw `0`, the other far and nearly
// overhead half a turn round. `setCamera` "sets the orbit camera's pose as the
// orbit controls set it", so both are poses a player can reach.
//
// BOTH DIRECTIONS OF THE ONE RULE ARE READ, because acceptance has two outcomes
// and a build that leaned on the view could fail either way: a placement the
// rules accept must land identically under both poses, member for member, and a
// placement the rules refuse must be refused under both. The refused one is a
// strut longer than `STRUT_MAX_LEN` (`6`), which `specs/structure.md` refuses on
// its length alone — nothing about it is a matter of where the camera stands.
//
// The structure is emptied between the two placements rather than undone, so the
// second placement starts from exactly the state the first did: `clearStructure`
// "empties the structure as opening a site with nothing built leaves it, so the
// next member placed after it takes id `0`".

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import {
  CAMERA_DIST_MAX,
  CAMERA_DIST_MIN,
  CAMERA_PITCH_MAX,
  CAMERA_PITCH_MIN,
  STRUT_MAX_LEN,
} from "../constants";
import {
  clearAll,
  createHarness,
  openSite,
  type GantrySnapshot,
  type Harness,
} from "../harness";

/** Close, low, and looking down the `+x` axis. */
const NEAR = { yaw: 0, pitch: CAMERA_PITCH_MIN, dist: CAMERA_DIST_MIN };

/** Far, nearly overhead, and half a turn round from it. */
const FAR = { yaw: 200, pitch: CAMERA_PITCH_MAX, dist: CAMERA_DIST_MAX };

/** A strut the rules accept: two lattice nodes `2` apart, inside site 1. */
const ACCEPTED = { a: [0, 0, 0], b: [0, 2, 0] } as const;

/** A strut the rules refuse: `8` long, past `STRUT_MAX_LEN` (`6`). */
const REFUSED = { a: [0, 0, 0], b: [8, 0, 0] } as const;

/** The whole of what an edit changes, as one comparable string. */
function structureOf(s: GantrySnapshot): string {
  return JSON.stringify(s.structure);
}

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("accepts and refuses the same edits whatever the camera pose", async () => {
  await openSite(h, 0);
  await clearAll(h);

  await h.debug.setCamera(NEAR.yaw, NEAR.pitch, NEAR.dist);
  await h.debug.addMember(...ACCEPTED.a, ...ACCEPTED.b, "strut");
  const nearSnapshot = await h.snapshot();
  const placedNear = structureOf(nearSnapshot);
  await h.debug.addMember(...REFUSED.a, ...REFUSED.b, "strut");
  const refusedNear = structureOf(await h.snapshot());

  await h.debug.clearStructure();

  await h.debug.setCamera(FAR.yaw, FAR.pitch, FAR.dist);
  await h.debug.addMember(...ACCEPTED.a, ...ACCEPTED.b, "strut");
  const placedFar = structureOf(await h.snapshot());
  await h.debug.addMember(...REFUSED.a, ...REFUSED.b, "strut");
  const refusedFar = structureOf(await h.snapshot());

  await h.advance(1);
  await h.capture("state", "The driven state this point decides");

  assertEqual(
    nearSnapshot.structure.members.length,
    1,
    "the member the accepted placement lands, which is the scenario this " +
      "point rests on (specs/structure.md)",
  );
  assertEqual(
    placedFar,
    placedNear,
    `the structure the same accepted placement leaves at camera ` +
      `(${FAR.yaw}, ${FAR.pitch}, ${FAR.dist}), which must be the one it ` +
      `leaves at (${NEAR.yaw}, ${NEAR.pitch}, ${NEAR.dist}) ` +
      "(specs/instrumentation.md)",
  );
  assertEqual(
    refusedNear,
    placedNear,
    `the structure a strut of ${STRUT_MAX_LEN + 2} units leaves at camera ` +
      `(${NEAR.yaw}, ${NEAR.pitch}, ${NEAR.dist}): refused, so unchanged ` +
      "(specs/structure.md)",
  );
  assertEqual(
    refusedFar,
    placedFar,
    `the structure the same over-long strut leaves at camera ` +
      `(${FAR.yaw}, ${FAR.pitch}, ${FAR.dist}): refused there too ` +
      "(specs/instrumentation.md)",
  );
});
