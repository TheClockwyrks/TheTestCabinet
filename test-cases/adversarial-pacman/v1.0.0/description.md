**Foray** is The Test Cabinet's first *adversarial* test case: instead of building
an application, the model writes the **controller** that drives one side of a
head-to-head game, compiled to WebAssembly and run against an opponent with no
model in the loop. The model's score is its controller's match record.

The game is a territorial maze-raiding contest between two ant colonies on a
mirror-symmetric maze. Every agent is both attacker and defender — a **soldier**
that tags intruders on its own half and a **raider** that eats and banks the
enemy's seed caches on theirs, its role flipping the instant it crosses the border.
Foray descends from the classic UC Berkeley "Pacman Capture-the-Flag" contest
but changes the two levers every published strategy leans on, so a model cannot
win by reciting one: a raider's speed **degrades with its load** (carry weight),
making *when to break off and bank* a real decision, and eating **royal jelly**
grants the eater tag-immunity rather than making defenders edible (the inverted
capsule) — the risky tool that lets a slow, laden raider punch home through a
defended border.

A run compiles the model's controller to a wasm module and plays **one canonical
match** against a committed baseline opponent (`border-soldier`), recording the
winner, the score, how the match ended (a sweep of the enemy larder, the 10-minute
time cap, or a forfeit), and a browser-playable replay. The replay is reconstructed
on the public site from the same engine that decided the match, so a visitor can
watch the raid unfold rather than read a bare result.

The model writes only the controller; the rules, the world, the sandbox, and the
scoring are owned by the case. The interesting strategy space — balancing offence
against defence across three agents tick by tick, timing a bank against carry
weight, and spending jelly to run a heavy load home — is left entirely for the
model to discover.
