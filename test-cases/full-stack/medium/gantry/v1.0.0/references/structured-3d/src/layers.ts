// Where each render component draws in its pass.
//
// The engine sorts the world pass by `layer` as the object's `renderOrder` and
// the screen pass by `layer` ascending, so both orders are numbered here, in
// one table, with gaps left between them (`engine/rendering.md`).

export const LAYER = {
  /** The world pass: the sky behind everything, then the yard on top of it. */
  sky: -10,
  ground: 0,
  fixtures: 10,
  crane: 20,
  parts: 22,
  /** The build aids, drawn over the crane so a held node is never hidden. */
  aids: 30,

  /** The screen pass: a scrim, then panels, then their text, then the flags. */
  scrim: 100,
  panel: 110,
  text: 120,
  banner: 130,
  flag: 140,
} as const;
