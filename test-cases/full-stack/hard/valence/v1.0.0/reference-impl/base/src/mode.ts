// Valence — the campaign start this build plays (specs/mode.md).
//
// THE CAMPAIGN START IS ISOLATED TO THIS CONFIG: the starting resources, whether
// interest is paid, and the round each matter TYPE (and, late, each trait COMBO) first
// appears. Everything else — the board, the HP/damage-type/trait model, the seven
// towers and their branch upgrades, the 20-round progression, scoring, states, and HUD —
// is common (specs/mode-standard.md).

export interface CampaignMode {
  slug: string;
  menuLabel: string; // the main-menu entry for this start (specs/mode.md)
  tagline: string;
  startEnergy: number;
  startIntegrity: number;
  interest: boolean;
  // The round each matter type first appears (specs/matter.md wave ramp). Regular atoms
  // start at round 1 (their electron count ramps up over the run); each entry below
  // unlocks a trait or a combo.
  introRounds: {
    dimer: number; // bonded
    noble: number; // inert
    polymer: number; // bonded, longer
    heavy: number; // heavy isotope (energy-immune)
    chelate: number; // inert + bonded combo
    shroud: number; // inert + heavy combo
  };
}

export const MODE: CampaignMode = {
  slug: "standard",
  menuLabel: "CONTAINMENT",
  tagline: "THE STANDARD CONTAINMENT CAMPAIGN",
  startEnergy: 500,
  startIntegrity: 100,
  interest: true,
  introRounds: {
    dimer: 3,
    noble: 5,
    polymer: 6,
    heavy: 8,
    chelate: 13,
    shroud: 15,
  },
};
