Coil is a neon grid serpent. The snake never stops: it traces one unbroken line
across a bordered board, and every pellet it swallows adds a cell to its tail.
Exactly one pellet is on the board at a time, and the board only ever gets
tighter.

Maze plays it on a board laced with a fixed course of obstacles: four solid bars
across the interior, two long ones running the width of the upper and lower
board, two short ones standing on their ends. They are in the same place every
round, they are as fatal as the wall, and no pellet ever spawns on one. Only the
row the snake starts on is left clear, so the opening runway is the last easy
stretch of the round.

What makes this a scoring game rather than a survival one is the combo. Every
pellet opens a window of three and a half seconds. Eat the next one before that
window closes and the multiplier climbs a step, to a cap of five, and the window
reopens full; let it run out and the multiplier drops straight back to one. A
pellet is worth ten points times whatever the multiplier is when it goes down.

The snake covers one cell per tick and the game ticks eight times a second, so a
full window is twenty-eight cells of travel and no more. That is what the course
costs: a bar between the head and the pellet is not an obstacle to be avoided so
much as a detour to be paid for, and the cells it adds come straight out of the
multiplier. Threading the gap is worth more than going round it, and the gap
narrows every time the tail grows.

The clip is the reference implementation played from the title screen: half a
minute of one real round, fourteen pellets taken through the course, the
multiplier walked up to `x5` and held there across nine of them, then a window
lost on a route that had to go the long way, and rebuilt.
