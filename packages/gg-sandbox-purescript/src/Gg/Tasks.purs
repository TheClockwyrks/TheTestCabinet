-- | The task list, which is a directed acyclic graph rather than a list of lines.
-- |
-- | A task is the lightweight unit of work: an id, a title, and the tasks that must finish first. A
-- | unit heavy enough to brief a child agent from belongs on `Gg.Board` instead.
-- |
-- | One spelling here is worth reading twice. A revision's `description` is a **three-way** edit, and
-- | a record with optional fields says all three without a sentinel: leaving the field out keeps the
-- | description, `Nothing` clears it, `Just` replaces it.
module Gg.Tasks
  ( addTask
  , updateTask
  , setBlockedBy
  , completeTask
  , removeTask
  , list
  , TaskStatus(..)
  , TaskUsage
  , AddTaskOptions
  , UpdateTaskOptions
  ) where

import Prelude

import Data.Generic.Rep (class Generic)
import Data.Maybe (Maybe)
import Data.Nullable (toNullable)
import Data.Show.Generic (genericShow)
import Effect (Effect)
import Gg.Core (FunctionSummary)
import Gg.Internal.Directory (directory)
import Gg.Internal.Wire as Wire
import Prim.Row (class Union)

-- | The parts of a new task that may be left out.
type AddTaskOptions = (description :: String, blockedBy :: Array String)

-- | The fields a task revision may change. Leaving one out leaves it alone.
type UpdateTaskOptions =
  (title :: String, description :: Maybe String, status :: TaskStatus)

-- | Where a task stands.
data TaskStatus
  -- | Not started. Every task begins here.
  = TaskPending
  -- | Being worked on now.
  | TaskInProgress
  -- | Finished. Tasks blocked on it become actionable once all their blockers are done.
  | TaskDone

derive instance Eq TaskStatus
derive instance Generic TaskStatus _
instance Show TaskStatus where
  show = genericShow

-- | How much of the run's task budget is used, after the call that returned it.
-- |
-- | # Fields
-- |
-- | - `count` — Tasks currently on the list.
-- | - `maxTasks` — The most tasks this run allows.
type TaskUsage =
  { count :: Int
  , maxTasks :: Int
  }

-- | Add a task to the task graph and hand back the task budget.
-- |
-- | `blockedBy` names the tasks that must finish before this one and defaults to none.
-- |
-- | # Operation
-- |
-- | tasks.add_task
-- |
-- | # Arguments
-- |
-- | - `task` — The task to add.
-- | - `task.id` — The id chosen for it. It is what every other task call takes, and no two tasks may
-- |   share one.
-- | - `task.title` — A short line naming the work.
-- | - `task.description` — What the work is, at whatever length is useful.
-- | - `task.blockedBy` — The ids of the tasks that must be done before this one. Defaults to none.
-- |
-- | # Raises
-- |
-- | `Conflict` on a duplicate id or on an edge that would close a cycle.
addTask
  :: forall given rest
   . Union given rest AddTaskOptions
  => { id :: String, title :: String | given }
  -> Effect TaskUsage
addTask task = Wire.call "add_task" "tasks" "Gg.Tasks.addTask" [ Wire.lower {} task ]

-- | Revise a task's title, description or status, changing at least one of them.
-- |
-- | An omitted `description` leaves it alone, `Nothing` clears it, and `Just` replaces it.
-- |
-- | # Operation
-- |
-- | tasks.update_task
-- |
-- | # Arguments
-- |
-- | - `id` — The task to revise.
-- | - `patch` — The fields to change. At least one is required; an omitted field is left alone.
-- | - `patch.title` — The title to replace the old one with.
-- | - `patch.description` — `Just` the description to replace the old one with, or `Nothing` to clear
-- |   it.
-- | - `patch.status` — Where the task now stands.
-- |
-- | # Raises
-- |
-- | `NotFound` for an unknown id.
updateTask
  :: forall given rest
   . Union given rest UpdateTaskOptions
  => String
  -> Record given
  -> Effect Unit
updateTask id patch =
  Wire.call_ "update_task" "tasks" "Gg.Tasks.updateTask"
    [ Wire.wire id
    , Wire.lower { description: toNullable, status: taskStatus } patch
    ]

-- | Replace a task's whole blocker set; an empty array clears every blocker.
-- |
-- | # Operation
-- |
-- | tasks.set_blocked_by
-- |
-- | # Arguments
-- |
-- | - `id` — The task whose blockers to replace.
-- | - `blockedBy` — The ids of every task that must now be done before it. An empty array clears them
-- |   all.
-- |
-- | # Raises
-- |
-- | `NotFound` for an unknown id, and `Conflict` when an edge would close a cycle.
setBlockedBy :: String -> Array String -> Effect Unit
setBlockedBy id blockedBy =
  Wire.call_ "set_blocked_by" "tasks" "Gg.Tasks.setBlockedBy" [ Wire.wire id, Wire.wire blockedBy ]

-- | Mark a task done.
-- |
-- | Tasks it was blocking become actionable once every one of their blockers is done.
-- |
-- | # Operation
-- |
-- | tasks.complete_task
-- |
-- | # Arguments
-- |
-- | - `id` — The task to mark done.
-- |
-- | # Raises
-- |
-- | `NotFound` for an unknown id.
completeTask :: String -> Effect Unit
completeTask id = Wire.call_ "complete_task" "tasks" "Gg.Tasks.completeTask" [ Wire.wire id ]

-- | Remove a task and every blocker edge pointing at it.
-- |
-- | # Operation
-- |
-- | tasks.remove_task
-- |
-- | # Arguments
-- |
-- | - `id` — The task to remove.
-- |
-- | # Raises
-- |
-- | `NotFound` for an unknown id.
removeTask :: String -> Effect TaskUsage
removeTask id = Wire.call "remove_task" "tasks" "Gg.Tasks.removeTask" [ Wire.wire id ]

-- | List the functions this module offers, each with a one-line summary.
-- |
-- | Only the functions this run actually bound are returned, so the directory never names a call the
-- | program cannot make. One function's full signature, argument descriptions and types are opened as
-- | a view with `Gg.Views.openDocsView`.
-- |
-- | # Arguments
-- |
-- | (none — the module is the one the directory is declared in)
list :: Effect (Array FunctionSummary)
list = directory "Gg.Tasks.list" [ "tasks" ]

-- | gg's own word for a status, which is what both execution modes report.
taskStatus :: TaskStatus -> String
taskStatus = case _ of
  TaskPending -> "pending"
  TaskInProgress -> "in_progress"
  TaskDone -> "done"
