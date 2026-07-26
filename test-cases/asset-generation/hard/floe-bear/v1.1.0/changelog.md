## Judged on a single overall rating

The reviewer checklist is gone. A produced asset is too subjective to break into
pass/fail items, so the case now declares one `overall` scoring domain and no
`[[review_item]]`s: a reviewer judges the regenerated sheet as a whole against the
brief and gives it one rating. The five `fidelity` items — the dangerous-predator
read, the four-direction run cycle, the submerged swim, the lunge, and the palette
on transparency — are removed along with the `fidelity` domain they were grouped
under. `specs/brief.md` still asks for every one of those things; they are simply
judged as part of the whole rather than checked off one by one.

## Other changes

- Reworked the prompt's "What to read first" section to point at the `specs/`
  directory and require an implementation that matches the specification
  exactly, rather than enumerating every spec file, prescribing a read order,
  and restating `specs/brief.md`'s frame/palette/tool details inline.
