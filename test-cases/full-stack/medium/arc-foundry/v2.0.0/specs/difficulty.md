# Arc Foundry — Difficulty

A run is played at one of three difficulties, chosen before it begins. A difficulty sets
the number of waves and the constants of the per-wave health scaling in
`specs/enemies.md`, and nothing else.

Every other value is identical at every difficulty: the starting Charge, the starting
Grid Integrity, the stamp allowance, the refinement track and its costs, the Load roster's
base figures, the bounties, the leak values, the wave-clear bonus, the component stats,
and the recipes.

## The three difficulties

`DIFFICULTIES` holds the three.

| Difficulty | Identifier | Waves `N` | `baseMult` | `k`    | `c`    | `r`     | Milestone waves |
| ---------- | ---------- | --------- | ---------- | ------ | ------ | ------- | --------------- |
| Easy       | `easy`     | `40`      | `0.20`     | `0.50` | `0.08` | `1.09`  | `20`, `40`      |
| Medium     | `medium`   | `50`      | `0.22`     | `1.17` | `0.28` | `1.145` | `25`, `50`      |
| Hard       | `hard`     | `60`      | `0.24`     | `1.30` | `0.22` | `1.15`  | `30`, `60`      |

A unit's maximum health on wave `w` is

```
HP(w) = round( baseHP * baseMult * [ (1 + k * (w - 1)) + c * (r^(w - 1) - 1) ] )
```

rounded to the nearest integer with an exact half rounding up, using the four constants
of the chosen difficulty. Milestone waves are `round(N / 2)` and `N`, and each carries one
Dynamo.

## What each difficulty is

| Difficulty | Shape of the run                                                                                                                 |
| ---------- | -------------------------------------------------------------------------------------------------------------------------------- |
| Easy       | The shortest run, with the lowest base health, the gentlest linear ramp, and the smallest late surcharge.                        |
| Medium     | The reference balance: a gentle opening and a steep late surcharge.                                                              |
| Hard       | The longest run, with the highest base health and the steepest late surcharge, so its final waves climb far past a Medium run's. |

The difficulty select screen shows each difficulty's wave count and how tough its Load
grows before it is chosen.
