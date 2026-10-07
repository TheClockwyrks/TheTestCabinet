// presentation/fixture-mount-drawn-beneath-its-mote — the mount goes down first and
// the fixture's mote is painted over it.
//
// THE RULE, from the Fixture mount row of `specs/assets.md`'s sprite table:
// "centered on each fixture's hex, BENEATH ITS MOTE SPRITE". The art bar says what
// that buys: "A fixture reads as mounted on its wheel rather than as resting
// loose."
//
// WHAT "BENEATH" IS READ AS. A frame's operations are an ordered list and a canvas
// composites in that order, so the sprite drawn EARLIER is the one underneath. Both
// sprites at a fixture's hex are identified by their own pixels rather than by a
// path — `Harness.imagePixels` against the committed files — so what is compared is
// the position of the draw of `fixture-mount.png` against the position of the draw
// of that fixture's mote sprite, on one frame.
//
// THE LOOSE MOTE IS THE OTHER HALF OF THE SENTENCE. A wheel's spoke `4` fixture is
// `dust` (`specs/parts.md`, `WHEEL_MOTES`), and one loose `dust` is spawned well
// clear of the ring — the same mote type, resting on a hex of its own rather than
// mounted. `specs/assets.md` puts the mount "on each FIXTURE's hex", and a loose
// mote is not a fixture: `specs/instrumentation.md` reports `wheel` as "the wheel a
// fixture belongs to; `null` on every real mote". So the loose one carries no
// mount, which is what makes the mounted one read as mounted.
//
// THE WORLD. The bare opener empties the field, the wheel is placed into the live
// run so its ring comes up — "a part one of them adds enters the run ... with a
// wheel's six fixtures on its spoke hexes" — and one `dust` is spawned three hexes
// away, clear of the ring.
//
// THE VERDICT. At the fixture's hex the mount is drawn before the mote sprite; at
// the loose mote's hex the mote sprite is drawn and no mount is.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertLength, assertLessThan, fail } from "../assert";
import {
  FIXTURE_MOUNT_PATH,
  MOTE_SPRITE_PATHS,
  MOTE_SPRITE_SIZE,
  WHEEL_SPRITE_SIZE,
} from "../constants";
import { distance, hexCenter, type Hex } from "../field";
import { BARE, ORIGIN, SOUTH } from "../fixtures";
import {
  captureStill,
  createHarness,
  imageDraws,
  moteAt,
  openBareRun,
  placePart,
  spawnMote,
  type Harness,
} from "../harness";
import { assetFile } from "../assets/files";
import { decodeSprite, sameAsDrawn, type Sprite } from "../assets/sprites";
import { gripperHex } from "../parts";

/** The spoke whose fixture `WHEEL_MOTES` makes `dust` at rotation `0`. */
const DUST_SPOKE = 4;

/** How near a sprite's centre must land to count as drawn on a hex. */
const ON_POINT = 6;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("draws a fixture's mount before its mote, and puts no mount under a loose mote", async () => {
  await openBareRun(h, { challenge: BARE });
  const wheel = await placePart(h, "wheel", ORIGIN, 0);
  const loose = await spawnMote(h, SOUTH, "dust");

  await h.advance(1);
  await captureStill(h, "mounted");

  const posed = await h.snapshot();
  const fixtureHex = gripperHex(ORIGIN, DUST_SPOKE, 1);
  assertEqual(
    moteAt(posed, fixtureHex)?.wheel,
    wheel,
    "the wheel's spoke 4 hex carries one of its fixtures",
  );
  assertEqual(
    moteAt(posed, fixtureHex)?.type,
    "dust",
    "WHEEL_MOTES makes the spoke 4 fixture dust",
  );
  assertEqual(
    moteAt(posed, SOUTH)?.id,
    loose,
    "one loose dust rests three hexes away, clear of the wheel's ring",
  );
  assertEqual(
    moteAt(posed, SOUTH)?.wheel,
    null,
    "and belongs to no wheel, so it is a mote at rest rather than a fixture",
  );

  const mountFile = assetFile(FIXTURE_MOUNT_PATH);
  const moteFile = assetFile(MOTE_SPRITE_PATHS.dust);
  const readMount = await decodeSprite(mountFile);
  const readMote = await decodeSprite(moteFile);
  if (readMount.sprite === null)
    fail("a decoded fixture mount", readMount.reason);
  if (readMote.sprite === null)
    fail("a decoded dust mote sprite", readMote.reason);
  const mount: Sprite = readMount.sprite;
  const mote: Sprite = readMote.sprite;

  /** Where, in frame order, a produced file was drawn on a hex. */
  const positions = async (
    hex: Hex,
    file: Sprite,
    canvas: number,
  ): Promise<number[]> => {
    const centre = hexCenter(hex);
    const found: number[] = [];
    const draws = imageDraws(await h.lastCalls());
    for (const [index, draw] of draws.entries()) {
      if (draw.image.width !== canvas) continue;
      if (distance({ x: draw.cx, y: draw.cy }, centre) > ON_POINT) continue;
      const pixels = await h.imagePixels(draw.image.id);
      if (pixels !== null && sameAsDrawn(file, pixels)) found.push(index);
    }
    return found;
  };

  const mountAt = await positions(fixtureHex, mount, WHEEL_SPRITE_SIZE);
  const moteAtFixture = await positions(fixtureHex, mote, MOTE_SPRITE_SIZE);
  assertLength(
    mountAt,
    1,
    "the fixture's hex carries one draw of fixture-mount.png",
  );
  assertLength(
    moteAtFixture,
    1,
    "and one draw of the dust mote's own produced sprite",
  );
  assertLessThan(
    mountAt[0] ?? -1,
    moteAtFixture[0] ?? -1,
    "the mount is composited UNDER the fixture's mote sprite, so it is drawn first",
  );

  assertLength(
    await positions(SOUTH, mote, MOTE_SPRITE_SIZE),
    1,
    "the loose dust is drawn from the same produced mote sprite",
  );
  assertLength(
    await positions(SOUTH, mount, WHEEL_SPRITE_SIZE),
    0,
    "and carries no mount, because a mount goes on each FIXTURE's hex",
  );
});
