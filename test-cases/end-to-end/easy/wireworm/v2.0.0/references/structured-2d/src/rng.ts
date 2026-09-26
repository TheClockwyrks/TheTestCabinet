// Wireworm — the game's private random source.
//
// Every draw the game makes runs off `Math.random()`: the starting scatter, each
// foe kind's arrival clock and entry position, and the edge a level's worm
// enters at. Nothing about the source lives in `WirewormState`, and the debug
// surface poses the outcome of a draw a scenario needs rather than steering the
// source (`specs/instrumentation.md`, The level's draws).

/** The next draw in `[0, 1)`. */
export function random(): number {
  return Math.random();
}

/** The next draw in `[min, max)`. */
export function randomRange(min: number, max: number): number {
  return min + random() * (max - min);
}

/** The next whole draw in `[min, max]`, both ends included. */
export function randomInt(min: number, max: number): number {
  return min + Math.floor(random() * (max - min + 1));
}

/** A coin, which is how an entry edge and an entry direction are chosen. */
export function randomSign(): number {
  return random() < 0.5 ? -1 : 1;
}
