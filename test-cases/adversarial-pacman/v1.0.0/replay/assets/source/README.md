# Source art for the Foray sprite sheet

These are the **finished, committed** pixel-art assets the packer
(`../gen-sheet.mjs`) composes into the renderer's `../sheet.png` + `../sheet.json`.
Each file is the **regenerated** image (the authoritative output rebuilt from the
recorded action log) of an [asset-generation](https://) run of the matching
`foray-*` test case. They are RGBA, 16×16, and use the exact palette the renderer
expects: the neutral grey recolor ramp (so the per-team palette swap can tint
them) for `nest`, and the shared non-recolored palette for `seed`/`jelly`.

| File | Asset case | Source run |
| --- | --- | --- |
| `nest.png` | `foray-nest` v1.0.0 (base) | `9da30365-0847-4114-801c-7beace3e0c93` |
| `seed.png` | `foray-seed` v1.0.0 (base) | `1302cb40-6240-4455-83a5-772aa4d355d2` |
| `jelly_active.png` | `foray-jelly` v1.0.0 (base) frame 0 | `9b4713ef-6479-4510-a64d-2e46c2e92cfe` |
| `jelly_spent.png` | `foray-jelly` v1.0.0 (base) frame 1 | `9b4713ef-6479-4510-a64d-2e46c2e92cfe` |

Frames the packer still draws as **placeholders** (no finished source art yet):
the soldier/raider walk cycles (`foray-soldier`, `foray-raider`) and the maze
wall tileset (`foray-walls`). When those cases are generated, copy each run's
**regenerated** per-frame PNGs here under the packer's frame names (the packer
reads `source/<name>.png`; see `../gen-sheet.mjs`). The asset cases write frames
by **index** (`frames/<index>.png`); the index → source-name mapping is:

**`foray-soldier`** (16 frames, facing-major, 4-step walk cycle):

| Case frames | → source names |
| --- | --- |
| 0–3 (down) | `soldier_s_0..3.png` |
| 4–7 (up) | `soldier_n_0..3.png` |
| 8–11 (left) | `soldier_w_0..3.png` |
| 12–15 (right) | `soldier_e_0..3.png` |

**`foray-raider`** (32 frames; empty 0–15, laden 16–31):

| Case frames | → source names |
| --- | --- |
| 0–3 / 4–7 / 8–11 / 12–15 (empty s/n/w/e) | `raider_{s,n,w,e}_0..3.png` |
| 16–19 / 20–23 / 24–27 / 28–31 (laden s/n/w/e) | `raider_laden_{s,n,w,e}_0..3.png` |

**`foray-walls`** (20 frames): wall frame `index` == its N/E/S/W bitmask, so case
frame `N` → `wall_N.png` (0–15); then `16 → border_cap_top.png`,
`17 → border_mid.png`, `18 → border_cap_bottom.png`, `19 → floor.png`.

To refresh: `node ../gen-sheet.mjs` from this directory's parent (`replay/assets/`).
