// Volute — the game's private random source.
//
// Every random draw the game makes comes through here: the charges of the cores
// a level opens with, the charge of each emitted core, and the charges the
// injector loads and queues. The specification states the set each draw is
// uniform over and nothing about how it is drawn (specs/channel.md), so this is
// the one place a draw is made, over the platform's own generator, and a
// scenario that wants a particular outcome poses it through the debug surface
// rather than reaching in here.

/** A whole number drawn uniformly from `[0, bound)`. */
export function nextInt(bound: number): number {
  if (bound <= 1) return 0;
  return Math.min(bound - 1, Math.floor(Math.random() * bound));
}

/**
 * One member of `choices`, uniformly.
 *
 * An empty list is not a legal draw — every caller in this game holds at least
 * one charge — so it throws rather than inventing a value.
 */
export function pick<T>(choices: readonly T[]): T {
  if (choices.length === 0) {
    throw new RangeError("Volute: cannot draw from an empty set");
  }
  return choices[nextInt(choices.length)];
}
