# Spectra's Engineless Replays Are Byte-Identical Between Captures

Two runs of `tcab capture-baselines spectra v2.0.0` over unchanged code write the
same bytes for every recorded replay under the `none` engine.

## Current behaviour

`README.md` states that captures of the same code differ inside seventeen stills
"and in nothing else", and that "all 111 replays are byte-identical from one
capture to the next". Two consecutive captures over unchanged code contradict
this. Comparing the two captures directly, rather than either against the
committed bytes, the `none` engine rewrote these replays:

| Replay | Target |
| --- | --- |
| `drones.flux-cycle-holds__hold` | `none/base` |
| `ship.fire-cadence__cadence` | `none/base` |
| `swarm.formation-holds-slot__holding` | `none/base` |

The set is not fixed. A capture compared against the committed baselines moved
`drones.flux-emerges-opposite__emerged` on `none/base` and
`field.sway-amplitude__swing` on `none/overload` while leaving
`swarm.formation-holds-slot__holding` alone, so which replays move varies per
run. Only the `none` engine is affected; the `simple-2d` and `structured-2d`
targets rewrote no replay in either capture.

The game itself is deterministic across the pair. In each moving replay the `ops`
array is identical, and only the recorder's `states` table and the per-frame
`state` index differ: a capture records one distinct canvas state where the other
records two, and every frame's index into that table shifts to match. One
observed pair differs in a recorded path transform, `712, 686` against
`490, 392`.

This makes the README's stability rule unusable as written. A reviewer told that
anything beyond the seventeen stills is a real change sees replay churn that
carries no change in what the build drew.

## Design

The page-injected 2D-context recorder under `none` derives its `states` entries
from a reading that settles differently between runs. Find that reading and take
it out of the state key, so the table a capture writes is a function of the `ops`
alone.

If a reading genuinely cannot be made stable, the README's stability section
names the replays that move alongside the stills it already names, and the count
of replays it calls byte-identical drops to match.

## Done when

- [ ] Two consecutive captures over unchanged code write identical bytes for every replay.
- [ ] The README's stability section matches what a capture actually rewrites.
- [ ] Gates green.
