# Spectra Grades Every Pointer And Touch Rule Its Specification States

`test-cases/end-to-end/easy/spectra/v2.0.0` decides each rule `specs/ui.md`
gives the pointer and the touch contacts with a review item of its own.

## Current behaviour

The `pointer` and `touch` categories grade three behaviors each on each of the
three menu screens: a move or a landing selects an item, a press and release or a
landing and lift inside one region confirms it, and two edges falling in
different regions confirm nothing. Four rules the same section states carry no
item, and a build can break any of them and keep full marks.

The fourth confirm clause states that an edge falling outside every item region
confirms no item. Every graded cancel point pairs two edges that both land inside
some region, so a build that treats any release as a confirm of the item at
`menuIndex` passes each of them. The comment above both categories names this
clause as ungraded.

The same section states that neither a pointer nor a contact does anything on
`howto`, `stageIntro`, `inWave`, and `stageCleared`. A build that runs its menu
hit test on every screen, and so moves `menuIndex` or leaves a screen under a
stray click during a wave, keeps its score. This rule is also named as ungraded
in both comments.

Two precedence rules govern a frame carrying both a keyboard edge and a pointer
or touch edge. A movement edge together with a pointer or touch selection leaves
`menuIndex` at the item the pointer or the contact named, and a `confirm` edge
together with a pointer or touch confirm confirms the keyboard's item alone.
Neither the manifest nor any validator mentions either rule.

## Design

Each rule becomes an item that reads the behavior the specification states.

The outside-every-region clause and the two precedence rules are claims about how
one frame's edges are ordered and paired rather than about a screen's layout, so
one screen can honestly speak for each of them. The rule about the screens that
show no menu is a claim about a screen, and the four screens it names are reached
by separate code paths in an ordinary build, so it wants an item per screen.

Each item declares the domains, the `failure_cap` from the guide's table, and the
image output the case's other input items carry, with a script under every engine
project and captured baselines.

Both category comments state the scope the new items give the category, and every
count the case states about its own checklist matches the manifest.

## Done when

- [ ] An item decides that an edge outside every region confirms no item.
- [ ] An item per screen showing no menu decides a pointer and a contact do nothing.
- [ ] An item decides each of the two same-frame keyboard precedence rules.
- [ ] Each new item has a script under every engine project and captured baselines.
- [ ] Every count the case states about its own checklist matches the manifest.
- [ ] Gates green.
