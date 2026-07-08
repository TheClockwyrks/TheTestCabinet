# Midway — Rides, stalls, and queues

This file defines the attractions the park is built from: the rides guests queue
for and the stalls they buy from, the queues themselves, ride throughput, and the
breakdowns that need a mechanic. It builds on the park grid in `specs/park.md`
(placement and paths), is driven by the guests in `specs/guests.md` (who queue,
ride, and buy), is priced by `specs/economy.md`, and is maintained by the staff in
`specs/staff.md`.

## Rides

A **ride** is a multi-tile attraction guests queue for, ride, and leave more
thrilled. At least these three exist, and they must feel different; you may add more
(state additions in the `README`):

- **Carousel** — a gentle, low-thrill ride with good capacity: a broad, steady
  earner that pleases families and rarely breaks.
- **Coaster** — a high-thrill ride: a big draw that satisfies a lot of thrill per
  ride but has lower capacity and breaks down more often.
- **Drop tower** — a high-thrill ride of a different shape: strong thrill, modest
  capacity.

Each ride has these properties, which you tune:

- **Footprint and entrance.** A rectangular footprint on grass with one **entrance /
  queue tile** adjacent to a path (`specs/park.md`); guests board there.
- **Capacity** — how many guests it carries per run.
- **Ride duration** — how long a run takes (on the simulation tick,
  `specs/controls.md`).
- **Throughput** — the guests-per-minute it can clear, which follows from capacity
  and duration; a low-throughput ride with a big draw grows a long queue.
- **Thrill** — how much thrill (and happiness) a rider gains (`specs/guests.md`);
  higher-thrill rides draw guests harder and, generally, break down more.
- **Ticket price** — the per-ride price the player sets (`specs/economy.md`,
  `specs/controls.md`); guests judge it against the ride's value (`specs/guests.md`).
- **Upkeep** — a running cost the ride draws while it stands (`specs/economy.md`).

## Queues and riding

Riding is a cycle driven on the fixed simulation tick (`specs/controls.md`):

- **Queue.** Guests who choose a ride (`specs/guests.md`) join its **queue** at the
  entrance and wait in line. The queue has a visible length; a long line deters new
  guests from joining and sours those already waiting, who may give up and leave the
  line. Show the queue (a line of waiting guests, or a clear count).
- **Loading and running.** When the ride is free, it **loads up to its capacity** from
  the front of the queue, each rider **pays the ticket** (`specs/economy.md`), and it
  **runs for its ride duration** (playing its produced animation and effect,
  `specs/assets.md`). While running it takes no new riders.
- **Unloading.** On finishing, riders **leave satisfied** — thrill and happiness up,
  more for a higher-thrill ride, less if they waited too long — and rejoin the crowd
  to act on their next desire. The ride then loads the next batch.
- **Throughput matters.** If guests join faster than the ride clears them, the queue
  grows without bound and happiness there collapses — the player's answer is to raise
  capacity/variety (more rides), price to shed demand, or accept the loss. This
  balance is core play.

## Breakdowns

Rides are not perfectly reliable, and keeping them running is a job for the mechanic
(`specs/staff.md`):

- **Breaking down.** Each ride has a **breakdown chance** that accrues as it runs,
  higher for more intense rides and for rides a mechanic has not inspected recently
  (`specs/staff.md`). When a ride breaks down it **stops**: it takes no riders, its
  current queue drains away in frustration (waiting guests lose happiness and leave the
  line), and it is flagged **broken** on the map and in the HUD alerts (`specs/flow.md`).
- **Repair.** A broken ride needs a **mechanic** to pathfind to it and **repair** it
  over a short time (`specs/staff.md`); only then does it run again. A park with no
  mechanic (or too few for its rides) leaves rides broken and bleeds happiness and
  income — the link that makes staffing matter.
- **Prevention.** A mechanic on patrol **inspects** rides, lowering their breakdown
  chance; well-maintained rides break less. Keep the model simple but real: neglecting
  maintenance visibly raises breakdowns.

## Stalls

A **stall** is a small shop on a path that sells to guests to meet a desire. At least
these four kinds exist; you may add more (state additions in the `README`):

- **Food stall** — satisfies **hunger** (`specs/guests.md`). Running food stalls emit
  a **steam** effect (`specs/assets.md`).
- **Drink stall** — satisfies **thirst** (and raises bladder later).
- **Souvenir stall** — sells a want, not a need: a guest in a good mood buys a
  souvenir for happiness, so souvenir sales track how well the park is doing.
- **Restroom** — relieves **bladder**. It may be free or charge a small fee (your
  choice; state it in the `README`); a park without enough restrooms sees bladders
  burst and mood crash.

Each stall has a footprint with an entrance on a path (`specs/park.md`), a **price**
the player sets (except a free restroom), a small **upkeep**, and produces **income**
per sale (`specs/economy.md`). Guests judge a stall's price against its value exactly
as they judge a ride (`specs/guests.md`). Selling generates **litter** near the stall
that a janitor must clear (`specs/staff.md`).

## Placement and building

Rides, stalls, and scenery are **placed and paid for** through `specs/economy.md`, on
legal grass tiles with an entrance on a path, per `specs/park.md`; the player places
them with the build tool (`specs/controls.md`). A ride or stall whose entrance no path
reaches takes **no guests** until a path connects it — so growing the park means
growing its paths alongside its attractions.
