-- | The **model-facing** shapes this SDK's functions take and hand back.
-- |
-- | They are ordinary PureScript: a record where the value has fields, a `data` type where it is one
-- | of a fixed set of things, and `Maybe` where the wire may leave something out. A program reads
-- | `read.contents` and matches `case entry.kind of FileEntry -> …`, which is what makes the surface
-- | something a PureScript author can hold in their head rather than a WIT file rendered in
-- | PureScript syntax.
-- |
-- | Three conventions run through the whole file, and each one is a decision rather than a habit.
-- |
-- | * **A record is a record.** A PureScript record *is* a JavaScript object, so a result whose
-- |   fields are all plain crosses the bridge with no conversion at all — which is why these types
-- |   are synonyms rather than newtypes. `read.totalLines` is the field the host set.
-- | * **A fixed choice is a `data` type, never a string.** A model that guesses the spelling of a
-- |   string constant guesses wrong about as often as it guesses right, and a wrong string is a
-- |   branch that silently never runs. `TaskDone` is a name the compiler either knows or does not.
-- | * **Arms are prefixed by what they belong to** — `TaskDone` and `IssueDone`, `AgentTimedOut` —
-- |   because every one of these constructors is exported from the one `Gg` module a program
-- |   imports, and two types cannot both call an arm `Done` there.
-- |
-- | Documentation for a record's fields lives under a `# Fields` heading on the type rather than
-- | beside each field, because `purs` keeps a comment written on a declaration and discards one
-- | written on a record field. The catalogue is reflected from these comments, so what a model reads
-- | about a field is written here, on the type, and nowhere else.
module Gg.Types
  ( ShellOutput
  , FileRead(..)
  , TextFile
  , ImageFile
  , DirEntry
  , EntryKind(..)
  , MemoryUsage
  , MemoryHit
  , TaskStatus(..)
  , TaskUsage
  , IssueStatus(..)
  , BoardUsage
  , EpicCreated
  , IssueCreated
  , ReclaimReport
  , TurnRange
  , ArchiveHit
  , MessageRole(..)
  , ArchiveSearch
  , ViewKind(..)
  , ViewRegion
  , OpenView
  , Brief(..)
  , SubagentHandle
  , AgentEnding(..)
  , SubagentResult
  , ProgramSummary
  , FunctionSummary
  ) where

import Prelude

import Data.Generic.Rep (class Generic)
import Data.Maybe (Maybe)
import Data.Show.Generic (genericShow)

-- | What a command `system.shell` ran reported when it finished.
-- |
-- | # Fields
-- |
-- | - `exitCode` — The process's exit status; `Nothing` when a signal killed it. Zero means success.
-- | - `output` — Merged stdout-then-stderr, tail-truncated at 16 KiB — or, when the run offloads
-- |   shell output, at the configured line/character ceiling, with a note naming the files holding
-- |   the whole of it. Under the default `adaptive` mode a command that succeeded returns just that
-- |   note.
-- | - `truncated` — Whether the cap cut `output`, dropping the head and keeping the tail.
type ShellOutput =
  { exitCode :: Maybe Int
  , output :: String
  , truncated :: Boolean
  }

-- | What `fs.readFile` returned: a text file's window, or a picture's description.
-- |
-- | A picture is a different kind of thing from text, so it is a different arm rather than a string
-- | that happens to be binary — a program that treats an image as text is caught by the `case`
-- | instead of silently writing an empty string somewhere. Image *bytes* never enter the program: gg
-- | attaches the picture to the turn so you can look at it directly, which is worth far more than
-- | base64 in a variable.
data FileRead
  -- | This file is text.
  = TextFile TextFile
  -- | This file is a picture; gg shows it to you rather than handing you its bytes.
  | ImageFile ImageFile

-- | A text file's window, as the `TextFile` arm of a read carries it.
-- |
-- | # Fields
-- |
-- | - `contents` — The file's text, or just the requested window under a capped read policy.
-- | - `firstLine` — The 1-based first line returned.
-- | - `lastLine` — The 1-based last line returned.
-- | - `totalLines` — The file's total line count, so you know whether to page again.
-- | - `byteTruncated` — Whether a 256 KiB byte ceiling cut the returned text.
type TextFile =
  { contents :: String
  , firstLine :: Int
  , lastLine :: Int
  , totalLines :: Int
  , byteTruncated :: Boolean
  }

-- | A picture's description, as the `ImageFile` arm of a read carries it.
-- |
-- | # Fields
-- |
-- | - `mediaType` — The IANA media type (`image/png`, `image/jpeg`, `image/gif`, `image/webp`).
-- | - `label` — The short format label (`PNG`, `JPEG`, `GIF`, `WebP`).
-- | - `bytes` — The file's size in bytes.
-- | - `shown` — Whether the picture is being attached to this turn for you to look at.
-- | - `notShownReason` — Why it is not being shown; `Nothing` when `shown` is true.
type ImageFile =
  { mediaType :: String
  , label :: String
  , bytes :: Int
  , shown :: Boolean
  , notShownReason :: Maybe String
  }

-- | One entry `fs.listDir` found.
-- |
-- | # Fields
-- |
-- | - `name` — The entry's bare name, with no directory part. Join it with the directory you listed.
-- | - `kind` — What the entry is.
type DirEntry =
  { name :: String
  , kind :: EntryKind
  }

-- | What a directory entry is.
data EntryKind
  -- | An ordinary file.
  = FileEntry
  -- | A directory, which you can list in turn.
  | DirectoryEntry
  -- | Everything that is neither, a symlink among them.
  | OtherEntry

-- | How much of the run's durable-memory budget is used, after the call that returned it.
-- |
-- | Every maximum is optional: each limit can be turned off, and a run's memory strategy applies
-- | only some of them, so `Nothing` means nothing bounds that axis — check before subtracting.
-- |
-- | # Fields
-- |
-- | - `count` — Memories currently held.
-- | - `maxCount` — The most memories this run allows, if it limits the count.
-- | - `totalChars` — Characters of body currently held, across all memories.
-- | - `maxTotalChars` — The most characters of body this run allows in total, if it limits the
-- |   aggregate.
-- | - `indexChars` — Characters the memory index occupies, under a run that keeps one.
-- | - `maxIndexChars` — The most characters the index may occupy, if it is limited.
type MemoryUsage =
  { count :: Int
  , maxCount :: Maybe Int
  , totalChars :: Int
  , maxTotalChars :: Maybe Int
  , indexChars :: Maybe Int
  , maxIndexChars :: Maybe Int
  }

-- | One memory `memory.searchMemories` matched, and the numbers it was ranked by.
-- |
-- | # Fields
-- |
-- | - `name` — The memory's slug — what `memory.readMemory` takes.
-- | - `description` — Its description, or `""` when it was created without one.
-- | - `matched` — How many of your distinct keywords it matched — the primary ranking.
-- | - `occurrences` — How many times those keywords occur in it — the tiebreak.
-- | - `excerpt` — A short window of the memory around its first match.
type MemoryHit =
  { name :: String
  , description :: String
  , matched :: Int
  , occurrences :: Int
  , excerpt :: String
  }

-- | Where a task stands.
data TaskStatus
  -- | Not started. Every task begins here.
  = TaskPending
  -- | Being worked on now.
  | TaskInProgress
  -- | Finished. Tasks blocked on it become actionable once all their blockers are done.
  | TaskDone

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

-- | Where an issue stands.
data IssueStatus
  -- | Not started, and dispatchable once its blockers are done.
  = IssueOpen
  -- | Dispatched, with its assigned agent working on it.
  | IssueInProgress
  -- | Finished and, where this run requires reviewers, approved.
  | IssueDone

-- | How much of the run's board budget is used, after the call that returned it.
-- |
-- | # Fields
-- |
-- | - `epics` — Epics currently on the board.
-- | - `maxEpics` — The most epics this run allows.
-- | - `issues` — Issues currently on the board.
-- | - `maxIssues` — The most issues this run allows.
type BoardUsage =
  { epics :: Int
  , maxEpics :: Int
  , issues :: Int
  , maxIssues :: Int
  }

-- | An epic that was just created: the id its prefix resolved to, and the board budget.
-- |
-- | # Fields
-- |
-- | - `id` — The epic's id — the prefix you gave, upper-cased (`auth` → `AUTH`). Group issues under
-- |   it with this, and its issues are numbered from it (`AUTH-1`).
-- | - `board` — How much of the board budget is used.
type EpicCreated =
  { id :: String
  , board :: BoardUsage
  }

-- | An issue that was just created: the id the board assigned it, and the board budget.
-- |
-- | # Fields
-- |
-- | - `id` — The id the board assigned (`AUTH-1`) — you do not choose it. Use it to block later
-- |   issues on this one, or to wait for it.
-- | - `board` — How much of the board budget is used.
type IssueCreated =
  { id :: String
  , board :: BoardUsage
  }

-- | What a context reclaim actually freed from the live context window.
-- |
-- | # Fields
-- |
-- | - `items` — Context items dropped from the live window.
-- | - `reclaimedTokens` — Approximately how many tokens that freed.
-- | - `paths` — The workspace paths whose views were evicted. Empty for an archive.
-- | - `detail` — The prose summary of what was reclaimed.
type ReclaimReport =
  { items :: Int
  , reclaimedTokens :: Int
  , paths :: Array String
  , detail :: String
  }

-- | An inclusive span of turn numbers, the unit `context.archiveThread` moves out of the window.
-- |
-- | The numbers are the ones on the header of every result you are given, so `{ from: 4, to: 19 }`
-- | means exactly the turns you can see numbered 4 through 19 — both ends included.
-- |
-- | # Fields
-- |
-- | - `from` — The first turn in the span.
-- | - `to` — The last turn in the span, inclusive.
type TurnRange =
  { from :: Int
  , to :: Int
  }

-- | One archived message that matched a search.
-- |
-- | # Fields
-- |
-- | - `seq` — The archived message's sequence number.
-- | - `role` — Who said it.
-- | - `text` — The message text.
type ArchiveHit =
  { seq :: Int
  , role :: MessageRole
  , text :: String
  }

-- | Who said an archived message.
data MessageRole
  -- | The system prompt.
  = SystemMessage
  -- | A turn's input to you — a result, a view, or an operator's instruction.
  | UserMessage
  -- | Something you said.
  | AssistantMessage
  -- | A tool result, on a session that made tool calls rather than writing programs.
  | ToolMessage

-- | What `context.searchArchive` found.
-- |
-- | # Fields
-- |
-- | - `archiveEmpty` — Nothing has been archived yet, so there was nothing to search. Deliberately
-- |   distinct from a search that ran and matched nothing, so you do not archive again believing the
-- |   first archive failed.
-- | - `hits` — The matches, most recent first, at most 8.
type ArchiveSearch =
  { archiveEmpty :: Boolean
  , hits :: Array ArchiveHit
  }

-- | Which of the three kinds a view is.
-- |
-- | The taxonomy is closed at three on purpose: everything on disk is a file, everything a program
-- | can compute is a string, and documentation is neither — gg holds it.
data ViewKind
  -- | A file you opened; its selector is the path.
  = FileView
  -- | A value you showed yourself; its selector is the label you gave it. A directory listing, a
  -- | command's output, a child agent's answer and a table you assembled are all this.
  | TextView
  -- | A function's documentation; its selector is the function's name.
  | DocsView

-- | The window of lines a **paged** file view covers.
-- |
-- | # Fields
-- |
-- | - `offset` — The 1-based first line the view shows.
-- | - `limit` — How many lines it shows.
type ViewRegion =
  { offset :: Int
  , limit :: Int
  }

-- | One view open in your context window, as `view.current` reports it.
-- |
-- | # Fields
-- |
-- | - `kind` — Whether it is a file, text, or documentation view.
-- | - `selector` — What `view.close` takes: a file's path, a text view's label, or a docs view's
-- |   function name.
-- | - `tokens` — Roughly what holding it costs you, in tokens.
-- | - `region` — The line window a paged file view covers; `Nothing` for a whole-file view and for
-- |   text views.
type OpenView =
  { kind :: ViewKind
  , selector :: String
  , tokens :: Int
  , region :: Maybe ViewRegion
  }

-- | What a child agent is briefed with.
-- |
-- | The choice is the type rather than a pair of optional fields, so "both" and "neither" are
-- | programs that do not compile instead of calls that fail at run time.
data Brief
  -- | Self-contained instructions for the child, which needs no other context.
  = Prompt String
  -- | The id of a board issue to brief the child from, as `project.createIssue` returned it.
  | Issue String

-- | A child agent that was spawned and is now running in parallel.
-- |
-- | # Fields
-- |
-- | - `id` — The child's id — pass it to `agents.waitForSubagents` or `agents.sendMessage`.
-- | - `slot` — The agent profile it runs as.
-- | - `modelId` — The model actually bound to that agent.
type SubagentHandle =
  { id :: String
  , slot :: String
  , modelId :: String
  }

-- | How a child agent's loop ended — gg's own six words, as the tool-calling path also reports them.
data AgentEnding
  -- | It finished normally: it called `harness.finish`, and its summary is what it returned.
  = AgentCompleted
  -- | It hit the per-run turn ceiling.
  | AgentExhausted
  -- | It passed its wall-clock deadline.
  | AgentTimedOut
  -- | A model turn failed.
  | AgentModelError
  -- | The run's credential was refused.
  | AgentAuthError
  -- | An execution ceiling stopped it — consecutive errors, error rate, or cost.
  | AgentLimitExceeded

-- | One child agent's collected result.
-- |
-- | # Fields
-- |
-- | - `id` — The child's id.
-- | - `status` — How it finished; `Nothing` when it produced no return value at all.
-- | - `summary` — Its final message.
type SubagentResult =
  { id :: String
  , status :: Maybe AgentEnding
  , summary :: String
  }

-- | One program you have already run, as `programs.history` lists it.
-- |
-- | It describes the program's **shape**, never its source: a directory that inlined every program
-- | would put the whole session back in front of you, which is the one thing the library exists to
-- | avoid. Fetch the source you actually want with `programs.get`.
-- |
-- | # Fields
-- |
-- | - `turn` — The turn it ran on — what `programs.get` takes.
-- | - `lines` — How many lines of source it was.
-- | - `chars` — How many characters of source it was.
-- | - `ok` — Whether it ran to its end, with no uncaught failure and no sandbox ceiling stopping it.
-- | - `error` — The error it ended with, when it did not run to its end.
type ProgramSummary =
  { turn :: Int
  , lines :: Int
  , chars :: Int
  , ok :: Boolean
  , error :: Maybe String
  }

-- | One function in an API object's directory, as `list` returns it.
-- |
-- | The summary is one line; the whole documentation of a function — every shape it may be called
-- | in, what to put in each argument, and the types it refers to — is a view, opened with
-- | `view.openDocsView`.
-- |
-- | # Fields
-- |
-- | - `name` — The function name on its object — `readFile` in `fs.readFile`.
-- | - `summary` — One line saying what it does: the first sentence of its documentation.
type FunctionSummary =
  { name :: String
  , summary :: String
  }

derive instance Eq EntryKind
derive instance Generic EntryKind _
instance Show EntryKind where
  show = genericShow

derive instance Eq TaskStatus
derive instance Generic TaskStatus _
instance Show TaskStatus where
  show = genericShow

derive instance Eq IssueStatus
derive instance Generic IssueStatus _
instance Show IssueStatus where
  show = genericShow

derive instance Eq MessageRole
derive instance Generic MessageRole _
instance Show MessageRole where
  show = genericShow

derive instance Eq ViewKind
derive instance Generic ViewKind _
instance Show ViewKind where
  show = genericShow

derive instance Eq AgentEnding
derive instance Generic AgentEnding _
instance Show AgentEnding where
  show = genericShow

derive instance Eq Brief
derive instance Generic Brief _
instance Show Brief where
  show = genericShow

derive instance Eq FileRead
derive instance Generic FileRead _
instance Show FileRead where
  show = genericShow
