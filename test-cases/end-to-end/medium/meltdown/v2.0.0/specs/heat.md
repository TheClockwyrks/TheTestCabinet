# Meltdown — Heat

Heat is what an emitter's power is made of. This file defines the heat scale, the
order a frame resolves every flow in, what heats a tower and what cools it, the
curve that turns heat into damage, and the trip. `specs/towers.md` gives the
per-tower figures every rule here is applied to.

## The heat scale

Every emitter carries a heat `H`, a number from `0` to `TRIP_HEAT` (`100`), and
heat is clamped to that range at the end of every frame. The Forge and the Sink
carry no heat of their own and report `0` for it forever.

Each emitter has a thermal mass `mass` that divides every change to its heat, so
mass changes how fast a tower answers a flow and never where it settles.

## Faces, edge-tiles, and neighbours

A footprint has four faces, N, E, S, and W, and a face is one edge-tile long per
tile of the footprint's side, so a 2x2 face is two edge-tiles and a 4x4 face is
four. Each perimeter edge-tile is classified by what lies immediately outside it:

| Outside the edge-tile | What that edge-tile does |
| --- | --- |
| Open floor, an opening, or the casing | It sheds heat to air. |
| Another emitter | It conducts with that emitter. |
| A Forge or a Sink | It exchanges with that mover. |

An edge-tile facing another tower sheds nothing to air. `sharedEdges(T, U)` is
the number of edge-tiles along which towers `T` and `U` abut; two towers touching
only at a corner share none. `radiatorEdges(T)` and `plainEdges(T)` count the
edge-tiles facing air on `T`'s radiator faces and on its other faces
respectively.

## A frame resolves in two phases

For each frame of duration `dt`, with `H_T` the heat each emitter `T` carried
when the frame opened:

```
airLoss(T)   = (RAD_K * radiatorEdges(T) + BASE_K * plainEdges(T)) * (H_T / 100)
conduct(T)   = sum over emitter neighbours N of COND_K * sharedEdges(T, N) * (H_N - H_T)
forgeGain(T) = sum over touching Forges F of FORGE_K * sharedEdges(T, F) * max(0, setpoint(F) - H_T)
sinkLoss(T)  = sum over touching Sinks S of output(S) * sharedEdges(T, S) * (H_T / 100)
shotGain(T)  = shotsFired(T, dt) * heatPerShot(T)

dH_T = (shotGain(T) + (conduct(T) + forgeGain(T) - airLoss(T) - sinkLoss(T)) * dt) / mass(T)
```

Every term is computed from the heats the frame opened with. Only when every
`dH_T` is known are the new heats written, each clamped to `[0, 100]`.

`shotsFired(T, dt)` is the number of shots `T` resolved during this frame, which
`specs/combat.md` fixes, and `heatPerShot(T)` is its per-shot heat at its current
level.

## The four flows

| Constant | Value | What it governs |
| --- | --- | --- |
| `RAD_K` | `3.6` | Air cooling per radiator edge-tile per second, at heat `100`. |
| `BASE_K` | `1.1` | Air cooling per plain edge-tile per second, at heat `100`. |
| `COND_K` | `3.5` | Conduction across one shared edge-tile, per degree of difference, per second. |
| `FORGE_K` | `0.9` | The Forge's flow per shared edge-tile, per degree below its setpoint, per second. |

Air cooling and the Sink's drain are both proportional to `H / 100`, so a tower
sheds most near the trip and almost nothing when cold. A tower boxed in on all
four faces sheds nothing to air at all.

Conduction runs from the hotter emitter to the cooler and is the same flow in
both directions, so what one loses the other gains before either is divided by
its own mass. Two emitters at the same heat exchange nothing, and two emitters
separated by a gap or touching only at a corner exchange nothing.

The Forge warms each emitter it touches toward its setpoint and never past it, so
an emitter already at or above the setpoint gains nothing from it. The Sink
drains each emitter it touches through a face that would otherwise shed nothing,
which is the only way a boxed-in tower loses heat. Both stack: two Forges or two
Sinks on one emitter add both flows.

Movers carry no heat, so they neither conduct with an emitter nor equalise with
each other; they only drive the flows above into and out of the emitters they
touch.

## Heat is damage

An emitter's per-shot damage is its base damage scaled by a heat multiplier that
climbs on a quadratic curve to the tower's redline `R` and then holds flat from
`R` up to `100`:

```
heatMultiplier(H, R) = MIN_HEAT_MULT + (MAX_HEAT_MULT - MIN_HEAT_MULT) * (min(H, R) / R)^2
                     = 0.35 + 3.15 * (min(H, R) / R)^2
```

At heat `0` the multiplier is `MIN_HEAT_MULT` (`0.35`); at heat `R` and anywhere
above it the multiplier is `MAX_HEAT_MULT` (`3.5`); at half the redline it is
`0.35 + 3.15 * 0.25`, which is `1.1375`. Heat carried past the redline buys no
damage.

The redline `R` is per-tower, is given in `specs/towers.md`, and an upgrade does
not change it. The band from `R` to `100` is the plateau: full power, still
online.

## The trip

The trip is a crossing, not a value. An emitter trips on the frame in which its
newly written heat reaches `100` having opened that frame below `100`. An emitter
whose heat is already `100` when a frame opens and falls during that frame does
not trip.

A tripped emitter:

- fires nothing and acquires no target for the whole of its cooldown;
- takes part in no term of the frame's resolution, so nothing it touches heats
  it, cools it, or conducts with it;
- bleeds its heat to `0` at `TRIP_HEAT / TRIP_TIME`, which is `20` per second,
  whatever its faces and whatever stands beside it;
- carries a cooldown of `TRIP_TIME` (`5.0`) seconds, counting down against the
  game time each frame advances by.

When the cooldown reaches `0` the emitter is online again, at heat `0`.

The trip is an emitter's only failure. A tower is never destroyed, never damaged
by the surge, and never runs out of ammunition.
