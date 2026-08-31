// Wick — the palette of the night. Nothing here is fixed by the
// specification; it is the look this build chose.

export const COLORS = {
  stage: "#0b0a14",
  groundA: "#161426",
  groundB: "#1c1a30",
  groundLine: "#241f3d",
  lamplight: "rgba(255, 196, 96, 0.14)",
  lamplighter: "#f4d07a",
  lamplighterDark: "#8a5a1c",
  enemy: "#c9c3e6",
  enemyEdge: "#6c62a8",
  elite: "#e08a7a",
  dark: "#3a2a5a",
  darkEdge: "#a070ff",
  gem: "#7fe1ff",
  chest: "#f2c14e",
  bread: "#d9a066",
  draft: "#9be3c9",
  projectile: "#ffd27f",
  zone: "rgba(255, 170, 60, 0.35)",
  zoneEdge: "rgba(255, 190, 90, 0.8)",
  puff: "rgba(230, 230, 255, 0.6)",
  text: "#f3efe4",
  textDim: "#b9b3c9",
  textFaint: "#7d778f",
  highlight: "#ffcf5c",
  panel: "rgba(10, 8, 20, 0.86)",
  panelEdge: "#5b527f",
  dim: "rgba(5, 4, 12, 0.6)",
  health: "#e2564f",
  healthBack: "#3a1d24",
  xp: "#5fc9ff",
  xpBack: "#1a2a3d",
  slot: "rgba(20, 18, 36, 0.85)",
  slotEdge: "#4a4370",
  pip: "#ffcf5c",
  cooldown: "rgba(0, 0, 0, 0.55)",
} as const;

export const FONT = "'Trebuchet MS', 'Segoe UI', Verdana, sans-serif";

/**
 * The engine's render pipeline draws lower layers first, so this table is the
 * back-to-front order of the whole picture: the ground, the lamp's light on
 * it, the zones that lie on the ground, the gems and pickups, the death
 * puffs, the crowd, the zones in the air, the projectiles, the lamplighter,
 * and the HUD with the screen chrome on top. Numbered in one place, with
 * gaps, as the engine's rendering documentation recommends.
 */
export const LAYERS = {
  ground: 0,
  lamplight: 5,
  groundZones: 10,
  gems: 20,
  pickups: 25,
  puffs: 30,
  enemies: 40,
  airZones: 50,
  projectiles: 60,
  lamplighter: 70,
  hud: 80,
  screen: 90,
} as const;
