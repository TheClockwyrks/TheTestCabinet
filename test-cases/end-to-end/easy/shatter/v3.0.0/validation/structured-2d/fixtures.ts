// Shatter — the shared scenario placements. CASE-PROVIDED.
//
// A validator arranges a field and then reads what the build's own rules did
// with it, so WHERE it arranges that field is part of the check. Most of the
// time the placement is the check's own business and belongs in the check. The
// placements here are the exceptions: each is shared by more than one item, or
// is load-bearing in a way a later reader would otherwise sand off, and each
// carries the reason it is what it is.
//
// Everything here is GEOMETRY — a position, a drift, a row, a weave. Not one
// figure below is a bound a check asserts. Every threshold stays in the check
// that asserts it, derived from the figure specs/ fixes for it.
//
// One of these encodes a repair the previous version of this case needed, and it
// is the one not to quietly move:
//
//   FRAGMENT_FAN   a parent rock far enough out that the well cannot build the
//                  drift the item reads, drifting DIAGONALLY against a
//                  HORIZONTAL shot so the two kick conventions differ by
//                  construction

import { FIELD_H, FIELD_W } from "./constants";
import { driftOver, pullAt, type Vec } from "./geometry";

/* -------------------------------------------------------------------------- */
/* Quiet ground                                                               */
/* -------------------------------------------------------------------------- */

/**
 * The far corner of the field, `(320, 620)`.
 *
 * `412` units from the star, where the well pulls at about `26` units per
 * second squared — so a scenario that runs for a quarter of a second there has
 * gravity adding under `7` units per second to whatever it arranged. It is the
 * ground for any check that reads a velocity it posed rather than one the well
 * produced. {@link driftOver} answers what the well would add over a given
 * stretch, which is the number to weigh against the figure the check asserts.
 */
export const QUIET_CORNER: Vec = { x: 320, y: 620 };

/**
 * The mirror of {@link QUIET_CORNER} on the other diagonal, `(960, 100)`, the
 * same `412` units out.
 *
 * For a check that needs two quiet places at once — a rock at one and the ship
 * at the other — far enough apart that neither reaches the other over the
 * stretch it runs for.
 */
export const QUIET_CORNER_OPPOSITE: Vec = { x: 960, y: 100 };

/**
 * How hard the well pulls at the quiet ground, in units per second squared.
 * Stated once so a check can weigh its own tolerance against it rather than
 * against the word "far".
 */
export const QUIET_PULL: number = pullAt(QUIET_CORNER);

/* -------------------------------------------------------------------------- */
/* The fragment fan                                                           */
/* -------------------------------------------------------------------------- */

/**
 * The arrangement `rocks/fragment-velocity-carries-the-parent` and
 * `rocks/fragment-kick-is-perpendicular-to-the-shot` both pose.
 *
 * They are two items because both directions of specs/collision.md's fan are
 * load-bearing: each fragment takes the destroyed rock's velocity PLUS a kick
 * of `SPLIT_KICK` perpendicular to THE BULLET'S travel, the two fragments
 * kicked to opposite sides. Read off the PAIR, both fall out cleanly — the
 * average of the two fragment velocities is the parent's whatever the kick did,
 * and the difference is twice the kick with the parent's motion cancelled.
 *
 * Two things about the placement are deliberate, and moving either loses the
 * repair it carries.
 *
 * FAR OUT. The parent sits on the quiet ground, where the well adds a few units
 * per second over the shots rather than the seventy the previous version's
 * placement let it build. Read there, the average of the fragment pair is the
 * drift the item arranged rather than one gravity mostly wrote.
 *
 * DIAGONAL AGAINST A HORIZONTAL SHOT. Two builds this case has graded kick
 * their fragments perpendicular to THE ROCK'S course rather than the BULLET'S,
 * which specs/collision.md rules out in as many words. A parent drifting along
 * the shot's own line makes the two conventions agree, and the check then
 * passes a build that has the rule backwards. A drift of `(-60, -60)` — `85`
 * units per second, a legal Large drift speed — against a shot fired along `+x`
 * puts `45` degrees between them, so the two conventions differ by construction
 * and not by luck.
 *
 * The parent velocity the average is compared against is still read from the
 * SNAPSHOT on the tick before the fatal round lands, never from the figure
 * below, so what little the well did add cannot enter the comparison at all.
 */
export const FRAGMENT_FAN = {
  /** Where the parent rock is posed. */
  parent: QUIET_CORNER,
  /** The drift it is given: 85 units per second, diagonally up and left. */
  drift: { vx: -60, vy: -60 },
  /** The heading the round that kills it travels along: straight along +x. */
  shotHeading: 0,
} as const;

/** What the well adds to the parent's velocity over a second at that placement. */
export const FRAGMENT_FAN_DRIFT_PER_SECOND: number = driftOver(
  FRAGMENT_FAN.parent,
  1,
);

/* -------------------------------------------------------------------------- */
/* The seams                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * A point just inside each of the four edges — where a check about the wrap
 * poses a body so one tick of ordinary motion carries it across.
 *
 * None of the four sits on a midline through the star. The star stands at the
 * centre of the field, and a seam point on its row or its column is closer to
 * it than one set off the line: each of these is at least `560` units out,
 * where the well pulls at under `14` units per second squared. A body posed at
 * a seam is therefore carried across by the velocity the check gave it and not
 * by the star.
 */
export const SEAM = {
  left: { x: 1, y: 100 } as Vec,
  right: { x: FIELD_W - 1, y: FIELD_H - 100 } as Vec,
  top: { x: 200, y: 1 } as Vec,
  bottom: { x: FIELD_W - 200, y: FIELD_H - 1 } as Vec,
} as const;
