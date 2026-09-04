/**
 * `@test-cabinet/headless-webgl2` — a pure-TypeScript, in-process WebGL2
 * implementation for Node, built so the 3D engines and their validators can
 * construct and render with no browser, no GPU, and no native module.
 *
 * The public surface is deliberately small: `createCanvas` and the types a
 * consumer needs to hold what it returns. The context type is the
 * implementation class's own type rather than a separately maintained
 * interface, because a hand-copied interface would be one more place for a
 * method to be forgotten in — the class is the subset, and the engines reach
 * it through DOM typings anyway (`as unknown as HTMLCanvasElement`), so only
 * validator code ever names this type, for `gl.readPixels`/`gl.RGBA`-style
 * reads that must typecheck without the DOM lib.
 */

export { createCanvas } from "./canvas";
export type { Canvas, ContextAttributes } from "./canvas";
export type {
  HeadlessWebGL2Context as HeadlessWebGL2,
  HeadlessWebGL2Context as WebGL2,
  ResolvedContextAttributes,
} from "./context";
