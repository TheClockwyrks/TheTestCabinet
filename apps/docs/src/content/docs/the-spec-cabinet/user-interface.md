---
title: "User Interface"
---

The Spec Cabinet's UI is organized around the suite being authored. Every page
belongs to one of five sections: the landing section, the app's settings, a
suite, a draft, or an exported version. Each section's pages are routed beneath
the section's root.

A marquee bar across the top of every page opens with The Test Cabinet's arcade
cabinet mark, drawn in the accent gradient, beside the app's name in the accent
color, followed by a breadcrumb trail. The trail runs from the landing page to the
page on screen.
Every segment but the last is a link, and the last names the current page.

Every section declares its breadcrumb trail and how it is left. A static exit
names the route the section always returns to. A dynamic exit returns to the
page the section was entered from, falling back to the page it declares when the
section was opened directly, such as by a typed URL or a reload in a fresh tab.
Only Settings, which every page opens, declares a dynamic exit.

Every section but the landing section replaces the mark with a back button. The
back button is the chevron icon alone, naming its target to the pointer and to a
screen reader.

A section's sidebar holds only links to the section's pages and the labels
grouping them.

Leaving a page that holds unsaved changes asks first, whatever raised the
departure. The dialog offers three answers: Cancel stays on the page with the
changes as they are, Discard leaves and drops them, and Save writes them and
leaves once the write has landed. A refused save keeps the dialog open with the
failure beneath its message and the changes intact.

The bar's actions are icons for Workflows, Chat, and Settings, each naming
itself to the pointer and to a screen reader. The Workflows icon carries the
number of running [workflow runs](#running-workflows), and the Chat icon carries
a dot while the assistant is running. Each figure is in its action's name.

The status area is a strip along the bottom of every page. It names each thing
the backend is running against, including the settings file, and marks whether
each is in place.

The strip carries a Check again action and a Details action. Details opens a
panel with every check's full report, showing what a failing check makes
unavailable and the command that fixes it. The panel opens only on Details, and
a check needing a fix is marked on the strip alone.

The report is read again by itself every thirty seconds, and returning to the
window reads it once that interval has passed. Check again and a save read it at
once and push the next read by itself a full thirty seconds out.

The panel is a drawer that slides up out of the strip, over a page that stays
interactive beneath it. It closes on the Hide details action, on Escape, which
leaves focus on the Details action, on a click anywhere outside the status area,
and on following a link in a row's detail.

The [chat sidebar](#chat-sidebar) docks along the right edge of every page, and a
Chat toggle in the marquee bar opens and collapses it.

The Spec Cabinet shares The Test Cabinet's synthwave arcade theme: the
`@clockwyrks/ui` palette tokens, monospace type, and neon-outlined surfaces,
with a pixel display face for marquees. It is designed for desktop browsers
only.

The theme is carried by appearance and flavor text. Every heading, label,
action, and state uses the plain name of what it shows or does, so a page reads
the same with the theme removed.

A choice among options is made by selecting the option's whole element, not a
checkbox or radio beside a label. A single-choice group selects one element and
deselects the rest. A multiple-choice group toggles each element on its own.

```text
/                                     → Landing
/new                                  → New Suite wizard
/settings                             → Settings
/suites/{slug}                        → Suite
/suites/{slug}/drafts/{draft}         → Draft
/suites/{slug}/versions/{version}     → Exported version
```

## Landing

The landing section is the first page The Spec Cabinet shows. It presents the
checkout's suites as a floor of arcade cabinets, and selecting one brings in a
panel beside the floor describing that suite.

Each cabinet carries the suite's name on its marquee and its slug beneath its
screen. The screen shows the newest exported version, the number of drafts, and
the suite's state:

- manifest problem, when its suite manifest carries a problem;
- no drafts, when it holds none;
- ready, when none of its drafts carries a problem;
- otherwise, the number of problems its drafts carry.

A New Suite cabinet is always first on the floor, and a search field above the
floor filters the cabinets by name or slug. The selected suite is held in the
URL as `/?suite=<slug>`.

Selecting a cabinet shows the suite's details in the panel:

- its name and slug;
- its drafts, each with its base, problem count, and last save;
- its exported versions, newest first;
- the newest exported version's summary and tags.

An Open action loads the suite at `/suites/{slug}`, and opening a draft or
version row goes directly to that draft or version. The floor reports a failure
to read the checkout and a `?suite=` naming a slug the checkout lacks, and it
offers New Suite in an empty checkout, so creating a suite is the first thing a
user can do there.

Selecting a suite with a manifest problem shows its problems in the panel. When its `suite.toml`
cannot be parsed, the panel also offers an action to repair its name, which
rewrites the suite manifest.

### New Suite wizard

New Suite opens a stepped wizard at `/new` with Back and Next. Its entries are
kept for the session until the suite is created, so leaving the wizard and
returning keeps them. Only Identity is required, and About can be skipped.

1. Identity takes the display name and the slug. The slug is derived from the
   name until the user edits it, and it is checked for kebab-case and
   availability as it is typed.
2. About takes the one-line summary and tags written to `version.toml`, and the
   description prose written to `description.md`.
3. Review shows every entry and the files Create will write.

The wizard creates the suite and its `main` draft, holding only what About
supplies. Test case definitions are authored afterwards in the draft's Test
Cases editor, and each definition declares the engines it offers. One
definition may offer 2D and 3D engines together.

Create writes the suite with everything the wizard collected and opens the
`main` draft's Specifications editor.

## Settings

Settings is a section rooted at `/settings`, holding the pages that configure this
machine. Opening it lands on Models. Its sidebar links Models, Agents and
Reference. Each page reads what it edits, so a failure in one page
leaves the others usable. Leaving Settings returns to the page it was opened
from, and to the landing page when it was opened directly.

### Models

Models, at `/settings/models`, edits the models workflows and the assistant run
on, and names the settings file it saves to, which lives outside the test suites
checkout. The slot fields and the per-workflow table are saved together, since
one save carries both.

- The code, prose, and assistant models are each a text field showing the model
  in use, with the slot's default beneath it and a Reset to default action.
- Models by workflow lists every workflow with its summary, its slot, an
  optional model of its own, and the model it runs on. A blank field inherits
  the slot's model, and Reset clears it.

Every model field is free text. When OpenRouter's model listing can be reached,
the fields suggest its model ids. A field holding an id that is not
`provider/model` is marked and blocks Save.

### Agents

Agents, at `/settings/agents`, lists the assistant and every workflow. Choosing
one opens its configuration at `/settings/agents/{agent}`: the configuration
slides in from the right over the list, and its header names the agent and
carries a back control that slides the list back. A preference for reduced motion
replaces the slide with an immediate swap. Focus lands on the heading of the pane
that arrives, whichever way it arrived.

The configuration is a form over every field of the agent's
[configuration](/the-spec-cabinet/harness/#agent-configuration), grouped as
limits, execution, opening turn, context, reads, output, loop detection,
compaction, and grants. The language and responses-as-code fields and the
opening turn group appear when the execution mode is responses as code, the
detector's figures appear when loop detection is enabled, and the headroom and
retry fields appear when compaction is enabled. The opening turn group holds a
List module switch for each module the agent holds a function in, and beneath it
an Open documentation choice for each held function of that module, toggled on
its own.

The grants group is one section per module of the agent's surface. A section
names its module, carries the module's own grant, and lists that module's
operations, each a row saying in one line what the operation allows the agent to
do and linking to it in Reference. A section whose module grant is held shows
every row in it as granted and beyond individual choice; so does a row the agent
holds whatever its grants say, whose line names the condition holding it, such as
compaction or responses as code. Switching a module grant off restores the rows
that were chosen on their own. An operation the agent's kind cannot perform is
absent. Writes and Checks are sections of the same shape, each with a control
selecting every value.

Each field shows its committed value beneath it when the local file overrides
it, with a Reset action that removes the override. While anything differs from
what was last saved, an action bar stays in view at the foot of the form, names
the groups that have changed, and offers Apply and Revert. Apply writes the local
configuration file, which the form names, and Revert restores the form to what
was saved.

### Reference

Reference browses the agent surface this build offers. What it shows is projected
from the running backend's own definitions rather than written beside them, so it
describes the build that is running and a reworded description reaches the reader
by being reworded once. It is the whole pool the build can offer rather than one
agent's share, and every gate on an entry is written as a condition rather than as
an answer.

Four tabs, each its own address so a tab is a link, with the entry selected within
it in the query string: Operations at `/settings/reference/operations`
(`?operation=`), Tools at `/settings/reference/tools` (`?tool=`), SDK at
`/settings/reference/sdk` (`?fn=` beside `?lang=`), and Skills at
`/settings/reference/skills` (`?skill=`). Opening `/settings/reference` lands on
Operations. An address naming an entry this build does not carry says so rather
than landing the reader on a neighbour.

Every tab is a tree beside a detail pane. Operations groups by module, Tools files
each operation under the tool that offers it, SDK groups by the catalogue's modules
with an arm picker above the tree whose pick survives a flip to another tab, and
Skills lists each skill by name. A filter above the tree matches names and
descriptions and hides the rows that do not match, captioned to say that it hides
rather than ranks.

The detail pane is built from three registers, so the reader always knows where the
text came from. Model-facing text is verbatim in a preformatted block: an
operation's description, a tool's description, a documentation view's body, and a
skill's prose. A schema is a code block. A parameter list read off that schema is
the page's own reading and is marked as such.

An operation's pane states its effect, the entity kind it writes, whether it is
engine bound, and the route or agent origin it performs. It names the tool that
offers it and the value that tool spells it by, the SDK function that binds it on
the selected arm, and every agent that holds it, each linking to its own entry or to
that agent's configuration. An operation no agent holds says so. An argument schema
is built for a reading configuration and a tool description folded from a call
output configuration, so the pane states the ones it was projected for: a run bounds
both by its own agent's configuration.

### Saving

Saved settings and configurations apply to the next workflow run and the next
chat message. A settings file or configuration that cannot be used is reported at
the top of the page editing it, and saving that page replaces it. An override the
settings file names for a workflow the build does not carry is reported above the
workflow table and dropped by the next save. A save refreshes the status area. The
Workflows page of a draft shows each workflow's effective model and links here.

## Running workflows

The Workflows action in the marquee bar opens a list of every running workflow
run in the checkout, whether the user or the assistant started it. Each row names the
suite, draft, workflow, and target, and shows the run's elapsed time and cost,
both updating live. A Stop action cancels the run at its next turn boundary, and
opening a row shows the run in its draft's run panel. A run leaves the list when
it ends. The developer overlay reads a run in full, whichever runtime it belongs
to.

## Developer overlay

The developer overlay is where a developer watches everything this machine is
running at once: a workflow run in any suite, and the assistant's conversation
runs beside them. It reads across the checkout rather than one draft, and it opens
over whatever page is showing, so watching a run costs no navigation and loses no
editing context. It ships in every build.

The `~` key toggles it from every page. The keystroke is ignored while focus sits
in a text field, so a tilde typed into the composer or an editor reaches the field
rather than the overlay. The pane takes most of the viewport and tints and blurs
the rest of the page behind it. Escape, the close button, and a click outside the
pane each dismiss it. Focus moves into the overlay while it is open and returns to
the element that had it when it closes.

The overlay is four panes:

- Dashboard is the machine-wide read-out: the runs in flight, the turns and spend
  across them, the runs that ended recently with their outcomes, and the error
  turns among them ranked by kind. Each row opens the run in Runs, and a workflow
  row links to its draft's run panel.
- Agents reports the assistant and then each workflow, each with its runs in
  flight, its turns, its spend, the model its slot resolves to, the peak context
  any of its runs reached, and a link to its configuration.
- Runs follows one run of either runtime from its first turn: its header, its
  figures, its feed of turns, calls and results, its phase and output tokens while
  a turn is in flight, its context occupancy against its window, its checks, and
  its outcome.
- Reference mounts the [Reference](#reference) surface.

## Suite

The suite section is rooted at `/suites/{slug}` and holds the pages that apply to
a suite as a whole. Opening a suite lands on Drafts.

- Drafts lists the suite's drafts with each draft's base, problem count, and last
  save. It creates a draft from nothing, from an exported version, or from
  another draft, and it rebases or discards an existing draft. Selecting a draft
  opens the draft section.
- Versions lists the suite's exported versions, newest first. Each version opens
  the exported version section or starts a new draft from that version.
- Runs lists the runs the local stack holds of the suite's test case
  definitions and the runs imported into the checkout, and imports a run as
  described in [Assets](/the-spec-cabinet/assets/#importing-assets).
- Publish lists each exported version and preview with what the chosen target
  holds of it, and publishes a version, the suite, the changed catalog, or
  everything. The target is the local stack by default, or the staging or
  production environment. A deployed environment reads its catalog from the tip
  of a superrepo branch, so a publish to one pushes the test suites repository
  and that branch, and the page shows those pushes for confirmation before it
  starts. Production is chosen only once its name is typed.
- Settings edits the suite manifest's display name.

## Draft

The draft section is rooted at `/suites/{slug}/drafts/{draft}` and is where
authoring happens. The breadcrumb trail names the suite and the draft. The
sidebar links one page per editor, followed by Problems, Export and Workflows.

- Manifest, Specifications, Validators, Debug API, Test Cases, Demonstrations,
  Assets, Reference Implementations, and Showcase each edit one entity group of
  the draft. Each editor is usable on an empty draft, and an editor whose entity
  group has no content presents the action that creates its first entity.
- Problems lists every problem in the draft grouped by entity, and each problem
  links to the editor that resolves it. Each editor's sidebar link shows the
  number of problems attributed to its entities.
- Export shows the comparison with the draft's base, the version numbers
  available to the draft, and the Export and Preview actions. Export is enabled
  once the draft has no problems, and Preview once the draft holds a complete
  test case definition.

## Exported version

The exported version section is rooted at `/suites/{slug}/versions/{version}`.
It presents the same editors as the draft section in read-only form, beneath a
notice offering an action that creates a draft from the version.

## Undo and redo

Every editor of a draft or a suite manifest carries Undo and Redo actions in its
header, bound to Ctrl+Z and Ctrl+Shift+Z (Cmd on macOS) while focus is within the
editor, text fields included. Each action's tooltip names the step it takes back
and whether the user, the assistant, a workflow run, or a change on disk made it.

A value awaiting confirmation from the backend renders in a muted tone. When an
edit is discarded because its resource changed, a notice says so and offers the
discarded text to copy or re-apply. The mechanics are defined in
[Collaboration](/the-spec-cabinet/collaboration/#undo-and-redo).

## Chat sidebar

The chat sidebar is a right-hand column beside the page outlet on every page,
where the user talks to the [assistant](/the-spec-cabinet/chat/). The user sets
how wide the column is by dragging its left border, within bounds that keep both
the page and the sidebar usable. The chosen width and whether the sidebar is open
are both remembered per browser. The sidebar sits outside the pages, so the
composer's text, the open conversation, the pane it is left on, and a running run
all persist as the user navigates.

The sidebar is two panes and shows one at a time. It opens on its conversations,
where each row names a conversation, when it was created, and whether it has a
run in flight, and reopens or deletes it. A New conversation action sits above
the list. Opening a conversation or starting one slides the sidebar to that
conversation, and the back button in the conversation's top bar slides back to
the list.

A conversation holds:

- A top bar with the back button, the conversation's title, and a context meter.
- The transcript of user messages, progress notes, and assistant messages. Each
  operation call, whether from a tool or a program, is one line naming the
  operation and the entity it targets. A program that failed to compile or run is
  marked with its error, and each compaction is one line. A call that
  changed an entity links to that entity's editor, and a refused, conflicting, or
  failed call is marked with its outcome.
- An activity indicator during a run, with a live output token count and a
  glyph for the phase: `↑` while the request is in flight with nothing back yet,
  `↓` while the response arrives with reasoning included, and a processor while
  calls run, the prompt is built, or the context is compacted.
- A usage line under each run's final message showing input tokens, the
  percentage served from the prompt cache, output tokens, and cost. A run whose
  model calls reported no usage shows no line.
- The composer, one field carrying its send action inside it. Enter sends and
  Shift+Enter inserts a new line, and the action becomes Stop during a run.

The context meter is a small ring comparing the conversation's context occupancy
with the window the assistant works against, after its context window override
and compaction headroom. It shifts to a
warning color and then a danger color as it fills, and hovering it reports the
figures and the percentage. The meter appears once both figures are known.

When `OPENROUTER_API_KEY` is unset, the settings file or the assistant's
configuration cannot be used, or the assistant's context window cannot be
determined, the
composer is replaced by the status area's report of the problem and the command
or page that fixes it.
