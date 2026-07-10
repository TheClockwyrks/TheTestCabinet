// Fathom — shared types.

// Cardinal directions. NONE means stopped.
export const enum Dir {
  None = 0,
  Up = 1,
  Down = 2,
  Left = 3,
  Right = 4,
}

export interface Vec {
  x: number;
  y: number;
}

// Delta (dx,dy) for a direction, in tiles.
export function dirVec(d: Dir): Vec {
  switch (d) {
    case Dir.Up:
      return { x: 0, y: -1 };
    case Dir.Down:
      return { x: 0, y: 1 };
    case Dir.Left:
      return { x: -1, y: 0 };
    case Dir.Right:
      return { x: 1, y: 0 };
    default:
      return { x: 0, y: 0 };
  }
}

export function opposite(d: Dir): Dir {
  switch (d) {
    case Dir.Up:
      return Dir.Down;
    case Dir.Down:
      return Dir.Up;
    case Dir.Left:
      return Dir.Right;
    case Dir.Right:
      return Dir.Left;
    default:
      return Dir.None;
  }
}

export const enum Tile {
  Wall = 0,
  Open = 1,
  Den = 2,
  Gate = 3,
}

export const enum GameState {
  Title,
  HowTo,
  Dive, // dive countdown before control resumes
  Playing,
  Paused,
  Cleared, // "DEPTH n CLEARED" interstitial
  GameOver,
}

export const enum PredKind {
  Lure,
  Listener,
  Flarefish,
}

export const enum PredState {
  Den, // waiting in / navigating out of the den
  Patrol,
  Hunt,
  Returning, // heading back to the den after the forager is caught
}
