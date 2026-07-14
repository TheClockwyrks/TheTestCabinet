## What we measure (and what we don't)

Token count is the primary metric that we measure. This is the most telling
metric for models, as the number of tokens consumed directly affects the cost of
using a model and how quickly it can complete tasks. A model that's 2x cheaper
and 4x faster than another model isn't cheaper or faster in practice if it
consumes 10x as many tokens to complete the same task.

Our test cases also rely on automated checks for initial validation, but we do
not derive the rating we assign to implementations from the automated checks.
Test cases' automated checks are intended to be quick tests to sanity check the
implementation before a human takes a look. Most of what makes a good
implementation can't be scored by a machine, which is exactly why we publish the
playable builds.

Every implementation is released as code you can clone and run locally. The
point of The Test Cabinet isn't to crown a winner. It's to show what today's
models and harnesses can and can't build.
