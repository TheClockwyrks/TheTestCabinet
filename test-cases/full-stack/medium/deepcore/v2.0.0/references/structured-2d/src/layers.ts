// Deepcore — the render layers, numbered in one place.
//
// The engine's pipeline sorts every render component by `layer` ascending, then
// by the owning actor's spawn order, then by attachment order (engine/rendering.md).
// Deepcore's picture is five layers deep and two of them hang off different
// actors — the mine's own and the prospector's — so the numbers live here rather
// than as literals beside each component, and the gaps leave room for a layer
// between any two.

export const LAYER = {
  /** The sky, the rock, the carved tunnels, the camp, and the ground items. */
  terrain: 10,
  /** The prospector. */
  miner: 20,
  /** The produced particle bursts, which read over the miner rather than under. */
  effects: 30,
  /** The scanner's indicator and the building prompt, over the mine. */
  overlays: 40,
  /** The status bar, the panels, the menus, and the screens. */
  hud: 50,
} as const;
