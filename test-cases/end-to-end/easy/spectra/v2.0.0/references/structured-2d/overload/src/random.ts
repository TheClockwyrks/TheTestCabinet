// Spectra — the game's random draws.
//
// The specification states each draw the game makes as behavior: which formation
// drone a launch takes and the gap before the next launch (`specs/swarm.md`), the
// band clock a Flux starts its first window at (`specs/drones.md`), the scatter
// of each drone-burst (`specs/assets.md`), and the band an overloaded Prism's
// escort arrives on (`specs/mode.md`). This build also draws which slots of a
// wave's block hold which kind, which `specs/swarm.md` leaves to it. Every draw
// runs off the host's own generator: nothing about a draw is part of the game's
// state, and nothing reads one back.

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

/** One entry of `items`, drawn uniformly, or `undefined` for an empty list. */
export function randomPick<T>(items: readonly T[]): T | undefined {
  if (items.length === 0) return undefined;
  return items[randomInt(0, items.length - 1)];
}
