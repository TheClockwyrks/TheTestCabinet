# Orrery — The Extras challenges

This file gives every challenge of the Extras: `EXTRA_COUNT` (`10`)
challenges, numbered `1` through `10` in the order they are listed on the
Extras select screen. It is authoritative for all of them. Build every
challenge exactly as written here, in the challenge format `specs/formats.md`
defines, with nothing substituted, renamed, or reworked. The mode itself is
defined in `specs/modes/extras.md`.

Every challenge's `target` is `CONSTELLATION_TARGET` (`6`).

## 1. First Light

One mote, carried across the sky.

```json
{
  "name": "First Light",
  "reagents": [{ "motes": [{ "q": 0, "r": 0, "type": "sol" }], "filaments": [] }],
  "products": [{ "motes": [{ "q": 0, "r": 0, "type": "sol" }], "filaments": [] }],
  "permitted": ["arm"],
  "target": 6
}
```

## 2. Twin Moons

Two motes, joined.

```json
{
  "name": "Twin Moons",
  "reagents": [{ "motes": [{ "q": 0, "r": 0, "type": "luna" }], "filaments": [] }],
  "products": [
    {
      "motes": [
        { "q": 0, "r": 0, "type": "luna" },
        { "q": 1, "r": 0, "type": "luna" }
      ],
      "filaments": [{ "a": [0, 0], "b": [1, 0], "weight": 1 }]
    }
  ],
  "permitted": ["arm", "bind"],
  "target": 6
}
```

## 3. Waning Crescent

An essence, dimmed to dust.

```json
{
  "name": "Waning Crescent",
  "reagents": [{ "motes": [{ "q": 0, "r": 0, "type": "comet" }], "filaments": [] }],
  "products": [
    {
      "motes": [
        { "q": 0, "r": 0, "type": "dust" },
        { "q": 1, "r": 0, "type": "dust" }
      ],
      "filaments": [{ "a": [0, 0], "b": [1, 0], "weight": 1 }]
    }
  ],
  "permitted": ["arm", "wane", "bind"],
  "target": 6
}
```

## 4. Mirrorwright

Dust, written on by the wheel.

```json
{
  "name": "Mirrorwright",
  "reagents": [{ "motes": [{ "q": 0, "r": 0, "type": "dust" }], "filaments": [] }],
  "products": [
    {
      "motes": [
        { "q": 0, "r": 0, "type": "nova" },
        { "q": 1, "r": 0, "type": "comet" }
      ],
      "filaments": [{ "a": [0, 0], "b": [1, 0], "weight": 1 }]
    }
  ],
  "permitted": ["arm", "wheel", "mirror", "bind"],
  "target": 6
}
```

## 5. Ascendant

Mercury spent to raise Saturn.

```json
{
  "name": "Ascendant",
  "reagents": [
    { "motes": [{ "q": 0, "r": 0, "type": "mercury" }], "filaments": [] },
    { "motes": [{ "q": 0, "r": 0, "type": "saturn" }], "filaments": [] }
  ],
  "products": [{ "motes": [{ "q": 0, "r": 0, "type": "jupiter" }], "filaments": [] }],
  "permitted": ["arm", "ascend"],
  "target": 6
}
```

## 6. Great Conjunction

Two planets, made one.

```json
{
  "name": "Great Conjunction",
  "reagents": [{ "motes": [{ "q": 0, "r": 0, "type": "venus" }], "filaments": [] }],
  "products": [{ "motes": [{ "q": 0, "r": 0, "type": "luna" }], "filaments": [] }],
  "permitted": ["arm", "conjoin"],
  "target": 6
}
```

## 7. Syzygy

Shadow and light, drawn from dust.

```json
{
  "name": "Syzygy",
  "reagents": [{ "motes": [{ "q": 0, "r": 0, "type": "dust" }], "filaments": [] }],
  "products": [
    {
      "motes": [
        { "q": 0, "r": 0, "type": "umbra" },
        { "q": 1, "r": 0, "type": "lumen" }
      ],
      "filaments": [{ "a": [0, 0], "b": [1, 0], "weight": 1 }]
    }
  ],
  "permitted": ["arm", "eclipse", "bind"],
  "target": 6
}
```

## 8. Aetherfall

All four essences, brought together.

```json
{
  "name": "Aetherfall",
  "reagents": [
    { "motes": [{ "q": 0, "r": 0, "type": "nebula" }], "filaments": [] },
    { "motes": [{ "q": 0, "r": 0, "type": "comet" }], "filaments": [] },
    { "motes": [{ "q": 0, "r": 0, "type": "nova" }], "filaments": [] },
    { "motes": [{ "q": 0, "r": 0, "type": "meteor" }], "filaments": [] }
  ],
  "products": [{ "motes": [{ "q": 0, "r": 0, "type": "aether" }], "filaments": [] }],
  "permitted": ["arm", "biarm", "confluence"],
  "target": 6
}
```

## 9. Trine

Fire bound threefold.

```json
{
  "name": "Trine",
  "reagents": [{ "motes": [{ "q": 0, "r": 0, "type": "nova" }], "filaments": [] }],
  "products": [
    {
      "motes": [
        { "q": 0, "r": 0, "type": "nova" },
        { "q": 1, "r": 0, "type": "nova" }
      ],
      "filaments": [{ "a": [0, 0], "b": [1, 0], "weight": 3 }]
    }
  ],
  "permitted": ["arm", "triune"],
  "target": 6
}
```

## 10. Procession

An unbroken chain of moons.

```json
{
  "name": "Procession",
  "reagents": [{ "motes": [{ "q": 0, "r": 0, "type": "luna" }], "filaments": [] }],
  "products": [
    {
      "motes": [{ "q": 0, "r": 0, "type": "luna" }],
      "filaments": [],
      "repeat": { "vector": [1, 0], "link": { "a": [0, 0], "b": [1, 0], "weight": 1 } }
    }
  ],
  "permitted": ["arm", "piston", "track", "bind"],
  "target": 6
}
```
