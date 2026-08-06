-- | **gg's surface, in one import.**
-- |
-- | ```
-- | module Main where
-- |
-- | import Prelude
-- | import Data.Array (filter)
-- | import Effect (Effect)
-- | import Gg
-- |
-- | main :: Effect Unit
-- | main = do
-- |   entries <- fs.listDir { path: "src" }
-- |   let sources = filter (\entry -> entry.kind == FileEntry) entries
-- |   built <- system.shell "cargo build" {}
-- |   view.openText "build" built.output
-- |   harness.finish ("looked at " <> show sources)
-- | ```
-- |
-- | Everything a program may call hangs off one of a handful of **API objects** — `fs`, `system`,
-- | `project`, `tasks`, `memory`, `view`, `context`, `agents`, `skills`, `programs`, `harness`,
-- | `review` — and every one of them is a record of functions, so `fs.readFile` is a field access and
-- | an application rather than a name you have to remember the module of. Each object also carries a
-- | `list`, which is the directory of what that object really bound for this run.
-- |
-- | The objects a run does **not** offer are still names this module exports: a program that calls
-- | one gets a `ToolError` carrying `Unavailable` rather than a compile error, because what a run
-- | enables is decided per run and this SDK is compiled once. What every object's `list` reports, and
-- | what the system prompt describes, is what this run actually has.
-- |
-- | Three things every program here obeys, and none of them is a preference:
-- |
-- | * **Every call is synchronous.** There is no `Aff` and no event loop; a call is an `Effect` that
-- |   is done when it returns.
-- | * **A returned value is discarded.** The way a program shows itself something is
-- |   `view.openText`; `Effect.Console.log` goes to the run's operator, not to you.
-- | * **A failure is thrown, not returned.** Catch the ones you expect with `attempt` and branch on
-- |   the `code`; let the rest escape, and gg reports which call failed.
-- |
-- | Each `module` below re-exports exactly the one name this module imported from it — the object —
-- | which is how PureScript spells "this is the door, and there is nothing else behind it".
module Gg
  ( module Gg.Fs
  , module Gg.System
  , module Gg.Project
  , module Gg.Tasks
  , module Gg.Memory
  , module Gg.View
  , module Gg.Context
  , module Gg.Agents
  , module Gg.Skills
  , module Gg.Programs
  , module Gg.Harness
  , module Gg.Review
  , module Gg.Lib
  , module Gg.Types
  , module Gg.Error
  ) where

import Gg.Agents (agents)
import Gg.Context (context)
import Gg.Error (ToolError, ToolErrorCode(..), attempt, toolError, toolErrorCode)
import Gg.Fs (fs)
import Gg.Harness (harness)
import Gg.Lib (lib)
import Gg.Memory (memory)
import Gg.Programs (programs)
import Gg.Project (project)
import Gg.Review (review)
import Gg.Skills (skills)
import Gg.System (system)
import Gg.Tasks (tasks)
import Gg.Types
  ( AgentEnding(..)
  , ArchiveHit
  , ArchiveSearch
  , BoardUsage
  , Brief(..)
  , DirEntry
  , EntryKind(..)
  , EpicCreated
  , FileRead(..)
  , FunctionSummary
  , ImageFile
  , IssueCreated
  , IssueStatus(..)
  , MemoryHit
  , MemoryUsage
  , MessageRole(..)
  , OpenView
  , ProgramSummary
  , ReclaimReport
  , ShellOutput
  , SubagentHandle
  , SubagentResult
  , TaskStatus(..)
  , TaskUsage
  , TextFile
  , TurnRange
  , ViewKind(..)
  , ViewRegion
  )
import Gg.View (view)
