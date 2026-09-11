// assets/miner-mirrors — one drawing, mirrored, for the two facings.
//
// `specs/assets.md`: "Draw the miner facing one canonical direction and mirror it
// in the game to face the other, so the silhouette, the suit, the drill, and the
// jetpack are identical in both facings and across every cycle."
//
// So the miner is drawn at one position in one state facing each way and its box
// is read both times. The west reading is then REFLECTED and compared against the
// east one: a build that mirrors one drawing matches; a build with two separately
// drawn facings does not, because two drawings of a suited figure agree nowhere
// near as closely as one and its own reflection.
//
// THE AXIS IS FOUND, NOT ASSUMED. `specs/character.md` gives the miner a box
// `MINER_W` (`56`) wide and `specs/assets.md` authors the drawing to fit within
// `MINER_SPRITE` (`80`); nothing anywhere says the wider drawing is CENTRED on the
// narrower box, so where a build's mirror axis falls inside the box is the
// build's. Reflecting about the box's own centre would therefore fail a build that
// anchors its sprite anywhere else, however exactly it mirrors. So the reflection
// is taken about every axis the sampling can name and the best one is the reading
// — which is the whole of the claim the specification makes: that there IS an axis
// the two facings reflect onto each other about.
//
// AND EVERY AXIS CONSIDERED HAS TO BE A READING OF THE MINER. An axis near the
// edge of the box leaves the two readings overlapping only over a window at the
// far side of it, and a build that draws its miner narrow, or off to one side, can
// have NO miner in that window at all — where the reflection lays band rock over
// band rock and agrees perfectly, which would let two separately drawn facings
// through on the rock's own grain. So an alignment is only a reading when the
// window it compares keeps the DRAWING: the columns where the two facings drew
// anything different are where the miner is, since outside them both readings are
// the same background, and an alignment that lets go of more than half of them is
// not a reading of the silhouette this point is about. The control is held to the
// same rule, so the two are still the best of alignments of one kind.
//
// THE COMPARISON IS AGAINST A CONTROL, not against a threshold plucked out of the
// air. The same two readings are also aligned WITHOUT the reflection, over the
// same shifts, which is how far apart two pictures of the same miner facing
// opposite ways are; the reflected comparison has to be far closer than that.
// Nothing here needs to know a palette or a sprite's exact placement inside the
// box.
//
// AND THE CONTROL HAS TO EXIST. A build whose two facings are the SAME picture —
// a miner drawn with no facing at all, which reflects onto itself — leaves that
// control at zero and nothing for the comparison to be far closer than. That is
// not a reading this check can take, and it is not a build the specification
// admits either: the sentence above asks for the miner drawn "facing one
// canonical direction", and the `drill-side` frame must carry "the drill biting
// the wall ahead", neither of which a drawing symmetric about its own axis can
// do. So the control is asserted before it is used, and a build that draws one
// faceless miner is told that rather than being handed an unsatisfiable bound.
//
// ONE SAMPLE PER UNIT, so an axis anywhere on the half-unit grid maps each sample
// onto another sample and the reflection is exact rather than interpolated.
//
// BOTH READINGS ARE ON ONE DRAWN FRAME OF THE CYCLE. The facing is turned by a
// pose, and a pose reaches the game on the frame after it, so a frame of the
// cycle's own clock passes between the two readings. `ANIM_FPS` (`12`) holds each
// drawn frame for ten of this suite's frames, so the east reading is taken on the
// frame the cycle has just turned over on — found by watching the picture drawn
// over the miner change — and the west reading, one frame later, is on the same
// drawn frame with nine frames still to run.

import { afterEach, beforeEach, it } from "vitest";
import { MINER_W } from "../constants";
import { assertEqual, assertGreaterThan, assertLessThan } from "../assert";
import { TICK_HZ, captureStill, createHarness, type Harness } from "../harness";
import { BOX_CHANGED_MIN, frameImages, imageAt, sampleBox } from "./drawn";
import { minerBox, minerCentre, showMiner } from "./miner";

/** How the box is sampled: one logical unit, so a reflection lands on samples. */
const STEP = 1;

/** How much closer the reflected comparison must be than the one as it stands. */
const MARGIN = 0.5;

/**
 * The least of the box an alignment may be read over, as a share of it.
 *
 * A shift far enough to leave the two readings barely overlapping compares a
 * sliver, and a sliver of any two pictures can agree by chance. The axes that
 * matter — a drawing `MINER_SPRITE` wide anchored anywhere over a `MINER_W` box —
 * all keep far more of it than half.
 */
const OVERLAP_MIN = 0.5;

/**
 * The least of the MINER an alignment may be read over, as a share of the columns
 * the facing change drew something different in.
 *
 * Half the BOX is not on its own a reading of the miner: a figure drawn narrow, or
 * against one side of the box, leaves windows that keep half the box and none of
 * the figure. Half the drawing is what makes an alignment a reading of it.
 */
const SEEN_MIN = 0.5;

/** The samples of one row of a box reading, as `r`, `g`, `b` triples. */
const CHANNELS = 3;

let h: Harness;

/**
 * Drive frames until the picture over `at` changes, so what follows opens on a
 * fresh drawn frame of the cycle.
 *
 * Bounded by a second of game time, which is longer than any cycle at `ANIM_FPS`:
 * a build drawing no produced sprite at all never changes picture, and it is held
 * to that by its own points rather than being waited on here.
 */
async function afterFrameChange(
  h: Harness,
  at: { x: number; y: number },
): Promise<void> {
  const opened = imageAt(await frameImages(h), at)?.key ?? null;
  for (let frame = 0; frame < TICK_HZ; frame += 1) {
    if ((imageAt(await frameImages(h), at)?.key ?? null) !== opened) return;
  }
}

/** The two readings of the miner's box, and where in them the miner is. */
interface Facings {
  east: readonly number[];
  west: readonly number[];
  columns: number;
  rows: number;
  /** Whether the facing change drew something different in each column. */
  moved: readonly boolean[];
  /** How many columns it did. */
  movedCount: number;
}

/**
 * The two readings, with the columns the facing change moved worked out.
 *
 * `rows` is taken from the reading rather than from `MINER_H`, so a box the stage
 * clipped is read as the shape it came back as. A column counts as moved when a
 * sample in it moved by `BOX_CHANGED_MIN`, which is what this suite everywhere
 * else calls a sample having changed.
 */
function facings(
  east: readonly number[],
  west: readonly number[],
  columns: number,
): Facings {
  const rows = Math.floor(east.length / CHANNELS / columns);
  const moved: boolean[] = Array.from({ length: columns }, () => false);
  for (let row = 0; row < rows; row += 1) {
    for (let column = 0; column < columns; column += 1) {
      const at = (row * columns + column) * CHANNELS;
      let distance = 0;
      for (let channel = 0; channel < CHANNELS; channel += 1) {
        distance += Math.abs(east[at + channel] - west[at + channel]);
      }
      if (distance > BOX_CHANGED_MIN) moved[column] = true;
    }
  }
  return {
    east,
    west,
    columns,
    rows,
    moved,
    movedCount: moved.filter(Boolean).length,
  };
}

/** Whether a column is one this alignment has the other reading's column for. */
function inWindow(
  read: Facings,
  reflected: boolean,
  shift: number,
  column: number,
): boolean {
  const from = reflected ? read.columns - 1 - column + shift : column + shift;
  return from >= 0 && from < read.columns;
}

/**
 * How far east sits from west when west is slid `shift` columns and, when
 * `reflected`, turned left to right first — or `null` where the alignment keeps
 * too little of the box, or too little of the miner, to be a reading.
 *
 * The mean absolute difference per channel over the window, so two alignments
 * that keep different amounts of the box are still comparable.
 */
function alignedApart(
  read: Facings,
  reflected: boolean,
  shift: number,
): number | null {
  let width = 0;
  let seen = 0;
  for (let column = 0; column < read.columns; column += 1) {
    if (!inWindow(read, reflected, shift, column)) continue;
    width += 1;
    if (read.moved[column]) seen += 1;
  }
  if (width < read.columns * OVERLAP_MIN) return null;
  if (seen < read.movedCount * SEEN_MIN) return null;

  let total = 0;
  let count = 0;
  for (let row = 0; row < read.rows; row += 1) {
    for (let column = 0; column < read.columns; column += 1) {
      const from = reflected
        ? read.columns - 1 - column + shift
        : column + shift;
      if (from < 0 || from >= read.columns) continue;
      const here = (row * read.columns + column) * CHANNELS;
      const there = (row * read.columns + from) * CHANNELS;
      for (let channel = 0; channel < CHANNELS; channel += 1) {
        total += Math.abs(
          read.east[here + channel] - read.west[there + channel],
        );
      }
      count += CHANNELS;
    }
  }
  return count === 0 ? null : total / count;
}

/** The closest the two readings come over every alignment of its kind. */
function closest(read: Facings, reflected: boolean): number {
  let best = Number.POSITIVE_INFINITY;
  for (let shift = -(read.columns - 1); shift <= read.columns - 1; shift += 1) {
    const apart = alignedApart(read, reflected, shift);
    if (apart !== null && apart < best) best = apart;
  }
  return best;
}

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("draws the west-facing miner as the east-facing one reflected", async () => {
  await showMiner(h, "idle");
  await afterFrameChange(h, minerCentre(h));
  const box = minerBox(h);
  const columns = Math.ceil(MINER_W / STEP);

  const east = sampleBox(h, box, STEP);
  h.debug.setFacing("west");
  await h.advance(1);
  const west = sampleBox(h, box, STEP);
  captureStill(h, "mirror");

  const read = facings(east, west, columns);
  const mirrored = closest(read, true);
  const straight = closest(read, false);

  assertEqual(h.snapshot().miner.facing, "west", "specs/character.md");
  assertGreaterThan(
    straight,
    0,
    "the two facings drawn as pictures that differ, the miner being drawn facing one canonical direction (specs/assets.md)",
  );
  assertLessThan(mirrored, straight * MARGIN, "specs/assets.md");
});
