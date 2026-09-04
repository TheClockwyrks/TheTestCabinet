// Meltdown — the prose the screens draw.
//
// The screen COPY the specification fixes — the title, the tagline, and every
// menu's rows — lives in `src/constants.ts` and is read from there. What is
// here is the writing around it: the sentence each mode reads by before it is
// chosen (specs/screens.md, `modeselect`), the subjects the how-to screen
// covers, and the short label a tower carries on the floor.

import { type ModeName, type TowerType } from "./constants";

/** What each mode is and what it changes, readable before it is chosen. */
export const MODE_BLURB: Readonly<Record<ModeName, readonly string[]>> = {
  containment: [
    "The standard run. Hold the floor through",
    "every wave of the progression until the",
    "last one is cleared, or the lives run out.",
    "The only mode with a difficulty.",
  ],
  hundred: [
    "One onslaught of a hundred units, cycling",
    "every type, each six times as tough.",
    "No build phases: what you lay out before",
    "the send is what you fight it with.",
  ],
  deeppockets: [
    "Ten thousand to spend and no interest",
    "paid on it. The standard twenty waves,",
    "with the money question taken away and",
    "the heat question left standing.",
  ],
  bottleneck: [
    "Building is confined to a marked central",
    "zone, columns 13 to 36 and rows 8 to 27.",
    "Both corridors run through it, so the maze",
    "has to be wound inside one room.",
  ],
  suddendeath: [
    "One life. A single unit reaching an exhaust",
    "ends the run, whatever it was and however",
    "far in. The standard twenty waves and the",
    "standard money.",
  ],
};

/** The subjects the how-to screen covers. */
export const HOWTO_LINES: readonly string[] = [
  "THE GOAL",
  "  The surge pours in through the two vents and crosses the floor to the",
  "  opposite exhaust. Every unit that reaches one costs you lives. Clear",
  "  every wave of the run to win.",
  "",
  "THE CONTROLS",
  "  Point and press to build. 1-8 arm a tower, R turns the held preview,",
  "  Space sends the next wave, F doubles the speed, U upgrades and S sells",
  "  the selected tower, P pauses, M mutes. Escape cancels, then deselects,",
  "  then pauses.",
  "",
  "TOWERS ARE WALLS",
  "  There is no fixed path. Every tower blocks its footprint, so you build",
  "  the maze the surge walks. You can never seal the floor: a placement",
  "  that would is refused.",
  "",
  "HEAT IS POWER",
  "  An emitter fires harder the hotter it runs, climbing to full power at",
  "  its own redline and holding it there. Carry one to 100 and it trips:",
  "  five seconds dark while it bleeds cold. That is its only failure.",
  "",
  "COOLING",
  "  A tower sheds heat only through the faces that touch open air, and its",
  "  radiator faces shed far more. Rotate a tower before placing it to aim",
  "  them. A block of guns packed tight bakes its own core.",
  "",
  "THE FORGE AND THE SINK",
  "  The Forge warms every emitter it touches toward its setpoint and never",
  "  past it. The Sink drains one through a face nothing else can cool",
  "  through. Neither fires, and both are walls like any other tower.",
  "",
  "THE RIME, THE FLAK, AND THE SURGE",
  "  The Rime slows what it hits, hardest when it is cold, and deals",
  "  ordinary damage besides. The Flak fires at flyers alone, and the Drift",
  "  is the flyer: it ignores the maze entirely. A Containment wave fields",
  "  a single type; the halfway wave and the last one carry the Core.",
  "",
  "MONEY",
  "  Kills pay a bounty, clearing a wave pays a bonus, a build phase pays",
  "  interest on what you held back, and sending early pays a coin a second.",
];

/** The short label a tower carries on its footprint. */
export const TOWER_LABEL: Readonly<Record<TowerType, string>> = {
  arc: "ARC",
  stutter: "STU",
  rime: "RIM",
  flak: "FLK",
  bloom: "BLM",
  lance: "LNC",
  forge: "FRG",
  sink: "SNK",
};

/** The name a tower reads under in the shop and in the panel. */
export const TOWER_NAME: Readonly<Record<TowerType, string>> = {
  arc: "ARC",
  stutter: "STUTTER",
  rime: "RIME",
  flak: "FLAK",
  bloom: "BLOOM",
  lance: "LANCE",
  forge: "FORGE",
  sink: "SINK",
};

/** What each tower fires on, as the panel reads it. */
export const TARGETING_READ: Readonly<Record<TowerType, string>> = {
  arc: "GROUND + AIR",
  stutter: "GROUND + AIR",
  rime: "GROUND + AIR",
  flak: "AIR ONLY",
  bloom: "GROUND + AIR",
  lance: "GROUND + AIR",
  forge: "NEVER FIRES",
  sink: "NEVER FIRES",
};
