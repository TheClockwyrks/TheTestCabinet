-- | The `project` object: the epic/issue board.
-- |
-- | An issue is the heavyweight unit of work — its scope, non-scope and completion criteria are
-- | exactly what a delegated child agent is briefed from — which is why `createIssue` asks for more
-- | than `tasks.addTask` does.
-- |
-- | Two of its patch fields are **three-way**, and a record with optional fields says all three
-- | without a sentinel: leave `description` out to keep it, pass `Nothing` to clear it; leave
-- | `epicId` out to leave the grouping alone, pass `Nothing` to detach the issue from its epic.
module Gg.Project
  ( project
  , createEpic
  , createIssue
  , updateIssue
  , setIssueBlockedBy
  , removeEpic
  , removeIssue
  , waitForIssue
  , CreateIssueOptions
  , UpdateIssueOptions
  ) where

import Prelude

import Data.Maybe (Maybe)
import Data.Nullable (toNullable)
import Effect (Effect)
import Gg.Internal.Wire as Wire
import Gg.Meta (listOn)
import Gg.Types (BoardUsage, EpicCreated, FunctionSummary, IssueCreated, IssueStatus(..))
import Prim.Row (class Union)

-- | The parts of a new issue you may leave out.
type CreateIssueOptions =
  ( description :: String
  , blockedBy :: Array String
  , epicId :: String
  , reviewers :: Array String
  )

-- | The fields an issue revision may change. Leave one out to leave it alone.
type UpdateIssueOptions =
  ( title :: String
  , description :: Maybe String
  , inScope :: String
  , outOfScope :: String
  , completionCriteria :: String
  , status :: IssueStatus
  , epicId :: Maybe String
  )

-- | the epic/issue board — decompose work into dispatchable issues
project
  :: { createEpic ::
         { prefix :: String, title :: String, description :: String } -> Effect EpicCreated
     , createIssue ::
         forall given rest
          . Union given rest CreateIssueOptions
         => { title :: String
            , inScope :: String
            , outOfScope :: String
            , completionCriteria :: String
            , agent :: String
            | given
            }
         -> Effect IssueCreated
     , updateIssue ::
         forall given rest
          . Union given rest UpdateIssueOptions
         => String
         -> Record given
         -> Effect Unit
     , setIssueBlockedBy :: String -> Array String -> Effect Unit
     , removeEpic :: String -> Effect BoardUsage
     , removeIssue :: String -> Effect BoardUsage
     , waitForIssue :: String -> Effect String
     , list :: Effect (Array FunctionSummary)
     }
project =
  { createEpic
  , createIssue
  , updateIssue
  , setIssueBlockedBy
  , removeEpic
  , removeIssue
  , waitForIssue
  , list: listOn "project"
  }

-- | Create an epic to group related issues, and hand back the id its prefix resolved to together
-- | with the board budget.
-- |
-- | `prefix` is 3-6 letters naming the epic; it is upper-cased and becomes the epic's id, which is
-- | also what its issues are numbered from — a prefix of `auth` gives issues `AUTH-1`, `AUTH-2`, and
-- | so on.
-- |
-- | # Arguments
-- |
-- | - `epic` — The epic to create.
-- | - `epic.prefix` — 3-6 letters naming it. Upper-cased, it becomes the epic's id and the stem its
-- |   issues are numbered from.
-- | - `epic.title` — A short line naming the body of work.
-- | - `epic.description` — What the epic covers, for a reader who has not seen its issues.
-- |
-- | # Raises
-- |
-- | `InvalidArgument` when the prefix is not 3-6 letters, and `Conflict` when another epic already
-- | holds it.
createEpic
  :: { prefix :: String, title :: String, description :: String } -> Effect EpicCreated
createEpic epic = Wire.call "create_epic" "project" "createEpic" [ Wire.wire epic ]

-- | Create a self-contained, dispatchable issue, and hand back the id the board **assigned** it
-- | together with the board budget.
-- |
-- | The id is numbered under its epic's prefix (`AUTH-1`, `AUTH-2`, …), or under `ISSUE` when it has
-- | no epic; you do not choose it, so keep the returned one to block a later issue on this one or to
-- | wait for it. `inScope`, `outOfScope` and `completionCriteria` are what a child agent is briefed
-- | from, so write them for a reader with no other context. `agent` names the agent the issue is
-- | dispatched to and must be one you may spawn; `reviewers` names the agents that must approve the
-- | work, from that same set, and is required when this run's reviewers feature is on.
-- |
-- | # Arguments
-- |
-- | - `issue` — The issue to create.
-- | - `issue.title` — A short line naming the work.
-- | - `issue.description` — What the work is. Written for a child agent with no other context.
-- | - `issue.inScope` — What the issue covers, precisely. Part of the brief a child agent is given.
-- | - `issue.outOfScope` — What the issue deliberately does not cover, so the work stops where you
-- |   meant it to.
-- | - `issue.completionCriteria` — What must be true for the issue to be done. It is what a reviewer
-- |   checks the work against.
-- | - `issue.blockedBy` — The ids of every issue that must be done before this one. Defaults to
-- |   none.
-- | - `issue.epicId` — The id of an existing epic to group it under. Leave it out to leave the issue
-- |   ungrouped and numbered under `ISSUE`.
-- | - `issue.agent` — The agent the issue is dispatched to. It must be one you may spawn.
-- | - `issue.reviewers` — The agents that must approve the work, from that same set. Required when
-- |   this run's reviewers feature is on.
-- |
-- | # Raises
-- |
-- | `InvalidArgument` when `agent` or a reviewer is not yours to assign, and `Conflict` on a blocker
-- | edge that would close a cycle.
createIssue
  :: forall given rest
   . Union given rest CreateIssueOptions
  => { title :: String
     , inScope :: String
     , outOfScope :: String
     , completionCriteria :: String
     , agent :: String
     | given
     }
  -> Effect IssueCreated
createIssue issue = Wire.call "create_issue" "project" "createIssue" [ Wire.lower {} issue ]

-- | Revise an issue; supply at least one field.
-- |
-- | An omitted field is left alone, `description: Nothing` clears the description, and
-- | `epicId: Nothing` detaches the issue from its epic.
-- |
-- | # Arguments
-- |
-- | - `id` — The issue to revise.
-- | - `patch` — The fields to change. Supply at least one; an omitted field is left alone.
-- | - `patch.title` — The title to replace the old one with.
-- | - `patch.description` — `Just` the description to replace the old one with, or `Nothing` to
-- |   clear it.
-- | - `patch.inScope` — The scope statement to replace the old one with.
-- | - `patch.outOfScope` — The non-scope statement to replace the old one with.
-- | - `patch.completionCriteria` — The completion criteria to replace the old ones with.
-- | - `patch.status` — Where the issue now stands.
-- | - `patch.epicId` — `Just` the epic to regroup it under, or `Nothing` to detach it from the one
-- |   it has.
-- |
-- | # Raises
-- |
-- | `NotFound` for an unknown id.
updateIssue
  :: forall given rest
   . Union given rest UpdateIssueOptions
  => String
  -> Record given
  -> Effect Unit
updateIssue id patch =
  Wire.call_ "update_issue" "project" "updateIssue"
    [ Wire.wire id
    , Wire.lower
        { description: toNullable, epicId: toNullable, status: issueStatus }
        patch
    ]

-- | Replace an issue's whole blocker set; an empty array clears every blocker.
-- |
-- | # Arguments
-- |
-- | - `id` — The issue whose blockers to replace.
-- | - `blockedBy` — The ids of every issue that must now be done before it. An empty array clears
-- |   them all.
-- |
-- | # Raises
-- |
-- | `NotFound` for an unknown id, and `Conflict` when an edge would close a cycle.
setIssueBlockedBy :: String -> Array String -> Effect Unit
setIssueBlockedBy id blockedBy =
  Wire.call_ "set_issue_blocked_by" "project" "setIssueBlockedBy"
    [ Wire.wire id, Wire.wire blockedBy ]

-- | Remove an epic, keeping its issues and ungrouping them, and hand back the board budget.
-- |
-- | # Arguments
-- |
-- | - `id` — The epic to remove.
-- |
-- | # Raises
-- |
-- | `NotFound` for an unknown id.
removeEpic :: String -> Effect BoardUsage
removeEpic id = Wire.call "remove_epic" "project" "removeEpic" [ Wire.wire id ]

-- | Remove an issue and every blocker edge pointing at it, and hand back the board budget.
-- |
-- | # Arguments
-- |
-- | - `id` — The issue to remove.
-- |
-- | # Raises
-- |
-- | `NotFound` for an unknown id.
removeIssue :: String -> Effect BoardUsage
removeIssue id = Wire.call "remove_issue" "project" "removeIssue" [ Wire.wire id ]

-- | Register a wait on an issue and hand back an acknowledgement.
-- |
-- | It does not block inside your program — it records the wait and returns at once, so the rest of
-- | your program still runs; the suspension happens after the program ends, between turns. Once the
-- | program finishes the run suspends, freeing this agent's slot for others, until the issue is
-- | terminal (done, or failed if its assigned agent could not complete it), then resumes on the next
-- | turn. Use it to sequence your next turn's work behind an issue you depend on. You cannot wait on
-- | the issue you were assigned to implement.
-- |
-- | # Arguments
-- |
-- | - `id` — The issue to wait on. It may not be the issue you were assigned.
-- |
-- | # Raises
-- |
-- | `NotFound` for an unknown id.
waitForIssue :: String -> Effect String
waitForIssue id = Wire.call "wait_for_issue" "project" "waitForIssue" [ Wire.wire id ]

-- | gg's own word for a status, which is what both execution modes report.
issueStatus :: IssueStatus -> String
issueStatus = case _ of
  IssueOpen -> "open"
  IssueInProgress -> "in_progress"
  IssueDone -> "done"
