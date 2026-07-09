//! The curated model-catalog seed: a one-time snapshot of the model configs
//! authored as `models/<slug>.toml` + `.md` before the catalog moved into the
//! backend store. On first boot the backend inserts these into the empty
//! `model` table (see [`crate::build`]); afterwards the catalog is edited in the
//! app, so this data is never consulted again once the table is populated.
//!
//! Generated from the former `models/` directory; not hand-edited.

/// One curated model to seed into the store on first boot.
pub struct SeedModel {
    pub slug: &'static str,
    pub display_name: &'static str,
    pub provider: &'static str,
    pub openrouter_slug: Option<&'static str>,
    pub description_md: &'static str,
    /// Canonical model ids this model covers (`openrouter/` prefix stripped).
    pub aliases: &'static [&'static str],
}

/// The curated models seeded on first boot, ordered by slug.
pub const SEED_MODELS: &[SeedModel] = &[
    SeedModel {
        slug: r#"claude-fable-5"#,
        display_name: r#"Claude Fable 5"#,
        provider: r#"Anthropic"#,
        openrouter_slug: Some(r#"anthropic/claude-fable-5"#),
        description_md: r#"**Claude Fable 5** is a newer line in the Claude family, distinct from the
familiar Haiku, Sonnet, and Opus tiers. When it runs, it does so through the
**Claude Code** harness, which drives the model against a benchmark case from a
fresh, isolated repository.

For now Fable is catalogued ahead of availability: it is listed on OpenRouter
but not yet open to run, so its page is a placeholder for results to come rather
than a record of completed benchmark cases. The pricing shown is the comparable
per-token figure OpenRouter reports, which is the canonical, provider-stable
cost The Test Cabinet will use for a run once the model can actually be
exercised."#,
        aliases: &[r#"claude-fable-5"#, r#"anthropic/claude-fable-5"#],
    },
    SeedModel {
        slug: r#"claude-haiku-4-5"#,
        display_name: r#"Claude Haiku 4.5"#,
        provider: r#"Anthropic"#,
        openrouter_slug: Some(r#"anthropic/claude-haiku-4.5"#),
        description_md: r#"**Claude Haiku 4.5** is Anthropic's fast, economical model in the Claude 4.5
family — built for low latency and high throughput while remaining a genuinely
capable coding model. In The Test Cabinet it runs through the **Claude Code**
harness, which drives it against a benchmark case inside a fresh, isolated
repository.

Like the other small models in the catalog, Haiku is interesting here as a
value anchor: it lets the suite show how much polish a strong harness can coax
out of a lightweight, inexpensive model, and how its results compare against
heavier models on the same case. The prices on its page are the comparable
per-token figures OpenRouter reports, which The Test Cabinet uses for the
canonical cost of a run rather than the exact provider charge."#,
        aliases: &[r#"claude-haiku-4-5"#, r#"anthropic/claude-haiku-4.5"#],
    },
    SeedModel {
        slug: r#"claude-opus-4-8"#,
        display_name: r#"Claude Opus 4.8"#,
        provider: r#"Anthropic"#,
        openrouter_slug: Some(r#"anthropic/claude-opus-4.8"#),
        description_md: r#"**Claude Opus 4.8** is Anthropic's top-tier flagship — the most capable model
in the Opus line and the heaviest hitter Anthropic offers for serious coding
work. In The Test Cabinet it runs through the **Claude Code** harness, which
drives it against a benchmark case inside a fresh, isolated repository.

As the strongest model in the catalog, Opus is the reference subject the suite
is really built to stress: the test cases are designed to push past the ceiling
of even the best models, so watching where a flagship still struggles is the
most telling signal The Test Cabinet produces. Its results also set the upper
bar that lighter models are measured against on the same case. The prices on
its page are the comparable per-token figures OpenRouter reports, which The Test
Cabinet uses as the canonical cost of a run rather than the exact provider
charge."#,
        aliases: &[r#"claude-opus-4-8"#, r#"anthropic/claude-opus-4.8"#],
    },
    SeedModel {
        slug: r#"claude-sonnet-4-6"#,
        display_name: r#"Claude Sonnet 4.6"#,
        provider: r#"Anthropic"#,
        openrouter_slug: Some(r#"anthropic/claude-sonnet-4.6"#),
        description_md: r#"**Claude Sonnet 4.6** is Anthropic's balanced workhorse — the practical default
that sits between fast, economical Haiku and the heavyweight Opus flagship. In
The Test Cabinet it runs through the **Claude Code** harness, which drives it
against a benchmark case inside a fresh, isolated repository.

The mid-tier is where most real coding actually happens, which makes Sonnet a
central data point for the suite: it shows how much of a substantial task a
strong general-purpose model can carry on its own, and how close it lands to
the flagship without the flagship's cost. Its runs are a natural midpoint to
compare the lighter and heavier models against on the same case. Pricing shown
on its page is the comparable per-token cost reported by OpenRouter, which is
what The Test Cabinet uses for the canonical, provider-stable cost of a run."#,
        aliases: &[r#"claude-sonnet-4-6"#, r#"anthropic/claude-sonnet-4.6"#],
    },
    SeedModel {
        slug: r#"claude-sonnet-5"#,
        display_name: r#"Claude Sonnet 5"#,
        provider: r#"Anthropic"#,
        openrouter_slug: Some(r#"anthropic/claude-sonnet-5"#),
        description_md: r#"**Claude Sonnet 5** is Anthropic's latest-generation balanced workhorse — the
practical default that sits between fast, economical Haiku and the heavyweight
Opus flagship. In The Test Cabinet it runs through the **Claude Code** harness,
which drives it against a benchmark case inside a fresh, isolated repository.

The mid-tier is where most real coding actually happens, which makes Sonnet a
central data point for the suite: it shows how much of a substantial task a
strong general-purpose model can carry on its own, and how close it lands to the
flagship without the flagship's cost. Its runs are a natural midpoint to compare
the lighter and heavier models against on the same case. Pricing shown on its
page is the comparable per-token cost reported by OpenRouter, which is what The
Test Cabinet uses for the canonical, provider-stable cost of a run."#,
        aliases: &[r#"claude-sonnet-5"#, r#"anthropic/claude-sonnet-5"#],
    },
    SeedModel {
        slug: r#"deepseek-v4-flash"#,
        display_name: r#"DeepSeek V4 Flash"#,
        provider: r#"DeepSeek"#,
        openrouter_slug: Some(r#"deepseek/deepseek-v4-flash"#),
        description_md: r#"**DeepSeek V4 Flash** is DeepSeek's fast, economical V4 tier — a value-oriented
subject tuned to run cheaply and quickly while still leaning on DeepSeek's
reputation as a strong, cost-efficient provider. In The Test Cabinet it is
reached through OpenRouter and driven by one of the suite's OpenRouter-routed
harnesses, which points the model at a benchmark case from a fresh, isolated
repository.

Like the other lightweight models in the catalog, Flash earns its place as a
value anchor: it shows how much a capable harness can coax out of an inexpensive
model on a substantial task, and where the budget tier's ceiling starts to bite
against the heavier subjects on the same case. The prices on its page are the
comparable per-token figures OpenRouter reports, which The Test Cabinet uses as
the canonical cost of a run rather than the exact provider charge."#,
        aliases: &[r#"deepseek/deepseek-v4-flash"#],
    },
    SeedModel {
        slug: r#"deepseek-v4-pro"#,
        display_name: r#"DeepSeek V4 Pro"#,
        provider: r#"DeepSeek"#,
        openrouter_slug: Some(r#"deepseek/deepseek-v4-pro"#),
        description_md: r#"**DeepSeek V4 Pro** is DeepSeek's top-tier V4 model — the capable, heavier
subject in the family, and the one to reach for when the case calls for DeepSeek
at full strength. DeepSeek has built its reputation as a strong open-weight,
cost-efficient provider, and the Pro tier is where that lineage meets serious
coding work. In The Test Cabinet it is reached through OpenRouter and driven by
one of the suite's OpenRouter-routed harnesses against a benchmark case in a
fresh, isolated repository.

A heavier DeepSeek model is a useful contrast for the catalog: it shows how a
provider known for value-per-token performs when it is competing on capability
rather than price, and how it lands against the other frontier subjects on the
same case. Pricing shown on its page is the comparable per-token cost reported
by OpenRouter, which is what The Test Cabinet uses for the canonical,
provider-stable cost of a run."#,
        aliases: &[r#"deepseek/deepseek-v4-pro"#],
    },
    SeedModel {
        slug: r#"devstral-2512"#,
        display_name: r#"Devstral 2512"#,
        provider: r#"Mistral"#,
        openrouter_slug: Some(r#"mistralai/devstral-2512"#),
        description_md: r#"**Devstral 2512** is Mistral's coding-specialized model — tuned specifically for
software-engineering agents rather than general chat, with an emphasis on
navigating a real repository, editing across files, and driving an agentic loop
to completion. The `2512` tag marks its release snapshot. In The Test Cabinet it
is reached through OpenRouter and driven by one of the suite's OpenRouter-routed
harnesses against a benchmark case in a fresh, isolated repository.

A purpose-built coding model is a useful data point for the suite precisely
because it optimizes for the task the cases measure: it shows what a model
trained for agentic software work — rather than a broad generalist — can do on
the same front-end build, and where that specialization helps or falls short
against the frontier subjects. Pricing shown on its page is the comparable
per-token cost reported by OpenRouter, which is what The Test Cabinet uses for
the canonical, provider-stable cost of a run."#,
        aliases: &[r#"mistralai/devstral-2512"#],
    },
    SeedModel {
        slug: r#"gemini-3.1-flash-lite"#,
        display_name: r#"Gemini 3.1 Flash Lite"#,
        provider: r#"Google"#,
        openrouter_slug: Some(r#"google/gemini-3.1-flash-lite"#),
        description_md: r#"**Gemini 3.1 Flash Lite** is the smallest and cheapest tier in Google's Gemini
lineup — the value floor of the family, built to run quickly and at minimal
cost. In The Test Cabinet it is reached through OpenRouter and driven by one of
the suite's OpenRouter-routed harnesses (such as OpenCode), which exercises the
model against a benchmark case inside a fresh, isolated repository.

Like the other lightweight models in the catalog, Flash Lite is interesting as a
floor anchor: it lets the suite show how much a strong harness can coax out of
the most economical option, and how far that lands behind the heavier Flash and
Pro tiers on the same case. The prices on its page are the comparable per-token
figures OpenRouter reports, which The Test Cabinet uses as the canonical,
provider-stable cost of a run."#,
        aliases: &[r#"google/gemini-3.1-flash-lite"#],
    },
    SeedModel {
        slug: r#"gemini-3.1-pro-preview"#,
        display_name: r#"Gemini 3.1 Pro Preview"#,
        provider: r#"Google"#,
        openrouter_slug: Some(r#"google/gemini-3.1-pro-preview"#),
        description_md: r#"**Gemini 3.1 Pro Preview** is Google's top-tier model in the Gemini 3 family —
a heavyweight subject built for the hardest reasoning and coding work, and
still a preview release at the time it entered the catalog. In The Test Cabinet
it is reached through OpenRouter and driven by one of the suite's
OpenRouter-routed harnesses (such as OpenCode), which exercises the model
against a benchmark case inside a fresh, isolated repository.

As the flagship Gemini tier, Pro is where the suite expects the most polish: it
sets the high-water mark that the lighter Flash variants are measured against
on the same case, and shows how a frontier model behaves when a capable harness
gets out of its way. Because it is still a preview, its results are best read as
a snapshot of where the line currently sits. The prices on its page are the
comparable per-token figures OpenRouter reports, which The Test Cabinet treats
as the canonical, provider-stable cost of a run."#,
        aliases: &[r#"google/gemini-3.1-pro-preview"#],
    },
    SeedModel {
        slug: r#"gemini-3.5-flash"#,
        display_name: r#"Gemini 3.5 Flash"#,
        provider: r#"Google"#,
        openrouter_slug: Some(r#"google/gemini-3.5-flash"#),
        description_md: r#"**Gemini 3.5 Flash** is the fast, balanced mid-tier member of Google's Gemini
family — tuned for speed and throughput while staying capable enough to handle
real coding work. In The Test Cabinet it is reached through OpenRouter and
driven by one of the suite's OpenRouter-routed harnesses (such as OpenCode),
which exercises the model against a benchmark case from a fresh, isolated
repository.

A Flash-tier model is a valuable data point precisely because it sits in the
middle: it shows how much of the flagship's quality survives when you trade
down for a quicker, lighter model, and how a strong harness closes that gap on
a substantial task. Pricing shown on its page is the comparable per-token cost
reported by OpenRouter, which is what The Test Cabinet uses for the canonical
cost of a run rather than any single provider's exact charge."#,
        aliases: &[r#"google/gemini-3.5-flash"#],
    },
    SeedModel {
        slug: r#"glm-5.1"#,
        display_name: r#"GLM 5.1"#,
        provider: r#"Z.ai"#,
        openrouter_slug: Some(r#"z-ai/glm-5.1"#),
        description_md: r#"**GLM 5.1** is Z.ai's (Zhipu) current flagship in the GLM line — a strong,
general-purpose model positioned at the top of its family and aimed squarely at
real coding work. In The Test Cabinet it is reached through OpenRouter and
driven by one of the suite's OpenRouter-routed harnesses, which drives the
model against a benchmark case inside a fresh, isolated repository.

As Z.ai's flagship subject, GLM 5.1 is a useful point of comparison for the
suite: it shows how a leading model from outside the usual roster handles a
substantial front-end build, and how its results line up against flagship
models from other providers on the same case. The prices on its page are the
comparable per-token figures OpenRouter reports, which The Test Cabinet uses as
the canonical, provider-stable cost of a run."#,
        aliases: &[r#"z-ai/glm-5.1"#],
    },
    SeedModel {
        slug: r#"gpt-5.4-mini"#,
        display_name: r#"GPT-5.4 Mini"#,
        provider: r#"OpenAI"#,
        openrouter_slug: Some(r#"openai/gpt-5.4-mini"#),
        description_md: r#"**GPT-5.4 mini** is OpenAI's small, fast member of the GPT-5.4 family — tuned to
be cheap and quick enough to run at scale while still holding up on real coding
work. In The Test Cabinet it is exercised through the **Codex** harness, which
drives the model against a benchmark case from a fresh, isolated repository.

A mini-tier model is a useful data point for the suite precisely because it is
*not* the strongest option: it shows how far a capable harness can carry a
budget model on a substantial front-end task, and where the model's ceiling
starts to bite. Pricing shown on its page is the comparable per-token cost
reported by OpenRouter, which is what The Test Cabinet uses for the canonical,
provider-stable cost of a run."#,
        aliases: &[r#"gpt-5.4-mini"#, r#"openai/gpt-5.4-mini"#],
    },
    SeedModel {
        slug: r#"gpt-5.4-nano"#,
        display_name: r#"GPT-5.4 Nano"#,
        provider: r#"OpenAI"#,
        openrouter_slug: Some(r#"openai/gpt-5.4-nano"#),
        description_md: r#"**GPT-5.4 Nano** is the smallest and cheapest member of the GPT-5.4 family —
sitting below even the mini tier, built to be as fast and inexpensive as the
generation gets. In The Test Cabinet it runs through the **Codex** harness,
which drives the model against a benchmark case from a fresh, isolated
repository.

Nano serves as the value floor for the suite: it shows how much a capable
harness can wring out of the leanest model on offer, and marks the lower bound
the heavier subjects are weighed against on the same case. The prices on its
page are the comparable per-token figures OpenRouter reports, which The Test
Cabinet adopts as the canonical, provider-stable cost of a run instead of the
exact provider charge."#,
        aliases: &[r#"gpt-5.4-nano"#, r#"openai/gpt-5.4-nano"#],
    },
    SeedModel {
        slug: r#"gpt-5.4"#,
        display_name: r#"GPT-5.4"#,
        provider: r#"OpenAI"#,
        openrouter_slug: Some(r#"openai/gpt-5.4"#),
        description_md: r#"**GPT-5.4** is OpenAI's prior full-size generation — a capable, general-purpose
coding model that sits just below the current flagship in the catalog. In The
Test Cabinet it is exercised through the **Codex** harness, which drives the
model against a benchmark case from a fresh, isolated repository.

It earns its place mainly as the cost half of a comparison: at about half the
per-token price of GPT-5.5, it lets the suite measure exactly what the extra
spend on the newer flagship buys on the same case, and how much of that gap a
strong harness can close. Pricing shown on its page is the comparable per-token
cost reported by OpenRouter, which is the figure The Test Cabinet uses as the
canonical, provider-stable cost of a run."#,
        aliases: &[r#"gpt-5.4"#, r#"openai/gpt-5.4"#],
    },
    SeedModel {
        slug: r#"gpt-5.5"#,
        display_name: r#"GPT-5.5"#,
        provider: r#"OpenAI"#,
        openrouter_slug: Some(r#"openai/gpt-5.5"#),
        description_md: r#"**GPT-5.5** is OpenAI's current flagship generation — the strongest and most
expensive OpenAI subject in the catalog, and the model you reach for when you
want to see the ceiling of what the provider can do on a hard build. In The
Test Cabinet it runs through the **Codex** harness, which drives the model
against a benchmark case from a fresh, isolated repository.

As the top tier it sets the bar the smaller and older models are measured
against, and it pairs naturally with GPT-5.4: at roughly twice the per-token
price of the prior generation, GPT-5.5 is where the suite asks whether the
extra spend actually translates into a better game. The figures on its page are
the comparable per-token rates OpenRouter publishes, which The Test Cabinet
treats as the canonical, provider-stable cost of a run rather than the exact
charge billed."#,
        aliases: &[r#"gpt-5.5"#, r#"openai/gpt-5.5"#],
    },
    SeedModel {
        slug: r#"grok-4.3"#,
        display_name: r#"Grok 4.3"#,
        provider: r#"xAI"#,
        openrouter_slug: Some(r#"x-ai/grok-4.3"#),
        description_md: r#"**Grok 4.3** is xAI's current flagship Grok — a strong, general-purpose
frontier model positioned at the top of xAI's lineup and aimed squarely at
demanding reasoning and coding work. In The Test Cabinet it is reached through
OpenRouter and driven by one of the suite's OpenRouter-routed harnesses, which
points the model at a benchmark case inside a fresh, isolated repository.

As a frontier subject, Grok is interesting here as a head-to-head data point: it
lets the suite measure how xAI's flagship stacks up against the other heavyweight
models on the same case, under the same harness conditions. The figures on its
page are the comparable per-token prices OpenRouter reports, which The Test
Cabinet treats as the canonical cost of a run rather than the exact charge billed
by whichever provider served it."#,
        aliases: &[r#"x-ai/grok-4.3"#],
    },
    SeedModel {
        slug: r#"kimi-k2.7-code"#,
        display_name: r#"Kimi K2.7 Code"#,
        provider: r#"MoonshotAI"#,
        openrouter_slug: Some(r#"moonshotai/kimi-k2.7-code"#),
        description_md: r#"**Kimi K2.7 Code** is MoonshotAI's code-specialized variant of Kimi K2.7 — a
subject tuned specifically for software work rather than general chat. In The
Test Cabinet it is reached through **OpenRouter** and driven by one of the
suite's OpenRouter-routed harnesses, which exercises the model against a
benchmark case from a fresh, isolated repository.

A purpose-built coding model is a useful subject for the suite because it lets
the catalog ask whether specialization actually pays off on a large, open-ended
build: how a code-focused model compares against general-purpose frontier
models on the same case, and where its tuning helps or stops mattering. The
pricing on its page is the comparable per-token figure OpenRouter reports,
which The Test Cabinet treats as the canonical, provider-stable cost of a run."#,
        aliases: &[r#"moonshotai/kimi-k2.7-code"#],
    },
    SeedModel {
        slug: r#"mimo-v2.5-pro"#,
        display_name: r#"MiMo-V2.5-Pro"#,
        provider: r#"Xiaomi"#,
        openrouter_slug: Some(r#"xiaomi/mimo-v2.5-pro"#),
        description_md: r#"**MiMo-V2.5-Pro** is Xiaomi's higher "Pro" tier of the MiMo model — the more
capable MiMo subject in the catalog. In The Test Cabinet it is reached through
**OpenRouter** and driven by one of the suite's OpenRouter-routed harnesses,
which drives the model against a benchmark case from a fresh, isolated
repository.

Pairing the Pro tier with its standard sibling gives the suite a clean
within-family comparison: it shows what the step up in tier buys on a
substantial build, and lets the catalog place a less mainstream lineage against
the more familiar frontier models on the same case. Pricing shown on its page
is the comparable per-token cost reported by OpenRouter, which is what The Test
Cabinet uses for the canonical cost of a run rather than the exact provider
charge."#,
        aliases: &[r#"xiaomi/mimo-v2.5-pro"#],
    },
    SeedModel {
        slug: r#"mimo-v2.5"#,
        display_name: r#"MiMo-V2.5"#,
        provider: r#"Xiaomi"#,
        openrouter_slug: Some(r#"xiaomi/mimo-v2.5"#),
        description_md: r#"**MiMo-V2.5** is Xiaomi's standard-tier MiMo model — a less mainstream
subject than the usual frontier names, included here for breadth of coverage.
In The Test Cabinet it is reached through **OpenRouter** and driven by one of
the suite's OpenRouter-routed harnesses, which runs the model against a
benchmark case from a fresh, isolated repository.

A model from outside the most common providers is valuable precisely because
it widens the catalog: it shows how a standard-tier subject from a different
lineage holds up on a large coding task, and how far a strong harness can carry
it next to more familiar models on the same case. The pricing on its page is
the comparable per-token figure OpenRouter reports, which The Test Cabinet uses
as the canonical, provider-stable cost of a run."#,
        aliases: &[r#"xiaomi/mimo-v2.5"#],
    },
    SeedModel {
        slug: r#"minimax-m3"#,
        display_name: r#"MiniMax M3"#,
        provider: r#"MiniMax"#,
        openrouter_slug: Some(r#"minimax/minimax-m3"#),
        description_md: r#"**MiniMax M3** is MiniMax's current flagship in the M-series — a
general-purpose frontier model positioned at the top of its lineup. In The
Test Cabinet it is reached through **OpenRouter** and driven by one of the
suite's OpenRouter-routed harnesses, which puts the model to work against a
benchmark case from a fresh, isolated repository.

As a flagship subject, M3 is a natural high-end data point for the catalog: it
shows how a top-tier general-purpose model handles a substantial software task
when paired with a capable harness, and gives the suite a frontier reference
to weigh smaller or more specialized models against on the same case. Pricing
shown on its page is the comparable per-token cost reported by OpenRouter,
which is what The Test Cabinet uses for the canonical cost of a run rather than
the exact provider charge."#,
        aliases: &[r#"minimax/minimax-m3"#],
    },
    SeedModel {
        slug: r#"mistral-medium-3-5"#,
        display_name: r#"Mistral Medium 3.5"#,
        provider: r#"Mistral"#,
        openrouter_slug: Some(r#"mistralai/mistral-medium-3-5"#),
        description_md: r#"**Mistral Medium 3.5** is Mistral's mid-tier generalist — the balanced,
everyday member of the family, positioned below the flagship tier but well above
the small models on capability. It is the one to reach for when a case wants a
competent all-rounder at a moderate price rather than the most powerful engine
available. In The Test Cabinet it is reached through OpenRouter and driven by one
of the suite's OpenRouter-routed harnesses against a benchmark case in a fresh,
isolated repository.

A European frontier lab's mid-tier model is a useful contrast for the catalog:
it shows how a capable, cost-conscious generalist lands against the specialist
and flagship subjects on the same case, without the pricing of the top tier.
Pricing shown on its page is the comparable per-token cost reported by
OpenRouter, which is what The Test Cabinet uses for the canonical,
provider-stable cost of a run."#,
        aliases: &[r#"mistralai/mistral-medium-3-5"#],
    },
    SeedModel {
        slug: r#"pareto-code"#,
        display_name: r#"Pareto Code Router"#,
        provider: r#"OpenRouter"#,
        openrouter_slug: Some(r#"openrouter/pareto-code"#),
        description_md: r#"**Pareto Code Router** is OpenRouter's routing layer for coding work — not a
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
the canonical, provider-stable cost of a run."#,
        aliases: &[r#"pareto-code"#, r#"openrouter/pareto-code"#],
    },
    SeedModel {
        slug: r#"qwen3.7-max"#,
        display_name: r#"Qwen3.7 Max"#,
        provider: r#"Qwen"#,
        openrouter_slug: Some(r#"qwen/qwen3.7-max"#),
        description_md: r#"**Qwen3.7 Max** is the top "Max" tier of Alibaba's Qwen 3.7 family — the
largest and most capable Qwen subject in the catalog, positioned as the
flagship for demanding coding work. In The Test Cabinet it is reached through
OpenRouter and driven by one of the suite's OpenRouter-routed harnesses, which
puts the model against a benchmark case inside a fresh, isolated repository.

As a frontier-tier entry from Qwen, Max is interesting here as a high-water
mark for the family: it shows how far the strongest Qwen option can carry a
substantial build, and how it stacks up against flagship models from other
providers on the same case. The prices on its page are the comparable
per-token figures OpenRouter reports, which The Test Cabinet treats as the
canonical, provider-stable cost of a run."#,
        aliases: &[r#"qwen/qwen3.7-max"#],
    },
    SeedModel {
        slug: r#"qwen3.7-plus"#,
        display_name: r#"Qwen3.7 Plus"#,
        provider: r#"Qwen"#,
        openrouter_slug: Some(r#"qwen/qwen3.7-plus"#),
        description_md: r#"**Qwen3.7 Plus** is the mid "Plus" tier of Alibaba's Qwen 3.7 family — a
balanced capability-and-cost point that sits below the flagship Max while
remaining a serious coding subject. In The Test Cabinet it is reached through
OpenRouter and driven by one of the suite's OpenRouter-routed harnesses, which
runs it against a benchmark case from a fresh, isolated repository.

A mid-tier model is a useful data point precisely because it trades some
ceiling for cost: Plus shows how much of a substantial build a strong harness
can coax out of a balanced model, and where the gap to the heavier Max tier
begins to show on the same case. Pricing shown on its page is the comparable
per-token cost reported by OpenRouter, which is what The Test Cabinet uses for
the canonical cost of a run rather than the exact provider charge."#,
        aliases: &[r#"qwen/qwen3.7-plus"#],
    },
];
