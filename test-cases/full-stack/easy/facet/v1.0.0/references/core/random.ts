// Facet — the game's own random source.
//
// Two things in this build draw: the deal of an opening board and the refill
// in R9 (specs/rules.md). Both are stated as distributions — a kind drawn from
// `GEM_KINDS` — and nothing outside the game reads the source, so the source is
// private and nothing about it is part of the state. A draw that a scenario
// needs pinned down is posed instead, through `setRefillKinds` on the debug
// surface, which is what keeps a posed scenario exact without anything here
// being replayable.
//
// The source is handed in rather than reached for, so a test can hand the deal
// or the refill a degenerate one and read what it does with it.

/** Something that picks one of a list, uniformly. `items` is never empty. */
export interface Picker {
  pick<T>(items: readonly T[]): T;
}

/** The game's picker: a uniform draw off the host's own random source. */
export const randomPicker: Picker = {
  pick(items) {
    return items[Math.floor(Math.random() * items.length)];
  },
};
