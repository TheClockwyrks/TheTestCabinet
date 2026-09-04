// Meltdown — instrumentation/poses-read-back-a-tower: NOT YET WRITTEN.
//
// This file is a placeholder so the case manifest resolves. The review item
// `instrumentation.poses-read-back-a-tower` points at it, and the suite that belongs here has still to
// be written against the rendered specs.
//
// THE CLAIM IT MUST DECIDE.
// The tower poses are reported by the snapshot:
// setTowerHeat, setTowerLevel, setTowerFresh, setTowerTripped, setTowerTripTimer, setTowerFiring and setTowerThermal each read back on the posed tower as heat, level, fresh, tripped, tripTimer, firingEnabled and thermalEnabled.
//
// Write it in the shape every other suite in this project uses: pose the world
// through the debug surface, hold only what this requirement concerns, advance
// the clock by the frames the requirement needs, and assert one thing in one
// direction. Every figure it compares against comes from this project's own
// `constants.ts`.
