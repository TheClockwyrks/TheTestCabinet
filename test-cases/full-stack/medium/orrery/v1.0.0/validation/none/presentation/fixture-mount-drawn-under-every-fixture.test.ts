// presentation/fixture-mount-drawn-under-every-fixture — all six of a wheel's
// fixtures carry the produced mount, not just one of them.
//
// THE RULE, from the Fixture mount row of `specs/assets.md`'s sprite table:
// "`assets/sprites/parts/fixture-mount.png` | `48 x 48` | centered on EACH
// FIXTURE'S HEX, beneath its mote sprite." What the fixtures are, and where they
// are, is `specs/parts.md`: "A `wheel` is a hub on its anchor hex carrying six
// fixture motes, ONE ON EACH ADJACENT HEX."
//
// WHICH FILE IS DRAWN IS DECIDED BY PIXELS, NEVER BY A PATH. `Harness.imagePixels`
// hands back the source a frame drew at its own natural size, and `sameAsDrawn`
// compares that against the two files this build committed on the `48 x 48` wheel
// canvas — the hub and the mount. That is what tells the mount from the hub, which
// share a canvas and so cannot be told apart by size.
//
// AND WHERE THE TWO FILES ARE ONE PICTURE, THAT READING IS UNDECIDABLE. A build
// that shipped the same picture under both names leaves no pixel by which any
// reader, this one or a player, could say which file a draw came from: the two
// decode alike, so the first of them answers for every draw. Where that is so, the
// two assertions that name a FILE are skipped and said to be skipped, and the
// count, the placement and the native size are read as they always are. Shipping
// one picture twice is its own defect, and `assets/wheel-pieces-distinct` is the
// point that owns it; charging it here as well would report the hub as painted on
// the fixture hexes when it is the mount that was drawn there.
//
// HOW THE RING IS RAISED. The bare opener empties the field, and then the wheel is
// placed INTO THE LIVE RUN, which is what puts its ring back: "While a run is live,
// a part one of them adds enters the run at its rest pose holding nothing, WITH A
// WHEEL'S SIX FIXTURES ON ITS SPOKE HEXES" (`specs/instrumentation.md`). Nothing
// else is on the field, so the six fixtures and the hub are the whole of the world.
//
// THE VERDICT. Each of the six spoke hexes the run reports a fixture on carries
// exactly one draw of `fixture-mount.png`, at its native `48 x 48`; the anchor hex
// carries the hub instead; and no hex beyond the ring carries a mount.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertLength, fail } from "../assert";
import {
  FIXTURE_MOUNT_PATH,
  WHEEL_HUB_PATH,
  WHEEL_SPRITE_SIZE,
} from "../constants";
import { at, distance, hexCenter, type Hex } from "../field";
import { BARE, ORIGIN } from "../fixtures";
import {
  captureStill,
  createHarness,
  fixturesOf,
  imageDraws,
  moteAt,
  openBareRun,
  placePart,
  type Harness,
} from "../harness";
import { WHEEL_SPRITES, assetFile } from "../assets/files";
import {
  decodeProduced,
  differingShare,
  sameAsDrawn,
  type Sprite,
} from "../assets/sprites";
import { wheelFixtureHexes } from "../parts";

/** How near a sprite's centre must land to count as drawn on a hex. */
const ON_POINT = 6;

/** A hex two steps out from the anchor, which no fixture of this wheel reaches. */
const BEYOND_THE_RING: Hex = at(ORIGIN.q + 2, ORIGIN.r);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("draws fixture-mount.png on each of the wheel's six fixture hexes", async () => {
  await openBareRun(h, { challenge: BARE });
  const wheel = await placePart(h, "wheel", ORIGIN, 0);

  await h.advance(1);
  await captureStill(h, "ring");

  const posed = await h.snapshot();
  assertLength(
    fixturesOf(posed, wheel),
    6,
    "a wheel placed into a live run carries six fixture motes, one per spoke hex",
  );

  const readings = await decodeProduced(WHEEL_SPRITES);
  const sprites = readings.map((read, index) => {
    if (read.sprite === null) {
      fail(
        `a decoded ${WHEEL_SPRITES[index]?.label ?? "wheel sprite"}`,
        read.reason,
      );
    }
    return read.sprite;
  });

  const drawn: { file: string; x: number; y: number; size: number }[] = [];
  for (const draw of imageDraws(await h.lastCalls())) {
    if (draw.image.width !== WHEEL_SPRITE_SIZE) continue;
    const pixels = await h.imagePixels(draw.image.id);
    if (pixels === null) continue;
    const found = sprites.findIndex((sprite) => sameAsDrawn(sprite, pixels));
    if (found < 0) continue;
    drawn.push({
      file: WHEEL_SPRITES[found]?.file ?? "",
      x: draw.cx,
      y: draw.cy,
      size: Math.round(Math.abs(draw.dw)),
    });
  }

  // Whether the two produced wheel files are one picture, in which case no reading
  // of a drawn source can say which of them a draw came from.
  const oneFile =
    differingShare(sprites[0] as Sprite, sprites[1] as Sprite) === 0;

  const on = (hex: Hex): typeof drawn =>
    drawn.filter(
      (entry) =>
        distance({ x: entry.x, y: entry.y }, hexCenter(hex)) <= ON_POINT,
    );

  for (const hex of wheelFixtureHexes(ORIGIN)) {
    const where = `(${String(hex.q)}, ${String(hex.r)})`;
    assertEqual(
      moteAt(posed, hex)?.wheel,
      wheel,
      `${where} carries one of this wheel's fixtures`,
    );
    const mounts = on(hex);
    assertLength(
      mounts,
      1,
      `one produced 48 x 48 wheel sprite is centered on ${where}`,
    );
    if (!oneFile) {
      assertEqual(
        mounts[0]?.file,
        assetFile(FIXTURE_MOUNT_PATH),
        `and the file drawn on ${where} is fixture-mount.png, because a mount goes on each fixture's hex`,
      );
    }
    assertEqual(
      mounts[0]?.size,
      WHEEL_SPRITE_SIZE,
      "drawn at its native canvas, so nothing is scaled at draw time",
    );
  }

  const anchor = on(ORIGIN);
  assertLength(anchor, 1, "the anchor hex carries one produced wheel sprite");
  if (!oneFile) {
    assertEqual(
      anchor[0]?.file,
      assetFile(WHEEL_HUB_PATH),
      "and it is the hub rather than a seventh mount",
    );
  }
  assertLength(
    on(BEYOND_THE_RING),
    0,
    "and no mount stands on a hex the wheel's ring does not reach",
  );
});
