// cascade/flight — the posed flight this group's checks stand a card up in.
//
// LOCAL TO THIS GROUP. Nothing outside `validation/simple-2d/cascade/` imports it,
// so it lives here rather than in the shared harness; it is scenario arrangement
// alone, and it holds no threshold and no figure the specification fixes. Every
// number a check asserts is stated in the check that asserts it.
//
// WHY A POSED FLIGHT AND NOT A CASCADE. specs/victory.md fixes what one card in
// flight does each frame: it is accelerated, moved, bounced off the floor, stamped
// onto the painted layer, and retired past a side edge. A whole cascade puts
// fifty-two of them on the table at once, and reading one parabola out of fifty-two
// would grade the launch order and the launch velocities on every point that is
// really about gravity. So a flight check clears the table, turns the launching off,
// and adds back exactly the cards its own requirement concerns, which is the
// isolation the guidance asks for.
//
// THE SCREEN IS `won`. specs/victory.md states the flight rules of "a running
// cascade", and the cascade runs on the won screen, so that is the screen a posed
// flyer is given. `setLaunching(false)` is what keeps the flight to the cards the
// check added: off, no further card leaves the foundations, and every card already
// in flight keeps flying, bouncing, painting, and retiring
// (specs/instrumentation.md).

import { fail } from "../assert";
import {
  FOUNDATION_COUNT,
  FOUNDATION_X,
  LAUNCH_VY,
  TOP_ROW_Y,
} from "../constants";
import {
  flyerOf,
  framesFor,
  lastFlyer,
  openTable,
  parseCard,
  type CardSnapshot,
  type FlyerSnapshot,
  type Harness,
} from "../harness";

/**
 * A cleared table on the won screen, with nothing in flight, nothing painted, and
 * no card launching.
 *
 * The world every check in this group opens with. `openTable` resets the game and
 * empties the thirteen piles; the flight, the painted layer, and the launching are
 * then cleared and gated explicitly rather than left to `reset`'s defaults, so the
 * scenario a check poses is the scenario it stated.
 *
 * The painting gate is left OFF, which is this group's rule: the painted layer is
 * the subject of three checks and a distraction to the other twenty-two, and a
 * recording armed around a cascade that draws a full-screen layer over every frame
 * spends the recorder's budget on pixels rather than on the motion the check is
 * about. The three trail checks turn it back on themselves.
 */
export function openFlight(h: Harness): void {
  openTable(h);
  h.debug.setScreen("won");
  h.debug.setLaunching(false);
  h.debug.setTrailPainting(false);
  h.debug.clearFlyers();
  h.debug.clearTrail();
}

/** Where a posed card starts, and how fast it is going. */
export interface FlyerPose {
  /** The card's TOP-LEFT, in logical stage units. */
  x: number;
  y: number;
  /** Its velocity, in logical units per second. */
  vx: number;
  vy: number;
  /** Which card it is, as `parseCard` reads it. Defaults to the King of spades. */
  card?: string;
}

/**
 * Add one card to the flight at a stated position and velocity, and hand back its
 * id.
 *
 * `addFlyer` appends, so the flyer is the last entry and its id is read from there
 * (specs/instrumentation.md). Which card it is decides nothing about the flight, so
 * it defaults to one card and a check names another only where it wants two apart.
 */
export function poseFlyer(h: Harness, pose: FlyerPose): number {
  const card = parseCard(pose.card ?? "KS");
  h.debug.addFlyer(card.suit, card.rank, pose.x, pose.y, pose.vx, pose.vy);
  return lastFlyer(h.snapshot()).id;
}

/**
 * Perform `count` launch draws through `drawLaunchVx` and hand back what each
 * returned, in order.
 *
 * specs/instrumentation.md has `drawLaunchVx` perform exactly the draw a launch
 * performs and nothing else, so this is the launch's `vx` read without the
 * launch: no cascade is run, no card is launched, and nothing is in flight. A
 * value that is not a finite number is failed here, because a check comparing
 * it against a range would otherwise report the range.
 */
export function drawLaunches(h: Harness, count: number): number[] {
  return Array.from({ length: count }, (_, index) => {
    const value: unknown = h.debug.drawLaunchVx();
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
 * seconds. A picture's duration and nothing a check asserts: long enough for the
 * fan of cards to show which way each drawn speed carries its card.
 */
const DRAWN_FLIGHT_SECONDS = 0.6;

/**
 * Put the drawn speeds on the table for the still: one card in flight per value,
 * launched from the foundation anchors in turn at `LAUNCH_VY`, and flown for
 * {@link DRAWN_FLIGHT_SECONDS} so the fan is visible.
 *
 * Arrangement for the picture alone. Nothing a `launch-vx` check asserts is read
 * from the flyers this poses; the draws were read before it ran.
 */
export async function poseDrawnFlight(
  h: Harness,
  speeds: readonly number[],
): Promise<void> {
  openFlight(h);
  for (const [index, vx] of speeds.entries()) {
    poseFlyer(h, {
      x: FOUNDATION_X[index % FOUNDATION_COUNT],
      y: TOP_ROW_Y,
      vx,
      vy: LAUNCH_VY,
    });
  }
  await h.advance(framesFor(DRAWN_FLIGHT_SECONDS));
}

/** A flyer either side of the frame a floor bounce happened on. */
export interface Bounce {
  /** Whether a bounce was seen at all inside the frames allowed. */
  hit: boolean;
  /** Frames advanced up to and including the frame the bounce happened on. */
  frames: number;
  /** The flyer at the end of the frame BEFORE the bounce, still descending. */
  before: FlyerSnapshot;
  /** The flyer at the end of the frame the bounce happened on, now ascending. */
  after: FlyerSnapshot;
}

/**
 * Fly the card one frame at a time until the floor turns it around, and report it
 * either side of that frame.
 *
 * The bounce is found by the reversal alone: the frame a descending flyer (`vy`
 * above zero) ends ascending (`vy` below zero) is the frame the floor acted on it,
 * which is what specs/victory.md's third step does and the only thing it does to
 * `vy`'s sign. Nothing here reads a position, so a build that seats a bounced card
 * somewhere other than the floor still gets its bounce found, and the check that
 * cares about the seating is the one that fails it.
 *
 * The frames are stepped one at a time because the readings the bounce checks make
 * are of the frame itself: the speed carried in, the speed carried out, and the
 * position the card was left at. A sweep that sampled every few frames would read a
 * card that had already flown on.
 */
export async function flyToBounce(
  h: Harness,
  id: number,
  maxFrames: number,
): Promise<Bounce> {
  let before = flyerOf(h.snapshot(), id);
  for (let frames = 1; frames <= maxFrames; frames += 1) {
    await h.advance(1);
    const after = flyerOf(h.snapshot(), id);
    if (before.vy > 0 && after.vy < 0)
      return { hit: true, frames, before, after };
    before = after;
  }
  return { hit: false, frames: maxFrames, before, after: before };
}

/**
 * The bounce this check was driving for, or a failure naming the flight that never
 * reached the floor.
 *
 * A posed card aimed down at the floor that never turns around has not bounced, and
 * specs/victory.md says it must, so this is a verdict rather than a missing reading.
 */
export function bounced(bounce: Bounce, context: string): Bounce {
  if (!bounce.hit) {
    fail(
      `a descending card to leave the floor ascending within ${bounce.frames} ` +
        `frames (specs/victory.md: ${context})`,
      `vy stayed at ${bounce.after.vy} with y at ${bounce.after.y}`,
    );
  }
  return bounce;
}

/* -------------------------------------------------------------------------- */
/* Watching a cascade launch                                                  */
/* -------------------------------------------------------------------------- */
//
// The launch checks read what a running cascade did, so they are the one part of
// this group that does NOT pose its own flight: the cascade is entered through the
// game's own win path (`startCascade`) and then watched. What each one needs is the
// same three facts about every launch the run carried, which is what a `Launch` is.
//
// A LAUNCH IS A CARD ARRIVING IN THE FLIGHT, not the `launched` counter moving. The
// two agree in a conformant build, and reading the arrival is the more direct of the
// pair: it is the card itself, with the velocity it left with and the foundation it
// came off, none of which the counter carries. The counter is what
// `cascade-completes` reads.

/** One card leaving a foundation for the flight, as the frame it happened on saw it. */
export interface Launch {
  /** The game time at the end of the frame it launched on, in seconds. */
  at: number;
  /** The foundation it came off, or `-1` where no foundation lost a card. */
  foundation: number;
  /**
   * The card that foundation's TOP held on the frame before, or `null` where no
   * foundation lost a card.
   *
   * Read before the launch rather than assumed, so a check can hold the card that
   * went into the air against the card the launch was supposed to take.
   */
  took: CardSnapshot | null;
  /** The card, as the snapshot reported it on that frame. */
  flyer: FlyerSnapshot;
}

/** Which foundation lost a card between two snapshots, or `-1` where none did. */
function shrankFoundation(before: number[], after: number[]): number {
  return after.findIndex((count, index) => count < (before[index] ?? 0));
}

/**
 * Step `frames` frames one at a time, reporting every card that entered the flight.
 *
 * One frame at a time because a launch's velocity is what the launch gave it: read a
 * few frames later, `vy` has been through gravity. The frames are the suite's own
 * (1/240 s), which is far finer than the launch interval specs/victory.md fixes, so
 * a frame carries at most one launch and each is reported on its own.
 *
 * `stop` ends the sweep early when it has seen everything the check asked for.
 */
export async function watchLaunches(
  h: Harness,
  frames: number,
  stop: (launches: readonly Launch[]) => boolean = () => false,
): Promise<Launch[]> {
  const launches: Launch[] = [];
  let before = h.snapshot();
  const seen = new Set(before.flyers.map((flyer) => flyer.id));

  for (let frame = 0; frame < frames; frame += 1) {
    await h.advance(1);
    const after = h.snapshot();
    for (const flyer of after.flyers) {
      if (seen.has(flyer.id)) continue;
      seen.add(flyer.id);
      const foundation = shrankFoundation(
        before.foundations.map((pile) => pile.length),
        after.foundations.map((pile) => pile.length),
      );
      const held =
        foundation >= 0 ? (before.foundations[foundation] ?? []) : [];
      launches.push({
        at: after.simTime,
        foundation,
        took: held.length > 0 ? held[held.length - 1] : null,
        flyer,
      });
    }
    if (stop(launches)) return launches;
    before = after;
  }
  return launches;
}
