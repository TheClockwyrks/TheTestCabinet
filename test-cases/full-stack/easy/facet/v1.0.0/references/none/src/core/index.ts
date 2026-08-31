// Facet — the game core, in one place.
//
// This directory is the whole of Facet's rules, state, and debug logic, written
// once and copied verbatim into each of the three reference builds as
// `src/core/`. It imports NOTHING from an engine, a renderer, or a DOM: hand it
// a state and a delta time and it hands back the next state, which is what
// makes the same game playable on `simple-2d`, on `structured-2d`, and on no
// engine at all.
//
// A build's own modules — its runtime layer, its renderer, its audio, its debug
// surface — import from here and add only what is theirs.

export * from "./board";
export * from "./chain";
export * from "./controls";
export * from "./deal";
export * from "./debug";
export * from "./flow";
export * from "./rng";
export * from "./rules";
export * from "./state";
