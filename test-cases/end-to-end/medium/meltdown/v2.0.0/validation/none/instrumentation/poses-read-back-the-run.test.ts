// Meltdown — instrumentation/poses-read-back-the-run: NOT YET WRITTEN.
//
// This file is a placeholder so the case manifest resolves. The review item
// `instrumentation.poses-read-back-the-run` points at it, and the suite that belongs here has still to
// be written against the rendered specs.
//
// THE CLAIM IT MUST DECIDE.
// The run poses are reported by the snapshot:
// setScreen, setPhase, setMenuIndex, setMode and setDifficulty each read back on the snapshot as screen, phase, menuIndex, mode and difficulty.
//
// Write it in the shape every other suite in this project uses: pose the world
// through the debug surface, hold only what this requirement concerns, advance
// the clock by the frames the requirement needs, and assert one thing in one
// direction. Every figure it compares against comes from this project's own
// `constants.ts`.
