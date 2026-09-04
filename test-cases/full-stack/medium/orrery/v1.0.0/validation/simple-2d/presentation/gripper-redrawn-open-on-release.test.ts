// presentation/gripper-redrawn-open-on-release — letting go puts `gripper-open.png`
// back, on the next frame the game draws.
//
// THE RULE, from the Grippers row of `specs/assets.md`'s sprite table: the two
// produced files are drawn "the closed sprite while the gripper holds a mote and
// THE OPEN ONE WHENEVER IT HOLDS NONE, so that whether a gripper is holding reads
// off the field as `specs/parts.md` asks". "Whenever" is the word this point turns
// on: a gripper that has let go holds none, so from then on it paints the open
// file. `specs/simulation.md` fixes how long a hold lasts: "Grips persist across
// cycles until dropped."
//
// WHICH FILE IS DRAWN IS DECIDED BY PIXELS, NEVER BY A PATH: `Harness.imagePixels`
// hands back the source a frame drew, at its own natural size, and `sameAsDrawn`
// compares it against the file this build committed. A bundler may inline a
// produced PNG as a `data:` URI and that is still the committed file, so a URL
// would say nothing.
//
// THE HOLD AND THE RELEASE ARE BOTH POSED, so no cycle ever runs. `setGrip` "takes
// hold with no `grab` ever running" and `releaseGrip` is the gate's other side,
// "and leaving `grab` off the tape" (`specs/instrumentation.md`). The arm's tape is
// blank, "which every part rests on", and the field holds one mote, so the only
// thing that changes between the two frames read is what the gripper holds.
//
// THE VERDICT. While the hold stands, the gripper's hex carries
// `gripper-closed.png`. One frame after the release — with `sim.grips` reporting
// nothing held — the same hex carries `gripper-open.png`.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertLength, fail } from "../assert";
import { GRIPPER_PATHS, GRIPPER_SPRITE_SIZE } from "../constants";
import { distance, hexCenter, type Hex } from "../field";
import { armPart, solution } from "../formats";
import { BARE, ORIGIN } from "../fixtures";
import {
  captureReplay,
  createHarness,
  heldBy,
  holdGrip,
  imageDraws,
  openBareRun,
  partIds,
  spawnMote,
  takeGrip,
  type DrawCall,
  type Harness,
} from "../harness";
import { GRIPPER_SPRITES, assetFile } from "../assets/files";
import { decodeProduced, sameAsDrawn, type Sprite } from "../assets/sprites";
import { gripperHex } from "../parts";

/** The arm stands at rotation `0`, so its one gripper is on spoke `0`. */
const SPOKE = 0;

/** How near a sprite's centre must land to count as drawn on a hex. */
const ON_POINT = 6;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

/** Which produced gripper file the frame drew on a hex, or `null` for none. */
async function gripperFileOn(
  calls: readonly DrawCall[],
  hex: Hex,
  sprites: readonly Sprite[],
): Promise<string | null> {
  const centre = hexCenter(hex);
  for (const draw of imageDraws(calls)) {
    if (draw.image.width !== GRIPPER_SPRITE_SIZE) continue;
    if (distance({ x: draw.cx, y: draw.cy }, centre) > ON_POINT) continue;
    const pixels = await h.imagePixels(draw.image.id);
    if (pixels === null) continue;
    const found = sprites.findIndex((sprite) => sameAsDrawn(sprite, pixels));
    if (found >= 0) return GRIPPER_SPRITES[found]?.file ?? null;
  }
  return null;
}

it("draws the open gripper file again on the frame after the gripper lets go", async () => {
  await openBareRun(h, {
    challenge: BARE,
    machine: solution([armPart("arm", ORIGIN.q, ORIGIN.r, 0, 1, [])]),
  });
  const arm = (await partIds(h))[0] ?? -1;

  const readings = await decodeProduced(GRIPPER_SPRITES);
  const sprites = readings.map((read, index) => {
    if (read.sprite === null) {
      fail(
        `a decoded ${GRIPPER_SPRITES[index]?.label ?? "gripper"}`,
        read.reason,
      );
    }
    return read.sprite;
  });

  const heldHex = gripperHex(ORIGIN, SPOKE, 1);
  const mote = await spawnMote(h, heldHex, "dust");
  await takeGrip(h, arm, SPOKE, mote);

  await h.advance(1);
  assertEqual(
    heldBy(await h.snapshot(), arm, SPOKE),
    mote,
    "the gripper holds the mote before the release",
  );
  assertEqual(
    await gripperFileOn(await h.lastCalls(), heldHex, sprites),
    assetFile(GRIPPER_PATHS.closed),
    "so while it holds it paints gripper-closed.png",
  );

  const released = await captureReplay(h, "release", async () => {
    await holdGrip(h, arm, SPOKE);
    await h.advance(1);
    return h.lastCalls();
  });

  const after = await h.snapshot();
  assertEqual(
    heldBy(after, arm, SPOKE),
    null,
    "the gripper has let go, so from here it holds none",
  );
  assertLength(
    after.sim?.grips ?? [],
    0,
    "and nothing on the field is holding anything",
  );
  assertEqual(
    await gripperFileOn(released, heldHex, sprites),
    assetFile(GRIPPER_PATHS.open),
    "so on the next frame the gripper paints gripper-open.png again, and a " +
      "machine never reads as holding a mote it has let go",
  );
});
