-- | The only way material enters the agent's own context window.
-- |
-- | Under responses as code a whole program's output would otherwise collapse into one anonymous blob
-- | of logs, charged to one band, attributable to nothing and closable by nothing. A view restores
-- | what tool calling gave for free: one message per view, carrying the band it is charged to and the
-- | selector it can be closed by.
module Gg.Views
  ( openFile
  , openText
  , openDocsView
  , close
  , closeView
  , current
  , ViewKind(..)
  , ViewRegion
  , OpenView
  , OpenFileOptions
  ) where

import Prelude

import Data.Generic.Rep (class Generic)
import Data.Maybe (Maybe)
import Data.Show.Generic (genericShow)
import Effect (Effect)
import Gg.Files (FileRead(..))
import Gg.Internal.Read (fileRead)
import Gg.Internal.Wire as Wire
import Prim.Row (class Union)

-- | The window of lines a file view shows. Every field is optional; `{}` shows the whole file.
type OpenFileOptions = (offset :: Int, limit :: Int)

-- | Which of the three kinds a view is.
-- |
-- | The taxonomy is closed at three on purpose: everything on disk is a file, everything a program
-- | can compute is a string, and documentation is neither — gg holds it.
data ViewKind
  -- | A file that was opened; its selector is the path.
  = FileView
  -- | A computed value; its selector is the label it was given.
  -- |
  -- | A directory listing, a command's output, a child agent's answer and an assembled table are all
  -- | this.
  | TextView
  -- | An entry's documentation; its selector is that entry's key.
  | DocsView

derive instance Eq ViewKind
derive instance Generic ViewKind _
instance Show ViewKind where
  show = genericShow

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

-- | One view open in the context window right now.
-- |
-- | # Fields
-- |
-- | - `kind` — Whether it is a file, a text or a documentation view.
-- | - `selector` — What closes it: a file's path, a text view's label, or a documentation entry's key.
-- | - `tokens` — Roughly what holding it costs, in tokens.
-- | - `region` — The line window a paged file view covers.
-- |
-- |   `Nothing` for a whole-file view and for every text view.
type OpenView =
  { kind :: ViewKind
  , selector :: String
  , tokens :: Int
  , region :: Maybe ViewRegion
  }

-- | Read a file and place it in the context window, keyed by its path.
-- |
-- | The file becomes its own context item, attributed to its path and closable by it. The split from
-- | `Gg.Files.readFile` is the point: that call gets bytes for the program, this one puts a file in
-- | front of the model, so a program that reads forty files to grep them still costs no window.
-- |
-- | `offset` and `limit` select a window of lines, and two pages of one file are two views that
-- | coexist; re-opening the same page replaces what it showed rather than piling up a duplicate. An
-- | image file is displayed as a picture, and this is the only call that displays one — reading an
-- | image describes it without showing it.
-- |
-- | # Operation
-- |
-- | views.open_file
-- |
-- | # Arguments
-- |
-- | - `path` — The file to open, relative to the workspace or absolute.
-- | - `options` — The window of lines to show; `{}` shows the whole file.
-- | - `options.offset` — The 1-based line to start at.
-- | - `options.limit` — How many lines to show from `offset`.
-- |
-- | # Returns
-- |
-- | Exactly what `Gg.Files.readFile` hands back for the same file, so the program holds the
-- | contents as well as the model holding the view.
openFile
  :: forall given rest
   . Union given rest OpenFileOptions
  => String
  -> Record given
  -> Effect FileRead
openFile path options =
  fileRead TextFile ImageFile
    -- `read_file`, not `open_file`: the first argument is the GATE, and showing a file is a read gg
    -- also puts in the window, so it is `read_file` being withheld that this call refuses under.
    <$> Wire.call "read_file" "views" "Gg.Views.openFile" [ Wire.wire path, Wire.lower {} options ]

-- | Place a value the program computed in the context window, under a label.
-- |
-- | A directory listing, a command's output, a child agent's answer, an assembled table: this is the
-- | channel into the window, and a value a program computes reaches the model on no other. Opening
-- | the same label again replaces what it showed, so a program may refine a view in a loop without
-- | piling up a copy per iteration. An empty body is allowed, since it is how a program says that
-- | something it was showing is now empty.
-- |
-- | # Operation
-- |
-- | views.open_text
-- |
-- | # Arguments
-- |
-- | - `label` — What to file the view under. It is what closes the view, and opening the same label
-- |   again replaces what it showed. It may not be empty.
-- | - `body` — What to show. An empty body is allowed: it is how a program says that something it was
-- |   showing is now empty.
-- |
-- | # Throws
-- |
-- | `InvalidArgument` for an empty label — a view with no selector could never be closed or attributed
-- | — and `LimitExceeded`, naming the cap, for a body or label over gg's caps; nothing is ever
-- | silently truncated.
openText :: String -> String -> Effect Unit
openText label body =
  Wire.call_ "open_text" "views" "Gg.Views.openText" [ Wire.wire label, Wire.wire body ]

-- | Place one module's, function's or type's full documentation in the context window.
-- |
-- | Everything filed under it — its signature, its description, and the declarations of any types it
-- | refers to that have not already been shown this session. This is a **view** rather than a return
-- | value: the documentation arrives in the next prompt under a `Documentation` heading keyed by the
-- | entry's name, exactly as a file or a computed value arrives, so it is not available in the turn
-- | that asks for it. Asking in one turn and using it in the next is the shape that works. Opening an
-- | entry that is already open does nothing at all — not a move, not a second copy — since the
-- | documentation band only grows, and `Gg.Docs.close` is the one call that takes a page out of it.
-- |
-- | # Operation
-- |
-- | views.open_docs_view
-- |
-- | # Arguments
-- |
-- | - `name` — The entry to document, by its fully-qualified name — `"Gg.Files.readFile"` — or, for a
-- |   module, that module's own path — `"Gg.Files"`. Searching the documentation is what names the
-- |   entries that exist, and anything a search returns can be opened.
-- |
-- | # Throws
-- |
-- | `NotFound` for an unknown or unbound name.
openDocsView :: String -> Effect Unit
openDocsView name = Wire.call_ "open_docs_view" "views" "Gg.Views.openDocsView" [ Wire.wire name ]

-- | Close every view carrying a selector, freeing the tokens they occupied.
-- |
-- | Closing a file view forgets what was read rather than what exists; closing a text view discards
-- | the only copy of what it held, so anything needed later belongs in a file or a memory first.
-- |
-- | Documentation views are not reached from here. `Gg.Docs.close` is what takes one away, and it is
-- | bought by a capability of its own, `docview-close` — so a sweep that included them would hand back `0` for
-- | an agent that may not close one, which reads as a selector that named nothing.
-- |
-- | # Operation
-- |
-- | views.close
-- |
-- | # Arguments
-- |
-- | - `selector` — What the view is filed under: a file's path, a text view's label, or
-- |   `search results`.
-- |
-- | # Returns
-- |
-- | How many views were closed: for a file that is every page of that path, for a text view the one
-- | with that label, for the results of a search the label `search results`. A selector that is not
-- | open hands back `0` rather than failing, so a program that tidies up unconditionally needs no
-- | guard on every call.
-- |
-- | # Throws
-- |
-- | `InvalidArgument` for an empty selector, which names nothing rather than everything — no call
-- | here closes the window wholesale. `Unavailable` for an agent whose run did not buy
-- | `agent-managed-context`, the capability that buys closing a view and listing what is open.
close :: String -> Effect Int
close selector = Wire.call "close" "views" "Gg.Views.close" [ Wire.wire selector ]

-- | Close a view that is open, freeing the tokens it occupied.
-- |
-- | `Gg.Views.close` with the selector already taken out of the view, which is what lets a window be
-- | tidied by folding over what is in it rather than by writing out a selector per view.
-- |
-- | A documentation view is the one this does not take away, for the reason `Gg.Views.close` does
-- | not: `Gg.Docs.close` is the call for one of those, and it is bought by a capability of its own,
-- | `docview-close`.
-- |
-- | # Alias
-- |
-- | views.close
-- |
-- | # Arguments
-- |
-- | - `view` — The view to close, as `Gg.Views.current` listed it.
-- |
-- | # Returns
-- |
-- | How many views were closed, which for one page of a paged file is every page of that path.
closeView :: OpenView -> Effect Int
closeView view = close view.selector

-- | List what is open in the context window right now.
-- |
-- | What it enumerates is the context window's contents, not any module's functions. Reading it is
-- | what informs a decision about what to close when the window is filling up.
-- |
-- | # Operation
-- |
-- | views.current
-- |
-- | # Arguments
-- |
-- | (none)
-- |
-- | # Returns
-- |
-- | Each view's `kind`, the `selector` that closes it, roughly what it costs in `tokens`, and — for
-- | a paged file view — the `region` it covers.
-- |
-- | # Throws
-- |
-- | `Unavailable` for an agent whose run did not buy `agent-managed-context`, the capability that
-- | buys listing what is open and closing it.
current :: Effect (Array OpenView)
current = map openView <$> Wire.call "current" "views" "Gg.Views.current" []

-- | One open view. A paged file view carries the window it covers; nothing else does.
openView :: Wire.Wire -> OpenView
openView value =
  { kind: viewKind (Wire.text "kind" value)
  , selector: Wire.text "selector" value
  , tokens: Wire.field "tokens" value
  , region: Wire.optional "region" value
  }

-- | Which kind of view this is. The wire's set is closed at three and gg owns it, so the fallback
-- | exists only because the conversion has to be total.
viewKind :: String -> ViewKind
viewKind = case _ of
  "file" -> FileView
  "docs" -> DocsView
  _ -> TextView
