// Meltdown — instrumentation/poses-read-back-the-pointer-and-the-gate: NOT YET WRITTEN.
//
// This file is a placeholder so the case manifest resolves. The review item
// `instrumentation.poses-read-back-the-pointer-and-the-gate` points at it, and the suite that belongs here has still to
// be written against the rendered specs.
//
// THE CLAIM IT MUST DECIDE.
// The pointer poses and the world gate are reported by the snapshot:
// pointerMove, pointerDown and pointerUp read back as pointer.x, pointer.y and pointer.down, and setWaveSpawning reads back as waveSpawning.
//
// Write it in the shape every other suite in this project uses: pose the world
// through the debug surface, hold only what this requirement concerns, advance
// the clock by the frames the requirement needs, and assert one thing in one
// direction. Every figure it compares against comes from this project's own
// `constants.ts`.
