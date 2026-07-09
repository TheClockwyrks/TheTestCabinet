# Junction — The economy: RCI demand, feedback loops, and the budget

This file defines what makes the city grow and what makes it pay: the **RCI demand**
that drives development, the **pollution and land-value** feedback loops that shape it,
and the **budget** of tax income against upkeep that a city must keep solvent or go
bankrupt. It builds on the map (`specs/map.md` — the zones and tiles it grows and the
fields it colors), the transit network (`specs/transit.md` — access and congestion cap
growth), and the utilities (`specs/utilities.md` — service gates development). The
bankruptcy loss state it defines is detailed alongside the other flow in
`specs/flow.md`.

## RCI demand

The city's growth is driven by three **demand** values — one each for **Residential**,
**Commercial**, and **Industrial** land (**R**, **C**, **I**) — that rise and fall with
the city's state and are
shown as live **RCI meters** in the HUD (`specs/flow.md`). Demand is the pressure that
makes zoned land develop (`specs/map.md`):

- **The demands feed each other.** They form a loop, not three independent dials.
  Model a sensible version of the classic relationship:
  - **Jobs create residential demand.** Available jobs in commercial and industrial
    buildings pull people to the city, so unmet jobs raise **R** demand.
  - **People create commercial and industrial demand.** Residents need shops (raising
    **C**) and industry needs a workforce and sells to commerce; commerce needs goods
    from industry (raising **I**). A growing population and commercial base raise **I**
    and **C** demand.
  - **Oversupply suppresses demand.** Far more zoned-and-developed capacity of a kind
    than the city can fill drives that demand **down** (and can tip it negative — a
    surplus that causes abandonment).
- **Demand drives development, capped by service.** Where demand for a kind is
  positive, zoned tiles of that kind develop and upgrade toward it (`specs/map.md`) — but
  **only as fast as the city can actually service and connect them**. Congested transit
  (long commutes, `specs/transit.md`), missing utilities (`specs/utilities.md`), and low
  land value (below) all **cap** how much of the standing demand actually turns into
  growth. Demand can be high while growth is stuck because the roads gridlock or the
  power runs out — and making the player resolve that is the game.
- Keep the exact curves your own (state your model in the `README`); what must be true
  is that the three demands **respond to the city** and **drive growth**, and that the
  player can read them and act on them.

## Pollution

Industry and heavy traffic dirty the land:

- **Sources.** Industrial buildings emit pollution in proportion to their density
  tier (`specs/map.md`); congested/heavy roads emit a lesser amount along the corridor
  (`specs/transit.md`).
- **Spread.** Pollution **spreads** to nearby tiles (falling off with distance) and
  **decays** over time, forming a field across the map. Run it on the simulation tick.
- **Effect.** Pollution **lowers the land value** (below) of the tiles it covers.
  Residential and commercial development shun polluted land — homes and shops near
  heavy industry stay low-tier or abandon — while industry itself is indifferent to it.
  This is why the player must think about **where** industry goes relative to homes.
- **Shown.** Pollution is drawn as a **produced particle haze** overlay
  (`specs/assets.md`) whose density is driven by the tile pollution field, and can be
  shown as a toggle overlay (`specs/controls.md`).

## Land value

Every buildable tile has a **land value** — a quality score that gates how high it can
develop (`specs/map.md`):

- **Raised by** proximity to **amenities** (water and parks, `specs/map.md`), good
  **transit access** with short commutes (`specs/transit.md`), and reliable services
  (`specs/utilities.md`).
- **Lowered by** **pollution** (above), **congestion** (`specs/transit.md`), and being
  on an unserved or unconnected fringe.
- **Effect.** High land value lets residential and commercial tiles climb to their high
  density tiers and pays more tax (below); low land value holds them at low tiers or
  pushes them to abandon. Land value can be shown as a toggle overlay
  (`specs/controls.md`).

Pollution → lower land value → suppressed development, and congestion → longer commutes
→ suppressed growth, are the **feedback loops** that make balancing the three zones
against the networks the actual game (`specs/flow.md`).

## The budget

The city runs on money, tracked as a **treasury** and settled every **budget period**
(a fixed span of simulation time — e.g. once per in-game month/year, tied to the clock
in `specs/flow.md`). This is the pressure that ends the game.

- **Income — taxes.** Developed tiles pay **tax** each period, scaling with their
  population/jobs and their land value (a high-tier tower in a valuable district pays far
  more than a low-density lot). Provide a **tax rate** the player can set (at least a
  single overall rate; per-zone rates are welcome, `specs/controls.md`): a higher rate
  raises income now but **suppresses demand** (people and business leave a
  heavily-taxed city), so there is a real trade-off, not a free dial.
- **Expenses — upkeep.** Every road, rail tile, station, wire, pipe, plant, and water
  source charges **ongoing upkeep** each period (`specs/transit.md`,
  `specs/utilities.md`), plus any city services you add. Capital costs (building a road,
  a plant, etc.) are one-time charges deducted when placed.
- **The balance.** Each period, income minus expenses adjusts the treasury. A city
  whose upkeep and services outrun its tax base **loses money every period** — which is
  easy to do by over-building networks ahead of the tax base, or by letting the city
  stop growing while its costs stay fixed.
- **Debt and bankruptcy.** The treasury **may go negative** — the city runs on credit
  down to a **debt limit** (your choice; state it in the `README`). A city that is still
  insolvent past that limit (out of credit and still losing money) goes **bankrupt** —
  the game's loss state (`specs/flow.md`). Recovering from the brink — cutting upkeep,
  raising the rate, growing the tax base — before it hits the limit is the tense part
  of the game.

Tune income, upkeep, and demand so a well-run city grows and stays comfortably solvent,
a careless or over-eager one slides toward bankruptcy, and a neglected one can be pulled
back from the edge. The `roughterrain` start (`specs/modes/`) tightens the money by
making transit and utilities cost more to lay.

## The HUD reads the money and demand

The HUD (`specs/flow.md`) shows the **treasury** and the **per-period balance** (income
vs. expenses, with the sign clear), the **population**, and the **RCI demand meters**,
and raises an **alert** when the city is losing money or approaching its debt limit — so
the player can see insolvency coming and act before it lands.
