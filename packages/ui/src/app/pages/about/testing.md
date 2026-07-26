## How it works

For each test run, we spin up a new container instance, install the harness to
be used by the test into it, seed the container with the test case's specs, and
initialize the workspace. This ensures that each test run always uses the latest
harness version at the time of the test, and ensures that models can't cheat.
Unlike other benchmarks, there's no git history or run history for a model to
locate and use to help it implement the specs it was given.

The model is then free to run until it either signals completion or hits the
test case's time limit. If the model signals completion, we first run a set of
automated checks against the implementation to score it using the debug API
mandated by the specs. Those checks account for around 90% of most test cases'
total score. A human reviewer then tries the build, provides the pass/fail
verdict for the remaining review items, and assigns the build an overall rating.

We've opted to consider the debug API a core part of the implementation. If a
model fails to implement a section of the debug API correctly, automated checks
that rely on the affected API functions will fail. We've chosen to keep such
failures rather than override them during the human review because implementing
the debug API correctly is a part of the test case, and many review items are
difficult to precisely judge simply by playing the game. This does mean that
some models may get dinged on items that work as intended, but fortunately,
those models have an easy path to reclaiming those points: stop messing up your
debug APIs.
