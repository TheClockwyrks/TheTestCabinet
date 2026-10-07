// Cascade — what the twenty-five `cascade` checks share. CASE-PROVIDED.
//
// Two worlds and three readings, and nothing else. Everything here ARRANGES or
// SAMPLES; not one function in this file decides anything, and not one of them
// holds a tolerance. Every threshold a check applies is a module constant in the
// check that applies it, derived there from the figure `specs/victory.md` fixes.
//
// WHY THE GROUP NEEDS A WORLD OF ITS OWN. `specs/victory.md` describes the
// cascade as fifty-two cards launching one after another, and almost every point
// in this group is about ONE of the five steps a single card takes in a frame.
// Fifty-one other cards in the air would decide nothing extra and would put the
// reading at the mercy of a launch velocity the specification deliberately leaves
// random, so a single-flyer point poses an EMPTY table on the `won` screen with
// `setLaunching(false)` and puts back exactly the card or cards its requirement
// concerns — which is the use `specs/instrumentation.md` gives that gate.
//
// The screen is `won` and not `playing`, because that is the screen
// `specs/screens.md` says the cascade runs on, and because a posed flyer has to
// be DRAWN for the three trail points to have pixels to read. A flyer put in
// flight through `addFlyer` "flies, bounces, paints, and retires through the
// game's own cascade rules" (`specs/instrumentation.md`) — so what runs from
// there is the build's own cascade, unposed.
//
// AND THE PAINTING IS OFF BY DEFAULT, per the group's own rule: the painted layer
// is a full-stage surface blitted once a frame, and a replay that recorded it
// would spend its whole image budget in a handful of frames. The three points
// whose requirement IS the trail ask for it back.

import { fail } from "../assert";
import {
  CARD_H,
  CARD_W,
  DECK_SIZE,
  FOUNDATION_COUNT,
  FOUNDATION_X,
  HUD_Y,
  LAUNCH_INTERVAL,
  LAUNCH_VX_MIN,
  LAUNCH_VY,
  RANK_MAX,
  STAGE_W,
  TABLEAU_Y,
  TOP_ROW_Y,
} from "../constants";
import {
  type CardView,
  type CascadeSnapshot,
  type FlyerView,
  type Harness,
  type Point,
  type Rect,
  type Rgb,
  colorDistance,
  framesFor,
  gridPoints,
  lastFlyer,
  openTable,
  startCascade,
  topOf,
} from "../harness";

/* -------------------------------------------------------------------------- */
/* The two worlds                                                             */
/* -------------------------------------------------------------------------- */

/** How a cascade world is opened. Both fields default to the group's rule. */
export interface FlightOptions {
  /**
   * Whether the painted layer takes new stamps.
   *
   * Off by default, which is this group's standing rule. The three points whose
   * requirement is the trail itself turn it back on.
   */
  painting?: boolean;
}

/**
 * An empty table on the `won` screen with nothing launching: the world a
 * single-flyer point poses its card into.
 *
 * `openTable` resets and empties all thirteen piles; the screen is then the one
 * `specs/screens.md` gives the cascade, and `setLaunching(false)` is what keeps
 * the foundations — empty here anyway — from adding a fifty-second card to a
 * reading about one. Nothing is in flight and nothing is painted, so the first
 * card the caller poses is the whole of the world.
 */
export async function openFlight(
  h: Harness,
  options: FlightOptions = {},
): Promise<void> {
  await openTable(h);
  await h.debug.setScreen("won");
  await h.debug.setLaunching(false);
  await h.debug.setTrailPainting(options.painting ?? false);
}

/**
 * The real cascade, running, reached the way a player reaches it.
 *
 * `startCascade` puts fifty-one cards home and sends the last King to its
 * foundation through a real `move()`, so the win test runs, the screen becomes
 * `won`, and the build's own cascade takes over. Nothing about the ending is
 * posed. The painting gate is set BEFORE the win, so a cascade opened with
 * painting off has taken no stamp at all.
 */
export async function openCascade(
  h: Harness,
  options: FlightOptions = {},
): Promise<void> {
  await openTable(h);
  await h.debug.setTrailPainting(options.painting ?? false);
  await startCascade(h);
}

/* -------------------------------------------------------------------------- */
/* Reading the flight                                                         */
/* -------------------------------------------------------------------------- */

/**
 * Run `frames` frames one at a time and hand back the state each one left.
 *
 * `samples[0]` is the state after the first frame. A point that has to catch a
 * contact — the frame a bounce resolved on, the frame two flyers crossed —
 * needs the frame before it as well as the frame itself, and there is no other
 * way to have both.
 *
 * Every frame is still run and read one at a time; what {@link Harness.sample}
 * spares the reading is a round trip into the page per frame, which is a cost
 * the HOST decides and the build does not.
 */
export async function frameSamples(
  h: Harness,
  frames: number,
): Promise<CascadeSnapshot[]> {
  return h.sample(frames);
}

/**
 * How far a sweep waits for the next launch, in frames.
 *
 * `specs/victory.md` puts a launch every `LAUNCH_INTERVAL` (`0.18` s), so at the
 * suite's own cadence the next one is at most `43.2` frames away. This is nearly
 * three times that: a bound on the sweep, so a build that stops launching fails
 * by assertion rather than by running forever, and far too loose to be a reading
 * of the cadence — `cascade/launch-cadence` is the point that grades that.
 */
const LAUNCH_SWEEP_FRAMES = framesFor(LAUNCH_INTERVAL * 3);

/** One launch, read on the frame the build launched it. */
export interface LaunchReading {
  /** Which launch of the whole cascade this is, `1` for the first. */
  ordinal: number;
  /** The frame of the drive it launched on, as `Harness.frame` counts them. */
  frame: number;
  /** The card it put in flight, read on that frame. */
  flyer: FlyerView;
  /** The foundation it emptied a card from, found as the pile that shrank. */
  foundation: number;
  /** That foundation's top card immediately before the launch. */
  took: CardView;
  /** The whole state on the launch frame. */
  after: CascadeSnapshot;
}

/**
 * Advance a running cascade one frame at a time and read its first `count`
 * launches.
 *
 * WHICH FOUNDATION A CARD CAME FROM IS FOUND, NOT ASSUMED: the pile that lost a
 * card between one launch and the next is the one that launched, so a reading of
 * where a card came from does not rest on the launch order being right. That
 * keeps `launch-position`, `launch-vy` and `launch-takes-top-card` independent of
 * `launch-cycles-foundations`, which is the point that grades the order.
 *
 * The reading is per frame, so `flyer` is the card as it stood on the frame it
 * launched — before it had taken any motion, which `specs/victory.md` is explicit
 * about ("A card launched in a frame takes no motion in that frame"). The frames
 * are DRIVEN in batches and READ one at a time ({@link Harness.sample}), so the
 * reading is the frame-by-frame one it has always been while the cost of taking
 * it no longer includes a round trip into the page per frame.
 *
 * It reads the NEXT `count` launches, counted from wherever the cascade already
 * stands, and leaves the cascade on the frame the last of them launched, so a
 * check may read a stretch, look at the table, and read on.
 */
export async function readLaunches(
  h: Harness,
  count: number,
): Promise<LaunchReading[]> {
  const readings: LaunchReading[] = [];
  let before = await h.snapshot();
  const already = before.launched;

  // Frames driven since the last launch was seen, against which the sweep's own
  // bound is applied — the same per-launch allowance a launch-at-a-time sweep
  // applied, kept here because the frames now arrive in batches.
  let sinceLaunch = 0;

  while (readings.length < count) {
    const wanted = count - readings.length;
    // ONE FRAME PER CROSSING IS THE COST THE HOST DECIDES, so the frames are
    // driven in batches — but never a batch that could carry MORE launches than
    // are still wanted, because a launch driven past and not returned would be
    // one the caller's next `readLaunches` could never count. A frame launches
    // at most one card in any build the cadence rule admits, so a batch of
    // `wanted` frames cannot overshoot; the batch is bounded again by what is
    // left of this launch's own sweep allowance, so a build that stops launching
    // still fails by assertion at the same frame it always did.
    const step = Math.max(
      1,
      Math.min(wanted, LAUNCH_SWEEP_FRAMES - sinceLaunch),
    );
    const opened = h.frame();
    const series = await h.sample(step);

    for (const [index, after] of series.entries()) {
      sinceLaunch += 1;
      if (after.launched <= before.launched) continue;

      // The frame launched at least one card. Each is read against the state the
      // frame BEFORE it left, which is what makes "the pile that shrank" the
      // pile that launched.
      for (
        let launched = before.launched;
        launched < after.launched && readings.length < count;
        launched += 1
      ) {
        const ordinal = launched + 1;
        readings.push(readLaunch(before, after, ordinal, opened + index + 1));
      }
      before = after;
      sinceLaunch = 0;
    }

    if (readings.length < count && sinceLaunch >= LAUNCH_SWEEP_FRAMES) {
      const last = series[series.length - 1] ?? before;
      fail(
        `launch ${already + readings.length + 1} of the victory cascade within ${LAUNCH_SWEEP_FRAMES} frames of launch ${already + readings.length} (specs/victory.md)`,
        `the cascade had launched ${last.launched} card(s) and stopped`,
      );
    }
    before = series[series.length - 1] ?? before;
  }

  return readings;
}

/**
 * One launch, read off the frame it landed on and the frame before it.
 *
 * Split out of {@link readLaunches} so the reading is stated once: which
 * foundation shrank, what was on top of it, and what went into the air.
 */
function readLaunch(
  before: CascadeSnapshot,
  after: CascadeSnapshot,
  ordinal: number,
  frame: number,
): LaunchReading {
  const emptied: number[] = [];
  for (let index = 0; index < FOUNDATION_COUNT; index += 1) {
    if (after.foundations[index].length < before.foundations[index].length) {
      emptied.push(index);
    }
  }
  if (emptied.length !== 1) {
    fail(
      "each launch to take its card from exactly one foundation (specs/victory.md)",
      `launch ${ordinal} left ${emptied.length} foundation(s) shorter than before it`,
    );
  }
  const foundation = emptied[0];
  const took = topOf(before.foundations[foundation]);
  if (took === undefined) {
    fail(
      `foundation ${foundation} to hold the card launch ${ordinal} took (specs/victory.md)`,
      "it was already empty on the frame before the launch",
    );
  }
  const flyer = lastFlyer(after);
  if (flyer === undefined) {
    fail(
      "a launched card to be in flight (specs/victory.md)",
      `nothing was in flight on the frame launch ${ordinal} was counted`,
    );
  }

  return { ordinal, frame, flyer, foundation, took, after };
}

/**
 * How long a whole cascade can take to run itself out, in seconds of game time.
 *
 * `DECK_SIZE` launches `LAUNCH_INTERVAL` apart is `9.36` s, and the last card
 * then has at most the width of the stage plus its own to cover before it clears
 * a side edge — at `LAUNCH_VX_MIN` (`180`), the slowest launch
 * `specs/victory.md` allows, `7.67` s. A BOUND ON THE WAIT, arithmetic over the
 * figures the specification fixes, and not a reading of anything: no check
 * asserts how long a cascade took.
 */
export const CASCADE_RUNOUT_SECONDS =
  DECK_SIZE * LAUNCH_INTERVAL + (STAGE_W + CARD_W) / LAUNCH_VX_MIN;

/* -------------------------------------------------------------------------- */
/* Reading the launch draw                                                    */
/* -------------------------------------------------------------------------- */

/**
 * Perform `count` launch draws through `drawLaunchVx` and hand back what each
 * returned, in order.
 *
 * `specs/instrumentation.md` has `drawLaunchVx` perform exactly the draw a
 * launch performs and nothing else, so this is the launch's `vx` read without
 * the launch: no cascade is run, no card is launched, and nothing is in flight.
 * The draws go over in ONE crossing, so a reading of a few dozen costs what one
 * operation costs. A value that is not a finite number is failed here, because
 * a check comparing it against a range would otherwise report the range.
 */
export async function drawLaunches(
  h: Harness,
  count: number,
): Promise<number[]> {
  const drawn = await h.pose(
    Array.from({ length: count }, () => ({ op: "drawLaunchVx", args: [] })),
  );
  return drawn.map((value, index) => {
    if (typeof value !== "number" || !Number.isFinite(value)) {
      fail(
        "drawLaunchVx() to return a finite number, the signed vx it drew " +
          "(specs/instrumentation.md)",
        `draw ${index + 1} returned ${JSON.stringify(value)}`,
      );
    }
    return value;
  });
}

/**
 * How long the drawn speeds are flown for before the still is taken, in
 * seconds. A picture's duration and nothing a check asserts: long enough for
 * the fan of cards to show which way each drawn speed carries its card.
 */
const DRAWN_FLIGHT_SECONDS = 0.6;

/**
 * Put the drawn speeds on the table for the still: one card in flight per
 * value, launched from the foundation anchors in turn at `LAUNCH_VY`, and flown
 * for {@link DRAWN_FLIGHT_SECONDS} off camera so the fan is visible.
 *
 * Arrangement for the picture alone. Nothing a `launch-vx` check asserts is read
 * from the flyers this poses; the draws were read before it ran.
 */
export async function poseDrawnFlight(
  h: Harness,
  speeds: readonly number[],
): Promise<void> {
  await openFlight(h);
  await h.pose(
    speeds.map((vx, index) => ({
      op: "addFlyer",
      args: [
        "spades",
        RANK_MAX,
        FOUNDATION_X[index % FOUNDATION_COUNT],
        TOP_ROW_Y,
        vx,
        LAUNCH_VY,
      ],
    })),
  );
  await h.skip(DRAWN_FLIGHT_SECONDS);
  await h.advance(1);
}

/* -------------------------------------------------------------------------- */
/* Reading the table                                                          */
/* -------------------------------------------------------------------------- */

/**
 * The band of the table a check may measure painted AREA over.
 *
 * From the bottom of an empty tableau column (`TABLEAU_Y + CARD_H`, `320`) to the
 * top of the HUD strip (`HUD_Y`, `680`). `specs/table.md` puts every pile above
 * it — the top row ends at `164`, and every column is empty by the time the game
 * is won, so their slot marks end at `320` — and `specs/screens.md` puts the HUD
 * below it. So on the `won` screen the only things that can be drawn here are the
 * painted layer, the cards in flight, and the win message.
 *
 * A reading confined to this band is therefore a reading of the painted layer
 * once the flyers are taken out of it, which is what {@link paintedFelt} does:
 * the piles a build draws at their anchors cannot be mistaken for paint, and the
 * anchors' own count falls as the foundations empty, so a reading that included
 * them would move for a reason that has nothing to do with the trail.
 */
export const FELT_RECT: Rect = {
  x: 0,
  y: TABLEAU_Y + CARD_H,
  w: STAGE_W,
  h: HUD_Y - (TABLEAU_Y + CARD_H),
};

/**
 * The grid {@link FELT_RECT} is sampled on.
 *
 * `48 x 14` points, one every `26.7` units across and `25.7` down — finer than a
 * card in either dimension (`100 x 140`), so a single stamp lands on a dozen of
 * them, and coarse enough that the whole grid is read in one crossing into the
 * page.
 */
export const FELT_GRID: Point[] = gridPoints(FELT_RECT, 48, 14);

/**
 * The colour of every point of {@link FELT_GRID}, as the frame most recently
 * drawn left it.
 *
 * THE BASELINE A PAINTED READING IS TAKEN AGAINST, POINT BY POINT. Read this
 * before anything has painted and hand it to {@link paintedFelt}, which asks of
 * each point whether it has moved from the colour IT held rather than from the
 * colour some other point held.
 *
 * Why not one sample of bare felt for the whole band: `specs/overview.md` leaves
 * "the table behind them" to the build and fixes only that a card reads apart
 * from it, so a conformant build may draw its felt with a gradient, a vignette,
 * or a texture. A reading that compared every point against one sample would
 * count that variation as paint — and worse, would count it at the FIRST reading
 * too, so a build whose felt varies could read the whole band already covered
 * before a single card had flown and then fail for not growing. Comparing each
 * point against itself removes the assumption entirely: a flat felt and a
 * textured one both read nothing painted until something paints.
 */
export async function readFelt(h: Harness): Promise<Rgb[]> {
  const read = await h.pixels(FELT_GRID);
  return read.map(([r, g, b]) => ({ r, g, b }));
}

/**
 * Which points of {@link FELT_GRID} the PAINTED LAYER has covered: painted
 * differently from the colour that same point held in `bare`, as the frame most
 * recently drawn left it, and not underneath a card in flight.
 *
 * `bare` is a {@link readFelt} reading taken before anything painted, one entry
 * per point of the grid, so each point is compared against ITSELF.
 *
 * THE FLYERS ARE TAKEN OUT, and that is the whole reason this function exists
 * rather than a bare pixel sweep. A card in flight is drawn at its position
 * whether or not the build kept a layer at all, so a build that cleared the layer
 * every frame would still read a growing area as the cascade puts more cards in
 * the air. Excluding the points under the flyers the snapshot reports leaves only
 * what the layer itself is carrying, so such a build reads nothing painted at any
 * moment.
 *
 * THERE IS NO THRESHOLD. The case fixes no palette, so how far a stamp reads from
 * the felt is the reviewer's; the point is compared
 * against ITSELF on the bare table, so any difference at all is paint. A single
 * pixel per point rather than an averaged cluster, because what is being counted
 * is area rather than the colour of one thing.
 */
export async function paintedFelt(
  h: Harness,
  bare: readonly Rgb[],
  flyers: readonly FlyerView[],
): Promise<boolean[]> {
  const read = await h.pixels(FELT_GRID);
  return read.map(([r, g, b], index) => {
    const point = FELT_GRID[index];
    const underFlyer = flyers.some(
      (f) =>
        point.x >= f.x &&
        point.x < f.x + CARD_W &&
        point.y >= f.y &&
        point.y < f.y + CARD_H,
    );
    if (underFlyer) return false;
    return colorDistance({ r, g, b }, bare[index]) > 0;
  });
}
