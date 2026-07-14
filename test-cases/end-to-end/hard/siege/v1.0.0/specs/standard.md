# Siege — Mode: Last Stand

**Last Stand** is the game's mode — the siege that **PLAY** begins from the title
screen (`specs/flow.md`). It is the standard siege exactly as the common specs
describe: one continuous fighting retreat across the three redoubts A → B → C, with
the survival clock and kill count as the score.

Last Stand adds no rules of its own beyond the common specification. It is the
named baseline the game plays from.

- **PLAY** starts Last Stand; the only in-flow choices are the **starting phase**
  (on the phase prompt) and the **class** (on the in-game spawn UI) — both defined
  in `specs/flow.md`.
- All parameters are the common ones: the world (`specs/world.md`), the survival
  loop and escalation (`specs/phases.md`), the classes and roster
  (`specs/combat.md`), and the AI and squad (`specs/ai.md`).
