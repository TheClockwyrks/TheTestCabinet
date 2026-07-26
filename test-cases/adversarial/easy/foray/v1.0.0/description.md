**Foray** is The Test Cabinet's first *adversarial* test case: instead of building
an application, the model writes the **controller** that drives one side of a
head-to-head game, compiled to WebAssembly and run against an opponent with no
model in the loop. The model's score is its controller's match record.

The game is a territorial maze-raiding contest between two ant colonies on a
mirror-symmetric maze. Every agent is both attacker and defender — a **soldier**
that tags intruders on its own half and a **raider** that eats and banks the
enemy's seed caches on theirs, its role flipping the instant it crosses the border.
Foray descends from the classic UC Berkeley "Pacman Capture-the-Flag" contest
but changes the levers every published strategy leans on, so a model cannot win by
reciting one. A raider's speed **degrades with its load** (carry weight), making
*when to break off and bank* a real decision. **Royal jelly** makes its eater
briefly untouchable *and* lethal — an immune ant cannot be tagged and kills any
non-immune enemy it meets, even a defender at home — and the nodes **grow back**,
so no defender can hold a position forever. And each half holds two **large seeds**,
worth and weighing three ordinary ones, which **drift toward the border on their
own** until they rest on the seam within reach of an enemy raider: an objective that
cannot be squatted, only defended or recalled.

A run compiles the model's controller to a wasm module and plays **one canonical
match** against a committed baseline opponent (`border-soldier`), recording the
winner, the score, how the match ended (a sweep of the enemy larder, the 10-minute
time cap, or a forfeit), and a browser-playable replay. The replay is reconstructed
on the public site from the same engine that decided the match, so a visitor can
watch the raid unfold rather than read a bare result.

The model writes only the controller; the rules, the world, the sandbox, and the
scoring are owned by the case. The interesting strategy space — balancing offense
against defense across three agents tick by tick, timing a bank against carry
weight, spending jelly both to survive and to kill, and contesting the drifting
large seeds — is left entirely for the model to discover.
