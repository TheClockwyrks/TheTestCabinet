// Coil — the random source the pellet draw runs off.
//
// The one draw Coil makes is the cell each pellet spawns on, uniform over the
// valid set `specs/board.md` defines. The engine supplies no source, so this is
// the build's own, and the specification names none. A scenario that needs a
// particular outcome poses it through `setNextPellet` rather than through this
// module, which is why nothing here is pinned, stepped, or read back.

/** A whole number in `[0, count)`, drawn uniformly. `count` is at least 1. */
export function drawBelow(count: number): number {
  return Math.min(count - 1, Math.floor(Math.random() * count));
}
