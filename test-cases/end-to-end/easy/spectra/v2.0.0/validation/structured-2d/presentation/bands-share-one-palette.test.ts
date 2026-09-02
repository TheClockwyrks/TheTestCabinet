// Spectra — presentation/bands-share-one-palette: code-drawn bands match the
// art's bands.
//
// `specs/overview.md`'s legibility table, the "One palette for both" row: "The
// band colors are the two the seeded art carries. Everything the build draws in
// code that carries a band uses those same two colors, so a drone and a bullet of
// one band read as the same band." It is the one relationship Spectra needs
// pinned, and the reason is precise: a build that paints its bullets a third pair
// of colours passes `presentation/bullet-reads-band` — its two bullets are told
// apart — and is incoherent all the same, because `specs/bands.md` decides a hit
// by whether the shot's band matches the drone's, and a player reads that match
// off the two colours.
//
// NO COLOUR IS ASSERTED, AND NONE COULD BE. `specs/overview.md` fixes no palette,
// so there is no value to hold either half against. What is asserted is the
// RELATIONSHIP the table states: the colour a code-drawn cyan bullet renders in
// is nearer the colour of a cyan drone — drawn from the seeded art — than it is
// to a magenta drone's, and the magenta bullet's is nearer the magenta drone's. A
// build using one palette passes whatever that palette is; a build whose bullets
// carry a third pair fails as soon as either bullet lands nearer the wrong band's
// art.
//
// SO THE READING HERE IS A COLOUR, NOT A PICTURE. A bullet and a drone are drawn
// at different sizes in different places, so they cannot be held against each
// other place for place the way `presentation/cyan-magenta-distinct` holds two
// Shards. Each of the four is read as the mean of the places it painted inside
// its own drawn box, against a reading of that same box with it gone — see
// `presentation/reading` — which is the colour the thing renders in whatever
// shape it renders in.
//
// ALL FOUR STAND IN ONE FRAME, spread far enough apart that no glow a build lays
// around one can reach another's box, and the drones are props with every faculty
// off. The bullets are added through the surface and left to the build's own
// update for one frame, and each is read at the place the snapshot reports it, so
// nothing here freezes one or assumes how far it travelled.

import { afterEach, beforeEach, it } from "vitest";
import { assertGreaterThan, assertLessThan, fail } from "../assert";
import {
  PLAYER_BULLET_H,
  PLAYER_BULLET_W,
  SHARD_SIZE,
} from "../constants";
import {
  captureStill,
  colorDistance,
  createHarness,
  poseDrone,
  posePlayerBullet,
  startPosed,
  type Band,
  type Harness,
  type Rgb,
} from "../harness";
import {
  boxOf,
  bulletOf,
  droneOf,
  footprintOf,
  paintedColor,
  readRegion,
  rgb,
  type Box,
  type Region,
} from "./reading";

/** The other band, which is what a bullet must NOT land nearer to. */
function opposite(band: Band): Band {
  return band === "cyan" ? "magenta" : "cyan";
}

/** The row the two Shards stand on: inside the play field, clear of the lane. */
const DRONE_ROW_Y = 430;

/** The row the two shots are put on, clear of the drones' own boxes. */
const BULLET_ROW_Y = 300;

/** Where each of the four stands, `280` units or more from its neighbours. */
const CYAN_DRONE_X = 220;
const MAGENTA_DRONE_X = 1060;
const CYAN_BULLET_X = 520;
const MAGENTA_BULLET_X = 800;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("draws each bullet nearer its own band's art than the other's", async () => {
  startPosed(h);
  const droneIds = (
    [
      ["cyan", CYAN_DRONE_X],
      ["magenta", MAGENTA_DRONE_X],
    ] as const
  ).map(([band, x]) => ({
    band,
    id: poseDrone(h, "shard", x, DRONE_ROW_Y, { band }),
  }));
  const bulletIds = (
    [
      ["cyan", CYAN_BULLET_X],
      ["magenta", MAGENTA_BULLET_X],
    ] as const
  ).map(([band, x]) => ({
    band,
    id: posePlayerBullet(h, x, BULLET_ROW_Y, band),
  }));
  await h.advance(1);

  // Both bands' drones and bullets in one frame.
  captureStill(h, "palette");

  const posed = h.snapshot();
  const boxes: {
    name: string;
    kind: "drone" | "bullet";
    band: Band;
    box: Box;
  }[] = [];
  for (const { band, id } of droneIds) {
    const drone = droneOf(posed, id);
    boxes.push({
      name: `the ${band} Shard`,
      kind: "drone",
      band,
      box: footprintOf(drone.x, drone.y, SHARD_SIZE),
    });
  }
  for (const { band, id } of bulletIds) {
    const bullet = bulletOf(posed, id);
    boxes.push({
      name: `the ${band} bullet`,
      kind: "bullet",
      band,
      box: boxOf(bullet.x, bullet.y, PLAYER_BULLET_W, PLAYER_BULLET_H),
    });
  }

  const drawn: Region[] = boxes.map(({ box }) => readRegion(h, box));

  // The same four boxes of the same field with nothing on them: the control each
  // colour is read against.
  h.debug.clearDrones();
  h.debug.clearPlayerBullets();
  await h.advance(1);
  const bare: Region[] = boxes.map(({ box }) => readRegion(h, box));

  const sampled = boxes.map((where, index) => {
    const painted = paintedColor(bare[index], drawn[index]);
    assertGreaterThan(
      painted.count,
      0,
      `precondition: ${where.name} painted the box it stands in at all`,
    );
    return { ...where, color: painted.color };
  });

  const colorOf = (kind: "drone" | "bullet", band: Band): Rgb => {
    const found = sampled.find(
      (entry) => entry.kind === kind && entry.band === band,
    );
    if (found === undefined) {
      fail(`a ${band} ${kind} among the four posed`, "it was not read");
    }
    return found.color;
  };

  for (const band of ["cyan", "magenta"] as const) {
    const bullet = colorOf("bullet", band);
    const own = colorOf("drone", band);
    const other = colorOf("drone", opposite(band));
    assertLessThan(
      colorDistance(bullet, own),
      colorDistance(bullet, other),
      `the code-drawn ${band} bullet to render nearer the ${band} drone drawn ` +
        `from the seeded art than the ${opposite(band)} one ` +
        `(specs/overview.md: everything the build draws in code that carries ` +
        `a band uses the same two colours the seeded art carries); the bullet ` +
        `sampled ${rgb(bullet)}, the ${band} drone ${rgb(own)} and the ` +
        `${opposite(band)} drone ${rgb(other)}`,
    );
  }
});
