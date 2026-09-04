// Meltdown — controls/pointer-reaches-a-menu-row: NOT YET WRITTEN.
//
// This file is a placeholder so the case manifest resolves. The review item
// `controls.pointer-reaches-a-menu-row` points at it, and the suite that belongs here has still to
// be written against the rendered specs.
//
// THE CLAIM IT MUST DECIDE.
// Moving the pointer onto a menu row highlights it:
// A pointer move into the rectangle the build reported for the second row of the title menu sets menuIndex to 1 and takes nothing, and a move back off every row leaves the highlight on that row.
//
// Write it in the shape every other suite in this project uses: pose the world
// through the debug surface, hold only what this requirement concerns, advance
// the clock by the frames the requirement needs, and assert one thing in one
// direction. Every figure it compares against comes from this project's own
// `constants.ts`.
