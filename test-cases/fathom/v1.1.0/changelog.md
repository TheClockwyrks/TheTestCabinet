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
  speed and, when a ping (yours or its own) catches you, chases just a touch (about
  **5%**) faster than the forager to that tile, then casts about and re-pings after a
  short, deliberate delay — giving you a window to break away. Its chase was toned
  down from a full sprint because it often fixes on you at close range off its
  short-range hearing, where a big speed jump was an unfair blindside. Its pings are
  now **floored at ~`3 s` apart**, so re-finding you up close can no longer make it
  rapid-fire its ping.
- The **Flarefish** now gives off **no tell of its own but its flare** — no bulb, no
  ping. Your light and sonar reveal it like any other predator; it simply does not
  advertise itself between flares (which ignore walls and reveal tiles for you), and
  its flare is rarer than the Gloamfin's ping so it warns you less often. Once its
  flare catches you it chases exactly like the Lanternjaw before re-arming its flare
  on a timer. The flare is now a **persistent, moving light for the whole bloom**:
  it catches you at *any* moment you are in the disc (not just the first instant),
  and it stays attached to the Flarefish so its own drift can sweep the light over
  you. Visually the whole disc is drawn at **full light**, fading back to normal near
  the end — and in **Kindle** the flare acts as a **second vision circle** that
  reveals the trench inside it in full, then vanishes when the flare dies, leaving
  only the window you carry.
- The **bonus drifter** and the **Lanternjaw's bulb-light** are now always visible
  at any distance and drawn to look almost identical, so the drifter reads as bait —
  and a **wandering Lanternjaw now copies the drifter's AI exactly** (its `64 px/s`
  speed and its wander), so until it detects you its bulb is indistinguishable from a
  real drifter in both look *and* motion. On a fix it drops the disguise and hunts.
- Brightness now **holds for a short delay** after your last pellet (resetting each
  time you eat) before decaying, rather than draining constantly; walls are revealed
  by your light, sonar, and the flare (but never the Gloamfin's ping).
