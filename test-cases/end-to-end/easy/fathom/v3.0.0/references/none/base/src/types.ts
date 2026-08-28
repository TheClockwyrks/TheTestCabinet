// Fathom — the vocabulary the whole build shares.
//
// Every name here is one the snapshot `specs/state.md` defines reports
// verbatim, so the simulation carries the specification's own words and the
// snapshot is a projection rather than a translation.

/** A cardinal heading. A body at rest keeps the facing it last travelled on. */
export type Dir = "up" | "down" | "left" | "right";

/** The four headings, in the order the game iterates them. */
export const DIRS: readonly Dir[] = ["up", "down", "left", "right"];

/** A body's heading, or `null` while it stands still. */
export type Heading = Dir | null;

/** A tile of the grid, as the snapshot's `tiles` alphabet reports it. */
export type TileKind = "rock" | "corridor" | "gate" | "den";

/** A tile's visibility this instant, as the snapshot's `visibility` reports it. */
export type Visibility = "unrevealed" | "remembered" | "lit";

/** The screen the game is showing. */
export type Screen =
  | "title"
  | "howto"
  | "countdown"
  | "playing"
  | "paused"
  | "cleared"
  | "gameover";

/** Which hunter a predator is. */
export type PredatorKind = "lanternjaw" | "gloamfin" | "flarefish";

/** Where a predator is and what it is doing. */
export type PredatorState = "den" | "wander" | "chase" | "search";

/** What cast a sonar wavefront, and the tint it is drawn in. */
export type PulseSource = "forager" | "gloamfin";
export type PulseTint = "cyan" | "violet" | "orange";

/** A tile coordinate on the grid. */
export interface Cell {
  col: number;
  row: number;
}

/** The step, in tiles, one heading takes. */
export function dirStep(d: Dir): Cell {
  switch (d) {
    case "up":
      return { col: 0, row: -1 };
    case "down":
      return { col: 0, row: 1 };
    case "left":
      return { col: -1, row: 0 };
    case "right":
      return { col: 1, row: 0 };
  }
}

/** The heading facing the other way. */
export function opposite(d: Dir): Dir {
  switch (d) {
    case "up":
      return "down";
    case "down":
      return "up";
    case "left":
      return "right";
    case "right":
      return "left";
  }
}

/** Whether `to` is a quarter turn off `from`, which is only taken at a center. */
export function isPerpendicular(from: Dir, to: Dir): boolean {
  return to !== from && to !== opposite(from);
}
