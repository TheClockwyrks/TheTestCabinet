## What we measure (and what we don't)

Token count is the primary metric that we measure. This is the most telling
metric for models, as the number of tokens consumed directly affects the cost of
using a model and how quickly it can complete tasks. A model that's 2x cheaper
and 4x faster than another model isn't cheaper or faster in practice if it
consumes 10x as many tokens to complete the same task.

Since many of our models are tested through OpenRouter, we intentionally *don't*
use runtime as a primary metric. Test runs do record their runtime for anyone
curious, but runtime isn't a fair metric to go off of since it's heavily
provider dependent. For open weight models served by multiple providers
independent of the model's developer, token throughput varies by which provider
OpenRouter routes to, and is therefore not a good metric to use for comparisons.
