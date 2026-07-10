# Midway — Downpour

This file defines the **Downpour** start, which sits alongside the standard park
start. It builds on the standard start in `specs/modes/classic.md` and adds **one
lightweight system — weather** — on top of it; everything else is unchanged.

## Menu entry

This mode spec adds the following entry to the main menu (see Game states in
`specs/flow.md`):

- `DOWNPOUR`

Place it after `NEW PARK` and before `HOW TO PLAY`.

## The start

- **Downpour** — the same park, plot, economy, and systems as the standard start, but
  played under **changing weather**. Time still runs in days (`specs/flow.md`), but now
  **rain** rolls through periodically, and it presses the park in two ways:
  - **Rain empties the park.** During a downpour the **guest arrival rate drops** and
    guests already inside are unhappy in the open and **head for shelter or the exit**
    (`specs/guests.md`) — paths thin out and spending falls until the rain passes. Keep
    it simple: a park-wide weather state that lowers arrivals and mood while it rains,
    lifting again when it clears. (You may let guests shelter under a stall, a shelter
    scenery piece, or an indoor ride if you want the player a way to soften it — your
    choice; state it in the `README`.)
  - **Rain raises costs.** A storm **raises upkeep** while it lasts — drainage, and
    more frequent **ride breakdowns** as wet rides fail more often (`specs/rides.md`,
    `specs/staff.md`) — so a park that runs a thin margin in fair weather can tip into
    the red during a wet stretch (`specs/economy.md`).

Show the current **weather** (and, ideally, that rain is coming) in the HUD so the
player can react, and render the rain over the park so a downpour is unmistakable.

Everything else is exactly as the standard start (`specs/modes/classic.md`): the park
grid and paths, the guest desire model, the rides/stalls/queues/breakdowns, the
pricing/upkeep/wage/bankruptcy economy, the staff, the controls, and the reputation
loop, days, scoring, loss state, states, and HUD. Only the **weather** is added — but
that addition must be **real and felt**: a Downpour where the weather never changes
anything, and that plays identically to the standard start, has not implemented it.
