**Pareto Code Router** is OpenRouter's routing layer for coding work — not a
single model but a policy that, for each request, dispatches to whichever
underlying model it judges best, aiming for a Pareto-optimal trade-off between
cost and capability. In The Test Cabinet it is reached through OpenRouter and
driven by one of the suite's OpenRouter-routed harnesses (such as **OpenCode**),
which runs it against a benchmark case inside a fresh, isolated repository.

That makes this entry a meta-subject: what the suite measures here is not a
fixed model but the *router's choices* — how good a result emerges when the
routing, rather than a model you picked yourself, decides what to run. It is a
useful data point precisely because it answers a different question than the
single-model pages: can a routing policy land on the right engine for the task,
case after case, without a human in the loop? Because the router dispatches to
different models per request, its effective cost varies from run to run; The
Test Cabinet still uses the comparable per-token prices OpenRouter reports as
the canonical, provider-stable cost of a run.
