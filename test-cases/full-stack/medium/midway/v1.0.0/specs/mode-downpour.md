# Midway — Downpour

This file defines the park's start — the standard management start, played under
**changing weather**. It builds on the park grid in `specs/park.md`, the guests in
`specs/guests.md`, the rides and stalls in `specs/rides.md`, the economy in
`specs/economy.md`, the staff in `specs/staff.md`, the controls in `specs/controls.md`,
and the reputation flow in `specs/flow.md`.

## Menu entry

This spec adds the following entry to the main menu (see Game states in
`specs/flow.md`), before `HOW TO PLAY`:

- `DOWNPOUR`

(`HOW TO PLAY` is a state defined in `specs/flow.md`, not a start, and is always shown
last in the menu.)

## The start

- **Downpour** — the standard management start, played under **changing weather**. The
  park opens as a **fresh green plot** with the **entrance gate and a little plaza** of
  path already down (`specs/park.md`), a **modest opening cash balance** to build with (a
  starting loan, `specs/economy.md`), **no rides or stalls yet**, and **no staff**. From
  there you lay paths, place and price rides and stalls, hire the staff to keep them
  running and the park clean, and grow the rating (`specs/flow.md`) — building a park that
  turns a profit and staving off bankruptcy for as long as you can. Time still runs in
  days (`specs/flow.md`), but now **rain** rolls through periodically, and it presses the
  park in two ways:
  - **Rain empties the park.** During a downpour the **guest arrival rate drops** and
    guests already inside are unhappy in the open and **head for shelter or the exit**
    (`specs/guests.md`) — paths thin out and spending falls until the rain passes. Keep
    it simple: a park-wide weather state that lowers arrivals and mood while it rains,
    lifting again when it clears. (You may let guests shelter under a stall, a shelter
    scenery piece, or an indoor ride if you want to give the player a way to soften it —
    your choice; state it in the `README`.)
  - **Rain raises costs.** A storm **raises upkeep** while it lasts — drainage, and more
    frequent **ride breakdowns** as wet rides fail more often (`specs/rides.md`,
    `specs/staff.md`) — so a park that runs a thin margin in fair weather can tip into
    the red during a wet stretch (`specs/economy.md`).

Show the current **weather** (and, ideally, that rain is coming) in the HUD so the
player can react, and render the rain over the park so a downpour is unmistakable.

Otherwise the start uses every system exactly as the common specs define it, with no
overrides beyond the weather:

- the **park grid**, paths, and placement from `specs/park.md`;
- the **guest desire model** — choosing, queuing, spending, and happiness — from
  `specs/guests.md`;
- the **rides, stalls, queues, and breakdowns** from `specs/rides.md`;
- the **pricing, upkeep, wage, and bankruptcy economy** from `specs/economy.md`;
- the **staff** — janitors, mechanics, and entertainers — from `specs/staff.md`;
- the camera, tools, prices, and speed controls from `specs/controls.md`;
- and the reputation feedback loop, days, scoring, the loss state, the states, and the
  HUD from `specs/flow.md`.

The weather is the only addition — but that addition must be **real and felt**: a
Downpour where the weather never changes anything, and that plays identically to a
fair-weather park, has not implemented it.
