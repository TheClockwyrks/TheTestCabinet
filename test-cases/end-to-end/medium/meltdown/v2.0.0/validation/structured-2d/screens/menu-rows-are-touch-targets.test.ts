// Meltdown — screens/menu-rows-are-touch-targets: NOT YET WRITTEN.
//
// This file is a placeholder so the case manifest resolves. The review item
// `screens.menu-rows-are-touch-targets` points at it, and the suite that belongs here has still to
// be written against the rendered specs.
//
// THE CLAIM IT MUST DECIDE.
// Every menu row is big enough to tap:
// Each reported row rectangle is at least MIN_TOUCH_TARGET (32) by 32 logical units, and no two rows of one menu overlap.
//
// Write it in the shape every other suite in this project uses: pose the world
// through the debug surface, hold only what this requirement concerns, advance
// the clock by the frames the requirement needs, and assert one thing in one
// direction. Every figure it compares against comes from this project's own
// `constants.ts`.
