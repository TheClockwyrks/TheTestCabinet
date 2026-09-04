# Orrery — The Extras challenges

This file gives every challenge of the Extras, in order. It is authoritative
for all of them. Build every challenge exactly as written here, in the
challenge format `specs/formats.md` defines. The shelf itself is defined in
`specs/modes/extras.md`.

## 1. First Light

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
      "filaments": [{ "a": { "q": 0, "r": 0 }, "b": { "q": 1, "r": 0 }, "weight": 1 }]
    }
  ],
  "permitted": ["arm", "bind"],
  "target": 6
}
```

## 3. Waning Crescent

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
      "filaments": [{ "a": { "q": 0, "r": 0 }, "b": { "q": 1, "r": 0 }, "weight": 1 }]
    }
  ],
  "permitted": ["arm", "wane", "bind"],
  "target": 6
}
```

## 4. Mirrorwright

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
      "filaments": [{ "a": { "q": 0, "r": 0 }, "b": { "q": 1, "r": 0 }, "weight": 1 }]
    }
  ],
  "permitted": ["arm", "wheel", "mirror", "bind"],
  "target": 6
}
```

## 5. Ascendant

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
      "filaments": [{ "a": { "q": 0, "r": 0 }, "b": { "q": 1, "r": 0 }, "weight": 1 }]
    }
  ],
  "permitted": ["arm", "eclipse", "bind"],
  "target": 6
}
```

## 8. Aetherfall

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
      "filaments": [{ "a": { "q": 0, "r": 0 }, "b": { "q": 1, "r": 0 }, "weight": 3 }]
    }
  ],
  "permitted": ["arm", "triune"],
  "target": 6
}
```

## 10. Procession

```json
{
  "name": "Procession",
  "reagents": [{ "motes": [{ "q": 0, "r": 0, "type": "luna" }], "filaments": [] }],
  "products": [
    {
      "motes": [{ "q": 0, "r": 0, "type": "luna" }],
      "filaments": [],
      "repeat": {
        "vector": { "q": 1, "r": 0 },
        "link": { "a": { "q": 0, "r": 0 }, "b": { "q": 1, "r": 0 }, "weight": 1 }
      }
    }
  ],
  "permitted": ["arm", "piston", "track", "bind"],
  "target": 6
}
```
