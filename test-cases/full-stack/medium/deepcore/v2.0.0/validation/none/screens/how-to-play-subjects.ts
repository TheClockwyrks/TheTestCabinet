// Deepcore — what the how-to screen has to cover, and how it is read.
// CASE-PROVIDED.
//
// Not a `.test.ts`, so vitest never collects it.
//
// specs/ui.md: "`how-to-play` covers the goal of building and launching the
// rocket, the controls, the dig-sell-upgrade loop, that the drill cuts down,
// left, and right but never up, fuel and the climb home, the cargo's slots and
// its weight, the hazards, the materials and the scanner, saving, and the two
// modes."
//
// SIX GROUPS, SIX POINTS. That sentence lists eleven subjects, and one point that
// asserted all eleven could only fail once — a build missing one line of copy
// would be docked exactly as much as one missing every line. They are grouped
// into the six things the screen is FOR, so a failed grade names the part of the
// briefing a build left out, and each group's suite states which subjects it
// covers.
//
// HOW A SUBJECT IS READ WITHOUT FIXING THE WORDS. The specification fixes the
// screen's CONTENT and not its prose — "The content and the navigation are fixed;
// the layout is yours" — so each subject is read as the vocabulary the
// SPECIFICATION ITSELF fixes for it — the two mode names, the two material names,
// the two hazard names, the drill's directions, the keys `specs/controls.md`
// binds — together with the plain words a briefing states the same subject in,
// as the climb home is read as the jetpack and the thrust as well as the climb.
// So a build that writes its own prose about the right subjects passes and a
// build that leaves a subject out does not.

/** One subject the screen has to cover, and the terms that say it was covered. */
export type Subject = readonly [string, RegExp];

/** The goal: the rocket that is built, and launching it. */
export const GOAL: readonly Subject[] = [
  ["the rocket that is built", /\bROCKET\b/],
  ["launching it", /\bLAUNCH/],
];

/** The controls: how the miner is driven, and which way the drill cuts. */
export const CONTROLS: readonly Subject[] = [
  // The collective names a build gives the movement keys, or `W` and `D` as words
  // of their own, which ordinary prose does not produce the way `A` and `S` do.
  ["the movement controls", /\bWASD\b|\bARROW|\bW\b|\bD\b/],
  ["the drill cutting downward", /\bDOWN\b|\bDOWNWARD/],
  ["the drill and up", /\bUP\b|\bUPWARD/],
];

/** The loop: dig, sell, upgrade. */
export const LOOP: readonly Subject[] = [
  ["digging", /\bDIG\b|\bDIGS\b|\bDIGGING\b|\bDRILL/],
  ["selling", /\bSELL/],
  // The shop's own vocabulary is the upgrade and its tiers (`specs/upgrades.md`),
  // and a briefing that tells the player to improve the miner's systems has
  // covered the same subject in its own words.
  ["upgrading", /\bUPGRAD|\bTIER\b|\bTIERS\b|\bIMPROV/],
];

/** The budget: fuel, the climb home, and what the bay can carry. */
export const BUDGET: readonly Subject[] = [
  ["fuel", /\bFUEL\b/],
  ["the climb home", /\bCLIMB|\bJETPACK\b|\bTHRUST/],
  ["the cargo's slots", /\bSLOT/],
  ["the cargo's weight", /\bWEIGHT\b|\bWEIGHS\b|\bKG\b|\bHEAVY\b|\bHEAVIER\b/],
];

/** The mine: what is down there to fear and what is down there to find. */
export const MINE: readonly Subject[] = [
  ["gas", /\bGAS\b/],
  ["lava", /\bLAVA\b/],
  ["the exotic materials", /\bRESONITE\b|\bCRYENITE\b|\bMATERIAL/],
  ["the scanner", /\bSCANNER\b|\bSCAN\b/],
];

/** The session: saving, and the two modes a run is played in. */
export const SESSION: readonly Subject[] = [
  ["saving", /\bSAVE\b|\bSAVES\b|\bSAVING\b|\bSAVED\b/],
  ["the Standard mode", /\bSTANDARD\b/],
  ["the Hardcore mode", /\bHARDCORE\b/],
];
