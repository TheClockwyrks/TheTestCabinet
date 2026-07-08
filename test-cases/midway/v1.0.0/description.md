**Midway** is a top-down theme-park management simulation. You look down on a fenced
plot and grow it into a park: laying the paths guests walk, building and pricing the
rides they queue for and the stalls they buy from, hiring the staff who keep it all
running, and keeping the crowd happy.

Its defining tension is the **feedback loop between happiness and money**. Guests
arrive at a rate set by the park's rating; that rating is driven by how happy the
crowd is and how clean and appealing the park is; happiness comes from getting rides
and food they want, at fair prices, without long queues or litter underfoot — and all
of it costs money to build, staff, and maintain. Underneath sit several interacting
systems: a path-and-placement park grid, desire-driven guests who pathfind and spend,
a queue-and-ride simulation with capacity, throughput, and breakdowns, a
pricing-and-upkeep economy that can go bankrupt, and staff who clean, repair, and
entertain. Price too high or let the park slide and the loop runs in reverse — mood
falls, the rating drops, arrivals dry up, and the park spirals into the red.

Midway is a **full-stack case**: the model under test must **produce the game's own
assets during the run** — the guest and ride sprite sheets, the path/ride/stall/scenery
sprites, the fireworks and steam and sparkle particle effects, and the sound and a
carnival music bed — with the six asset-generation tools on the run image's `PATH`, and
then build the game around them. It is inspired by park-management sims like
*RollerCoaster Tycoon* but is entirely its own: an original name, look, and system set,
and its own scope.
