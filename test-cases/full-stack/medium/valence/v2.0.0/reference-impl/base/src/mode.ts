// Valence — the campaign start this build plays (specs/gameplay.md).
//
// THE CAMPAIGN START IS ISOLATED TO THIS CONFIG: the starting resources and whether
// interest is paid. Which matter each round fields is fixed by the round table in
// waves.ts (specs/matter.md). Everything else — the board, the HP/damage-type/trait model,
// the seven towers and their branch upgrades, the 40-round progression and scoring
// (specs/gameplay.md), and the game states and HUD (specs/ui.md) — is common.

export interface CampaignMode {
  slug: string;
  menuLabel: string; // the main-menu entry for this start (specs/gameplay.md)
  tagline: string;
  startEnergy: number;
  startIntegrity: number;
  interest: boolean;
}

export const MODE: CampaignMode = {
  slug: "standard",
  menuLabel: "CONTAINMENT",
  tagline: "THE STANDARD CONTAINMENT CAMPAIGN",
  startEnergy: 650,
  startIntegrity: 100,
  interest: true,
};
