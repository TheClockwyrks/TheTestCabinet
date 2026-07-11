# Midway — The staff: janitors, mechanics, and entertainers

This file defines the workers the player hires to keep the park running: janitors
who clear litter, mechanics who keep rides working, and entertainers who lift the
crowd's mood. It builds on the park grid in `specs/park.md` (staff walk the paths),
the rides in `specs/rides.md` (breakdowns and maintenance), the guests in
`specs/guests.md` (litter and happiness), and the economy in `specs/economy.md`
(wages). Staff are the park's upkeep made flesh: without enough of them, it degrades
— litter piles up, rides stay broken, and the crowd sours.

## Hiring and paying

- The player **hires** staff of the kinds below through the staff tool
  (`specs/controls.md`), placing each into the park; each hired worker is paid a
  **wage** each period (`specs/economy.md`), so a bigger staff is a bigger fixed cost.
- Each staff member is drawn from **produced sprites** (`specs/assets.md`) and is
  visible walking the park at work, distinct from a guest.
- Staff **pathfind on the path network** exactly as guests do (`specs/guests.md`);
  they cannot reach an area no path connects, so keeping the park pathed matters for
  staffing as well as for guests.

## Assignment

Keep staff direction **simple but real**: the player must be able to influence where a
worker goes and see it respond. Provide at least one of —

- **Zones / patrol areas.** Assign a worker to a region of the park (a drawn zone, or
  "this section"), and it works within it.
- **Whole-park roaming.** A worker with no assignment roams the connected paths doing
  its job wherever it is needed.

Either is fine (state your model in the `README`), but a player who hires a second
janitor for a filthy far corner must be able to send it there and watch the litter
there fall.

## The three staff kinds

At least these three exist; you may add more (state additions in the `README`):

- **Janitor.** Guests drop **litter** on the paths as they walk and eat (more near
  food and drink stalls, `specs/rides.md`). Litter accumulates on path tiles, **lowers
  their appeal**, and **sours guests** who walk over it (`specs/guests.md`). A janitor
  patrols and **clears litter** (and empties bins, if you add them), throwing a small
  **cleanup puff** (`specs/assets.md`) and restoring the path. Too few janitors for the
  crowd means litter piles up and mood slides.
- **Mechanic.** Rides break down (`specs/rides.md`). A mechanic **inspects** rides on
  patrol — lowering their breakdown chance — and **repairs** a broken ride by
  pathfinding to it and working on it for a short time, after which it runs again. Too
  few mechanics for the number (and intensity) of rides leaves rides broken, their
  queues collapsing and income lost.
- **Entertainer.** An entertainer roams the paths and **raises the happiness** of
  guests near it (`specs/guests.md`) — a mascot working the crowd. Entertainers are a
  direct, ongoing mood boost the player can spend wages on when the crowd is flagging.

## Unstaffed decay

Staffing is a cost the player is tempted to cut, and cutting it must **visibly
degrade** the park: with too few janitors, litter builds and the paths turn grimy and
guests sour; with too few mechanics, rides sit broken and their queues empty; with no
entertainers, a marginal crowd's mood is that much harder to hold up. The player is
always trading wages against the happiness (and so the rating and arrivals,
`specs/flow.md`) that staff protect — over-hire and wages sink the budget, under-hire
and the park rots. That trade-off is the point of the system.
