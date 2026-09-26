**Midway** is a top-down theme-park management simulation. You look down on a
fenced plot and grow it into a park: laying the paths guests walk, building and
pricing the rides they queue for and the stalls they buy from, hiring the staff
who keep it all running, and keeping the crowd happy.

Its defining tension is the feedback loop between happiness and money. Guests
arrive at a rate set by the park's rating, and that rating is driven by how
happy the crowd is and how clean and appealing the park is. Happiness comes from
getting the rides and food they want, at fair prices, without long queues or
litter underfoot, and all of it costs money to build, staff, and maintain. Price
too high or let the park slide and the loop runs in reverse: mood falls, the
rating drops, arrivals dry up, and the park spirals into the red. Underneath sit
several interacting systems: a path-and-placement park grid, desire-driven
guests who pathfind and spend, a queue-and-ride simulation with capacity,
throughput, and breakdowns, a pricing-and-upkeep economy that can go bankrupt,
and staff who clean, repair, and entertain.

Midway is a full-stack case. The model under test produces the game's own assets
during the run with the six asset-generation tools on the run image's `PATH`:
the guest and ride sprite sheets, the path/ride/stall/scenery sprites, the
fireworks and steam and sparkle particle effects, and the sound and a carnival
music bed. It then builds the game around them. The case is inspired by
park-management sims, notably _RollerCoaster Tycoon_; its name, look, system
set, and scope are original.
