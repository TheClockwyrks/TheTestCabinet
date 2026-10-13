---
title: Overview
---

`engines` is the library [repository](/development/repositories/) holding
every runtime a produced work is built on or played back through: the
authored engines a game is written against, the runtimes that pose and render
a produced asset, and the simulation hosts the adversarial and performance
test types play a produced controller in. It depends on
[`contracts`](/components/contracts/overview/) alone, and the superrepo checks
it out at `engines/`.

| Part                                                                                 | Holds                                                                                                            |
| ------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------- |
| `crates/engines` (`test-cabinet-engines`)                                            | The authored engines' manifests, embedded at build time, and `built_in_catalog`                                  |
| `packages/simple-2d`, `simple-3d`, `structured-2d`, `structured-3d`                  | The [authored engines](/engines/overview/)' runtimes; each manifest is at `engines/<slug>/`                      |
| `packages/case-harness` (`@clockwyrks/case-harness`)                                 | The shared harness a case's engineless validators are written over                                               |
| `packages/voxel-runtime`, `packages/particle-runtime`                                | The [voxel](/components/voxel-runtime/overview/) and [particle](/components/particle-runtime/overview/) runtimes |
| `crates/foray-core`, `crates/foray-host`, the `foray-ref-*` crates and the SDK       | The [adversarial](/testing/adversarial/foray/architecture/) simulation, its wasm host and baselines              |
| `crates/lattice-core`, `crates/lattice-host`, the `lattice-ref-*` crates and the SDK | The [performance](/testing/performance/lattice/architecture/) simulation, its wasm host and baselines            |
| `match_play`                                                                         | The match runner over the two hosts                                                                              |

## The authored engines

An authored engine is two things in this repository: its manifest directory
`engines/<slug>/`, holding `engine.toml`, and its runtime, the npm workspace
package `packages/<slug>/` the manifest names. The data crate
`crates/engines` embeds every manifest at build time as a table keyed by slug,
in `BUILT_IN_SLUGS` order, and publishes `built_in_catalog`, the
[suites crate](/components/contracts/overview/#the-suites-crate)'s engine
catalog bound to that table. A caller that resolves an engine selection, the
driver when it seeds a run, the backend when it ingests a case, the arena and
The Spec Cabinet, takes the catalog from here, so every host resolves
the same closed set with no checkout.

The contract an engine implements, covering how one is declared, versioned,
delivered into a run, documented to the model and held by a case's validators,
is [Engines](/components/engines/engines/). Each engine's own pages under
[Engines](/engines/overview/) are the catalogue.

`@clockwyrks/case-harness` is the shared validator harness of every case that
drives its build in a browser. It is TypeScript source vitest transpiles, which
the driver stages beside a case's validator project at validation time; a case
never declares it as a package and nothing seeds it into a run.

## The runtimes

The voxel and particle runtimes pose, simulate and render the assets an
[asset-generation](/testing/asset-generation/overview/) run produces. Both are
pure-core packages over three, built on the asset contract's shapes, and both
are vendored into a model's workspace by a full-stack case, which is why they
take `@clockwyrks/asset-contract` from `contracts` and nothing else of the
project. The `ui-common` library and both sites mount them to play a produced
asset back.

## Foray, lattice and the match runner

`foray-core` and `lattice-core` are the authoritative simulations of the
[adversarial](/testing/adversarial/overview/) and
[performance](/testing/performance/overview/) test types: the rules, the state,
the scoring and the replay format. `foray-host` and `lattice-host` are the
`wasmtime` hosts that load a controller, drive the per-tick loop and enforce
the fuel and memory limits. The reference controllers are the baselines a
produced controller is pitted against, and each test type's SDK is the Rust
crate a controller depends on.

`match_play` is the runner over the hosts: it resolves two controllers, runs a
match to its result and returns the replay, and runs every pair of a field as a
tournament. The [arena](/components/arena/overview/) runs it for the console's
matches and tournaments, and the driver's adversarial and performance
validators run it over a produced controller at validation time. Every caller
plays a match through this one runner, so a replay the gallery renders was
decided by the simulation that scored it.
