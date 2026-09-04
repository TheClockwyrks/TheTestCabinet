// Meltdown — screens/menu-rows-reported: NOT YET WRITTEN.
//
// This file is a placeholder so the case manifest resolves. The review item
// `screens.menu-rows-reported` points at it, and the suite that belongs here has still to
// be written against the rendered specs.
//
// THE CLAIM IT MUST DECIDE.
// Every menu row reports its hit region:
// On title, modeselect, difficultyselect, howto, paused, victory and gameover the snapshot's menu holds one rectangle per row of that screen's menu, in row order from index 0, and it is empty while the screen is playing.
//
// Write it in the shape every other suite in this project uses: pose the world
// through the debug surface, hold only what this requirement concerns, advance
// the clock by the frames the requirement needs, and assert one thing in one
// direction. Every figure it compares against comes from this project's own
// `constants.ts`.
