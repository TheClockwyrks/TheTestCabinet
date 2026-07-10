Reworked the variants around Fathom's signature **sensing** system, and revised
the predators and their tells after playtesting v1.0.

The three mode variants (Murk, Reserve, Beam) are dropped; the case now offers two
dives that share everything but how you read the dark:

- **Base (Trench)** — a StarCraft-style remembered fog of war, line-of-sight
  passive light, and a corridor-flooding sonar pulse. What you explore stays drawn;
  only never-revealed ground is black.
- **Kindle** (new) — the same fog of war as base, plus an outer **vision circle**
  you carry: an actual circle (cut at the pixel), centered on the forager and
  growing as you eat, beyond which the trench is pitch black even where explored.
  The circle reveals nothing — it only limits what of the already-revealed map is
  shown — so eaten plankton stay eaten and hidden ground returns when you revisit
  it. It is *not* vision for predators (that stays the line-of-sight light circle).

Each variant seeds its own self-contained `specs/sensing.md`, and the common specs
no longer reference "modes" or any other variant. The shared single-dive menu makes
the `title` reference common to both variants.

The predators were also revised for clarity and fairness:

- The two sound/light hunters are named outright — the **Lanternjaw** (light) and
  the **Gloamfin** (sound) — replacing the descriptive "Lure"/"Listener".
- A **detection alert** now fires the instant the Gloamfin's ping or the
  Flarefish's flare acquires you, so being spotted always reads at a glance.
- The **Gloamfin** no longer winds up ever faster over time. It wanders at ordinary
  speed and, when a ping (yours or its own) catches you, sprints faster than the
  forager to that tile, then casts about and re-pings after a short, deliberate
  delay — giving you a window to break away.
- The **Flarefish** is now invisible while wandering (seen only by its flare, which
  ignores walls and reveals tiles for you) and, once its flare catches you, chases
  exactly like the Lanternjaw before re-arming its flare on a timer.
- The **bonus drifter** and the **Lanternjaw's bulb-light** are now always visible
  at any distance and drawn to look almost identical, so the drifter reads as bait.
- Brightness now **holds for a short delay** after your last pellet (resetting each
  time you eat) before decaying, rather than draining constantly; walls are revealed
  by your light, sonar, and the flare (but never the Gloamfin's ping).
