# Midway — The park

This file defines the park's start — the standard management start. It builds on the
park grid in `specs/park.md`, the guests in `specs/guests.md`, the rides and stalls in
`specs/rides.md`, the economy in `specs/economy.md`, the staff in `specs/staff.md`,
the controls in `specs/controls.md`, and the reputation flow in `specs/flow.md`.

## Menu entry

This spec adds the following entry to the main menu (see Game states in
`specs/flow.md`), before `HOW TO PLAY`:

- `NEW PARK`

(`HOW TO PLAY` is a state defined in `specs/flow.md`, not a start, and is always shown
last in the menu.)

## The start

- **New park** — the standard management start. The park opens as a **fresh green
  plot** with the **entrance gate and a little plaza** of path already down
  (`specs/park.md`), a **modest opening cash balance** to build with (a starting loan,
  `specs/economy.md`), **no rides or stalls yet**, and **no staff**. From there you lay
  paths, place and price rides and stalls, hire the staff to keep them running and the
  park clean, and grow the rating (`specs/flow.md`) — building a park that turns a
  profit and staving off bankruptcy for as long as you can.

The start uses every system exactly as the common specs define it, with no overrides:

- the **park grid**, paths, and placement from `specs/park.md`;
- the **guest desire model** — choosing, queuing, spending, and happiness — from
  `specs/guests.md`;
- the **rides, stalls, queues, and breakdowns** from `specs/rides.md`;
- the **pricing, upkeep, wage, and bankruptcy economy** from `specs/economy.md`;
- the **staff** — janitors, mechanics, and entertainers — from `specs/staff.md`;
- the camera, tools, prices, and speed controls from `specs/controls.md`;
- and the reputation feedback loop, days, scoring, the loss state, the states, and the
  HUD from `specs/flow.md`.
