// Valence — the campaign start this build plays (specs/mode.md).
//
// THIS FILE IS THE PER-VARIANT DIFFERENCE. The standard "Containment" campaign and
// the "Overload" campaign share all game code and all produced assets; they differ
// only in this config: the starting resources, whether interest is paid, and the
// round each tool-specific matter form is introduced on. Everything else — the
// board, the decomposition model, the towers, the 20-round progression, scoring,
// states, and HUD — is common (specs/mode-standard.md).

export interface CampaignMode {
  slug: string;
  menuLabel: string; // the main-menu entry for this start (specs/mode.md)
  tagline: string;
  startEnergy: number;
  startIntegrity: number;
  interest: boolean;
  // The round each tool-specific form first appears (specs/matter.md wave ramp).
  introRounds: {
    swift: number;
    dimer: number;
    polymer: number;
    noble: number;
    heavy: number;
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
    swift: 2,
    dimer: 3,
    polymer: 5,
    noble: 6,
    heavy: 8,
  },
};
