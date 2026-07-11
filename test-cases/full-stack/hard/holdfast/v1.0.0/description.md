**Holdfast** is a top-down colony survival-management game. You look down on a single
patch of frontier and direct a small band of settlers to gather what the land offers,
build a defensible base, feed themselves, and hold that base against raiders who come for
what they have built. You do not move a settler by hand — you designate work and set
priorities, and the settlers, autonomous workers with needs, mood, and skills, decide who
does what and carry it out.

Its defining pressure is the **raid**. An escalating **threat director** sends waves of
hostiles on a tightening timer that quickens as the colony grows richer, and they come
with guns. Between raids the colony must turn the map into a working home — chop wood and
mine ore, build walls and beds and a stove, plant and harvest and cook food, and stand up
turrets and armed defenders — all while the settlers' hunger, rest, and mood run down and
the day/night clock turns. Survival is the tension between those clocks: grow defenses
and a larder faster than the raids escalate, or be overrun. Underneath sit several
interacting systems — a top-down tile world with resource nodes, needs-and-mood-driven
settlers on a priority job queue, a gather→build→cook→farm economy, a day/night cycle, and
ranged-combat raids fought from cover.

Holdfast is also a **full-stack case**: the model under test must **produce the game's own
assets during the run** — the settler and raider sprite sheets, the terrain and structure
sprites, the muzzle-flash/blood/fire particle effects, and the sound and music — with the
six asset-generation tools on the run image's `PATH`, and then build the game around them.
It is inspired by colony survival sims like *RimWorld* but is entirely its own: an
original name, look, and system set, and its own scope.
