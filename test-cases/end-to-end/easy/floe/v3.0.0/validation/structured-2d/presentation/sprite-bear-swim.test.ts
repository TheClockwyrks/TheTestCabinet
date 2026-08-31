// Floe — presentation/sprite-bear-swim: a bear whose entering tile is open water
// is drawn from the SWIM pair for the direction it is travelling in.
//
// specs/assets.md tabulates frames `8`–`15` of `assets/bear/` as the four-facing
// submerged swim — `8`,`9` down, `10`,`11` up, `12`,`13` left, `14`,`15` right —
// and draws a bear that is "Swimming" from "The swim pair for its facing".
// specs/hunter.md fixes when that is: a bear's footing is the footing of the tile
// it is travelling into, and it is swimming when that tile is on the water band
// and no floe covers it.
//
// This is the state that matters most to a player, and specs/assets.md says why:
// "The swim frames already carry the submerged silhouette and its wake, so a bear
// over the water stays trackable, including where it passes under a floe." A
// build that draws the run pair over open water draws a bear standing on nothing
// where the critter is most exposed.
//
// ALL FOUR HEADINGS, EACH READ ON ITS OWN, and the reading is EXCLUSIVE: every
// bear frame drawn on the bear must belong to that heading's swim pair. A build
// that reached for the run set instead draws frames `0`–`7` and fails on all
// four; a build that wired one heading fails on three. The eighteen seeded frames
// are pixel-for-pixel distinct, so a match names exactly one of them.
//
// THE WORLD IS AN EMPTY STRAIT, so every one of the four tiles the bear steps
// into is open water — `startCrossing` clears the floes, which is exactly the "no
// floe covers it" half of the swimming rule, rather than a bystander parked
// nearby. Row `6` sits inside the water band with water above, below and to
// either side. The bear's routing is off, so it travels exactly the step
// `setBearStep` commits it to; its travel is left ON, because being between tiles
// is the situation the drawing rule names.

import { afterEach, beforeEach, it } from "vitest";
import { BEAR_SWIM_SPEED, TICK_HZ, TILE } from "../../src/constants";
import { assertEqual, assertGreaterThanOrEqual, assertLength } from "../assert";
import {
  bearById,
  captureReplay,
  createHarness,
  poseBear,
  startCrossing,
  ticksFor,
  type Facing,
  type Harness,
} from "../harness";
import {
  BEAR_SWIM_FRAMES,
  drawnFrom,
  frameIndexes,
  spritesOfFrame,
} from "./sprites";

/** A tile inside the water band, with open water on all four sides. */
const COL = 20;
const ROW = 6;

/** The four headings specs/assets.md tabulates, read in turn. */
const HEADINGS: readonly Facing[] = ["down", "up", "left", "right"];

/**
 * How far into a step the bear is read, in ticks.
 *
 * At `BEAR_SWIM_SPEED` (`2`) tiles per second and `TICK_HZ` (`120`) ticks per
 * second, eight ticks carry it an eighth of a tile: unambiguously between tiles,
 * and nowhere near the far centre it would settle on after sixty.
 */
const TRAVEL_TICKS = 8;

/** A sanity ceiling on the above: it must not reach the next tile centre. */
const TILE_TICKS = Math.round(TICK_HZ / BEAR_SWIM_SPEED);

/** The seconds of swimming kept as the item's evidence. */
const REPLAY_SECONDS = 0.4;

/**
 * How far a draw's centre may sit from the bear's own reported centre.
 *
 * specs/assets.md draws a 32 x 32 frame "centered on its subject's own center".
 * Half a tile is the widest tolerance that still names one tile; a build that
 * interpolates its render between the last two ticks is inside a single tick's
 * travel of the reported centre, which at this speed is under one unit.
 */
const CENTRED_WITHIN = TILE / 2;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("draws a submerged bear from the swim pair for each heading", async () => {
  assertGreaterThanOrEqual(
    TILE_TICKS,
    TRAVEL_TICKS * 2,
    "the reading tick sits well inside one tile's travel",
  );

  startCrossing(h);
  const id = poseBear(h, COL, ROW, { routing: false });

  // The evidence first, so a failing reading below still leaves the swim it was
  // taken from. Nothing is asserted off it.
  h.debug.setBearStep(id, "up");
  await captureReplay(h, "swim", () => h.advance(ticksFor(REPLAY_SECONDS)));

  const drawn = new Map<Facing, { indexes: number[]; swimming: boolean }>();
  for (const heading of HEADINGS) {
    h.debug.setBearTile(id, COL, ROW);
    h.debug.setBearStep(id, heading);
    await h.advance(TRAVEL_TICKS);
    const sprites = await spritesOfFrame(h);
    const bear = bearById(h.snapshot(), id);
    drawn.set(heading, {
      indexes:
        bear === undefined
          ? []
          : frameIndexes(
              drawnFrom(sprites, "bear", bear, CENTRED_WITHIN),
              "bear",
            ),
      swimming: bear?.swimming ?? false,
    });
  }

  for (const heading of HEADINGS) {
    const pair = BEAR_SWIM_FRAMES[heading];
    const read = drawn.get(heading);
    assertEqual(
      read?.swimming,
      true,
      `heading ${heading}: the bear travelling into an uncovered water tile ` +
        `reports swimming (specs/hunter.md) — the situation the swim pair is ` +
        `drawn for`,
    );
    assertGreaterThanOrEqual(
      read?.indexes.length ?? 0,
      1,
      `heading ${heading}: the bear drawn from a frame of assets/bear/`,
    );
    assertLength(
      (read?.indexes ?? []).filter((index) => !pair.includes(index)),
      0,
      `heading ${heading}: every frame drawn on the submerged bear from that ` +
        `heading's swim pair, ${pair.join(" or ")} (specs/assets.md) — drew ` +
        `${(read?.indexes ?? []).join(", ")}`,
    );
  }
});
