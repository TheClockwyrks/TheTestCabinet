## How it works

Three things come together for every entry in the gallery:

- **Test cases** are the games. Each one is a self-contained specification: the
  rules, the visuals to match (as reference mockups), and any assets a model
  shouldn't have to draw itself. Test cases are *inspired by* the originals but
  are intentionally *not* copies of them. We add our own twists, often handled
  as variants, to modify the end goal and to force the model to adapt to our
  specifications rather than regurgitate a reference implementation. The hardest
  test cases are meant to stay out of reach of even the best models for a while.
- **Models** are the language models under test. We track who made them, what
  they cost (priced against OpenRouter's published rates), and which runs each
  one produced.
- **Runs** are a single model + harness attempt at a single test case. Every run
  happens in a fresh, isolated container seeded with nothing but the test case's
  specification and reference visuals. There's no git history to mine for
  answers, which is a known flaw from other benchmarks that can allow a model
  to cheat. We record the run time, the token usage (cached vs. uncached input,
  reasoning vs. output), the cost, and a set of lightweight automated checks
  against the reference visuals.
