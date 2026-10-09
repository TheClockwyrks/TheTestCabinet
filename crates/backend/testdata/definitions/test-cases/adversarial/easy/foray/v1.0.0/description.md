**Foray** is The Test Cabinet's first adversarial test case. The model writes
the controller that drives one side of a head-to-head game, compiled to
WebAssembly and run against an opponent with no model in the loop. The model's
score is its controller's match record.

The game is a territorial maze-raiding contest between two ant colonies on a
mirror-symmetric maze. Every agent is both attacker and defender: a soldier
that tags intruders on its own half, and a raider that eats and banks the
enemy's seed caches on theirs. Its role flips the instant it crosses the
border. Foray descends from the UC Berkeley "Pacman Capture-the-Flag" contest,
and changes the levers its published strategies lean on:

- A raider's speed degrades with its load, so when to break off and bank is a
  real decision.
- Royal jelly makes its eater briefly untouchable and lethal. An immune ant
  cannot be tagged, and kills any non-immune enemy it meets, including a
  defender at home. The jelly nodes grow back, so every position a defender
  holds is temporary.
- Each half holds two large seeds, worth and weighing three ordinary ones. They
  drift toward the border on their own until they rest on the seam within reach
  of an enemy raider. A large seed cannot be squatted, only defended or
  recalled.

A run compiles the model's controller to a wasm module and plays one canonical
match against the committed baseline opponent `border-soldier`. It records the
winner, the score, how the match ended, and a browser-playable replay. A match
ends on a sweep of the enemy larder, the 10-minute time cap, or a forfeit. The
public site reconstructs the replay from the same engine that decided the
match, so a visitor can watch the raid unfold.

The model writes only the controller. The case owns the rules, the world, the
sandbox, and the scoring. The strategy space is left for the model to discover:
balancing offense against defense across three agents tick by tick, timing a
bank against carry weight, spending jelly both to survive and to kill, and
contesting the drifting large seeds.
