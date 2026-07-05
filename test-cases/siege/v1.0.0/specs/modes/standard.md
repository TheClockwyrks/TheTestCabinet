# Siege — Mode: Last Stand

**Last Stand** is the game's mode, and the entry the deploy screen offers
(`specs/flow.md`). It is the standard siege exactly as the common specs describe:
one continuous fighting retreat across the three redoubts A → B → C, with the
survival clock and kill count as the score.

Last Stand adds no rules of its own beyond the common specification. It exists as
the named baseline so the deploy screen has a mode to present and future versions
can add sibling modes (a longer front, a no-artillery skirmish, a one-life
gauntlet) without disturbing it.

- The deploy screen presents **LAST STAND** as the mode, alongside the class and
  starting-phase choices (`specs/flow.md`).
- All parameters are the common ones: the world (`specs/world.md`), the survival
  loop and escalation (`specs/phases.md`), the classes and roster
  (`specs/combat.md`), and the AI and squad (`specs/ai.md`).
