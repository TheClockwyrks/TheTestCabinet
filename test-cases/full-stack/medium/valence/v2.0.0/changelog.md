## The build must expose a `window.__valence` API and a debug overlay

A new common spec, `specs/instrumentation.md`, seeded for every variant, requires
a deterministic, seedable, render-free core behind a small API on
`window.__valence`: `reset`, `step`, a JSON-serializable `snapshot` of the
screen, economy, paths, and every live unit, tower, projectile, and effect, and
control operations that arrange a scenario through the game's real systems
(`selectMap`, `setEnergy`, `setIntegrity`, `setRound`, `startRound`, `spawnUnit`
— which may release any type shielded — `placeTower`, `upgradeTower`,
`sellTower`, `setTargeting`, `setInertPriority`, `setSpeed`). A manual clock
(`autoStep`, toggled by `setAutoStep`) lets a scripted scenario advance the sim
exactly or hand the clock back to run live, and injected input (`keyDown`,
`keyUp`, `press`) drives the game through the same handling the real keyboard
feeds. A read-only overlay, toggled with the backtick key and off by default,
shows the live internal state. It is a new mandatory deliverable, hence the major
version bump.

## The economy is rebuilt to pay for damage rather than kills

Energy is now earned by damage dealt: every shell stripped pays `1`, and damage
past a unit's last shell pays nothing. A bonded cluster's pool pays its whole
value at once on break and nothing while it drains. A unit therefore pays out
exactly its total shells over its lifetime, including everything it fragments
into, whoever lands the final hit. The round-clear bonus (`100 + roundNumber`) is
now explicitly the bulk of the early economy, since the opening rounds field too
little matter to fund a board on damage alone.

## Difficulty comes from the round table, not from scaling

Per-round difficulty scaling is gone. Every matter type's shells, bond pool,
decay chain, speed, and leak value are fixed by the roster and never vary with
the round number, so a Dimer in Round 20 is identical to one in Round 38. The
campaign runs `40` rounds against an explicit round table that names exactly what
each round sends, making the progression legible and a build's behavior checkable
round by round.

## The matter roster gains the Lattice and makes inert a modifier

The Lattice is a new bonded cluster built the opposite way round to its weight —
a thin bond pool of `8` over sixteen full 6-electron atoms — so it opens almost
at once and then floods the strippers behind it. Inert is now a modifier any type
may carry rather than a property of three fixed types: Noble, Chelate, and Shroud
are simply the shielded Atom, Polymer, and Isotope, and the round table may call
for a shielded Dimer or Lattice the same way.

## The boss is a fission chain, and the only one in the campaign

Round `40` is a single Macromass and the whole of that round; no other round
folds one in. Its containment pool of `180` sits in front of a nucleus of `132`
shells, and breaking the pool leaves it the heavy isotope it already is rather
than reducing it to a last free atom. Six of its decay steps put a daughter
Isotope on the path — heavy in its own right and decaying into its own alpha and
beta particles — so a kinetic/nuclear line must be held against a cascade while
the strippers behind it clear the loose particles.

## The reviewer checklist is reorganized into categories with automated validation

The checklist now uses the categories grammar (`[review] format = 2`), with every
graded point a one-point item and most carrying a `validation` script that drives
the build through `window.__valence` and decides its own verdict. The objective,
mechanically verifiable behaviors — map topologies and distribution, free
placement and its refusals, targeting and priorities, bonds as chippable health,
hit points and damage types, the energy-immune decaying heavies, detection and
the Moderator slow, the two-branch upgrades, the economy and integrity, the
fragmenting boss, and the in-place-vs-menu pause — are each checked against a
deterministic core, with the run's media synthesized beside the reference
build's. The produced art, animation, particle bursts, audio, HUD readability,
and how each screen reads stay a human judgement.

## Other changes

- `specs/flow.md` is renamed `specs/campaign.md`, to fit what it covers.
- The specs are tightened throughout: history and prior-version framing removed,
  emphasis pared back, and edge-case call-outs turned into plain rules, so
  recognizing and handling them is the model's job.
- The prompt's mandatory verification pass is replaced by a note that Playwright
  and Chromium are available for driving and validating the build, leaving their
  use to the model's judgment.
- `specs/proof.md` notes that the debug API can set up the exact state each
  capture needs; the captures and their fixed paths are unchanged.
