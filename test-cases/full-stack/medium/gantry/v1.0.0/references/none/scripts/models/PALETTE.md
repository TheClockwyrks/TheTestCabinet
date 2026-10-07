# Gantry — the one palette

Every model in the set draws ONLY from this list. No other hex appears anywhere.

## Machine (ring, trolley, hook, counterweight, mount)

| hex       | role                                                                             |
| --------- | -------------------------------------------------------------------------------- |
| `#e0a32e` | machine yellow — the primary painted body of every crane part                    |
| `#c07f1c` | yellow shadow — undersides, recessed painted faces                               |
| `#2b3138` | charcoal steel — frames, flanges, housings, the silhouette-defining banding      |
| `#4b545e` | mid steel — secondary structure, ribs                                            |
| `#8f9aa5` | bright steel — bearing faces, wheels, shafts, machined surfaces (used sparingly) |
| `#1b1f24` | near-black — hazard-stripe dark, bolt heads, deep recesses                       |

Design language: chunky forms, every feature >=2 voxels thick, charcoal banding at
every silhouette edge, bright steel reserved for what actually moves or bears.

## Loads — deliberately NOT yellow, so a load never reads as machine

| model     | body               | shadow                | metal                     |
| --------- | ------------------ | --------------------- | ------------------------- |
| crate     | `#a9793f` timber   | `#8a5f2e` dark timber | `#6e7783` strap steel     |
| container | `#2e6b7a` teal     | `#245663` teal shadow | `#8f9aa5` corner castings |
| drum      | `#b8452f` rust red | `#8f3423` rust shadow | `#8f9aa5` hoop/lid steel  |

The loads share the yard's neutral steels (`#8f9aa5`, `#6e7783`, `#1b1f24`) so they
belong to the same world, but no load carries machine yellow.
