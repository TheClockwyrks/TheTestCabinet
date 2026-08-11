-- | Find what the agent can call, and take a documentation view back out of the window.
-- |
-- | The system prompt names modules and no function at all, so this is the module every other one is
-- | reached through: `search` turns a keyword or a module id into fully-qualified names, and
-- | `Gg.Views.openDocsView` reads one of those names in full.
-- |
-- | Searching is bound in every program whatever a run enables, because an agent must always be able
-- | to find the functions it does hold. Closing a documentation view is the exception and is bought
-- | by a capability: opening one only ever appends to the prompt, while closing one rewrites its
-- | middle, and those are different enough trades to be different decisions.
module Gg.Docs
  ( search
  , close
  , closeAll
  , DocKind(..)
  , DocHit
  , DocSearch
  , SearchOptions
  ) where

import Prelude

import Data.Generic.Rep (class Generic)
import Data.Show.Generic (genericShow)
import Effect (Effect)
import Gg.Internal.Wire as Wire
import Prim.Row (class Union)

-- | The filters and the page a search may narrow itself with. Every field is optional; `{}` ranks
-- | the query alone.
type SearchOptions =
  ( module :: String
  , type :: String
  , kind :: DocKind
  , offset :: Int
  , limit :: Int
  )

-- | Which of the two kinds of thing a documentation entry describes.
data DocKind
  -- | A function a program calls.
  = FunctionEntry
  -- | A type a function takes or hands back.
  | TypeEntry

derive instance Eq DocKind
derive instance Generic DocKind _
instance Show DocKind where
  show = genericShow

-- | One entry a search matched: enough to choose from, and no more.
-- |
-- | # Fields
-- |
-- | - `key` — The fully-qualified name `Gg.Views.openDocsView` takes to read the whole entry.
-- | - `kind` — Whether it is a function or a type.
-- | - `module` — The module it lives in.
-- |
-- |   A function has exactly one. A type shows every module in which a function the agent can call
-- |   mentions it — never one nothing is held in, and comma-separated when there are several, which
-- |   makes it a description rather than something to pass back as `options.module`.
-- | - `name` — The name a program calls it by, or the type's own name.
-- | - `summary` — Its one-line brief, and only that. The rest is what a documentation view holds.
type DocHit =
  { key :: String
  , kind :: DocKind
  , module :: String
  , name :: String
  , summary :: String
  }

-- | A page of search results, with the total behind it.
-- |
-- | # Fields
-- |
-- | - `total` — How many entries matched before paging, which tells a capped page from a complete
-- |   answer.
-- | - `offset` — The offset this page starts at, echoed back.
-- | - `hits` — The page itself, best first.
type DocSearch =
  { total :: Int
  , offset :: Int
  , hits :: Array DocHit
  }

-- | Search every function and type the agent can call, by keyword and by filter.
-- |
-- | This is how a name is found. Matching is a case-insensitive substring over names, signatures,
-- | briefs and detailed descriptions, so `docs` finds `openDocsView`. Ranking is by the kind of evidence
-- | that matched — an entry whose own name matched outranks one that merely mentions the word in a
-- | paragraph — and a weaker kind never overtakes a stronger one however often it occurs.
-- |
-- | Only entries this run bound are returned, so nothing a search finds is something the run
-- | withheld. The filters compose with each other and with the query.
-- |
-- | The page comes back as a value and is also opened as a view, under the selector `search results`,
-- | so it can be read on the next turn without a program showing it to itself. The next search
-- | replaces that view: it names what is being worked from rather than keeping a record.
-- |
-- | # Operation
-- |
-- | docs.search
-- |
-- | # Arguments
-- |
-- | - `query` — The words to match, as a case-insensitive substring. It may be empty when at least
-- |   one filter is given.
-- | - `options` — The filters and the page; `{}` ranks the query alone.
-- | - `options.module` — One module's id — `files`, `views`, `docs` — matched exactly. An empty query
-- |   with a module is that module's whole directory rather than a search. A module filter is a
-- |   lookup, so a name no module has matches nothing rather than failing.
-- | - `options.type` — One type's name, narrowing to that type and to the functions that take or
-- |   return it. Like `options.module`, a name nothing declares matches nothing rather than failing.
-- | - `options.kind` — Whether to return functions or types. The default returns both.
-- | - `options.offset` — How many hits to skip, for reading past the first page. The default starts
-- |   at the best hit.
-- | - `options.limit` — The most hits to return. The default is gg's own page size and there is a
-- |   ceiling above it, so comparing the hits against `total` is the only way to see a capped page.
-- |   Zero is refused rather than read as "no cap".
-- |
-- | # Returns
-- |
-- | The page that matched, best first. `total` counts every entry that matched before paging, so a
-- | page shorter than `total` is a page there is more of.
-- |
-- | # Throws
-- |
-- | `InvalidArgument` for an empty query with no filter at all — nothing matched and nothing was
-- | asked for are different answers — and for a `limit` of zero, which asks for a page that answers
-- | nothing. A module or type name gg does not hold is not among them: it matches nothing.
search
  :: forall given rest
   . Union given rest SearchOptions
  => String
  -> Record given
  -> Effect DocSearch
search query options =
  docSearch
    <$> Wire.call "search" "docs" "Gg.Docs.search"
      [ Wire.wire query, Wire.lower { kind: docKindWire } options ]

-- | Take one documentation view out of the context window, by the key it was opened under.
-- |
-- | The removal has no cascade: closing a type's view leaves every function view beside it, and
-- | closing a function's leaves its types. Nothing records why a view was opened, so a type that
-- | is closed is opened again by the next function that mentions it.
-- |
-- | # Operation
-- |
-- | docs.close
-- |
-- | # Arguments
-- |
-- | - `key` — The fully-qualified name the view was opened under, as a search hit reports it.
-- |
-- | # Returns
-- |
-- | How many views were taken away; a key that is not open closes `0` rather than failing.
-- |
-- | # Throws
-- |
-- | `Unavailable` under a run that did not enable closing documentation views.
close :: String -> Effect Int
close key = Wire.call "close" "docs" "Gg.Docs.close" [ Wire.wire key ]

-- | Take every documentation view out of the context window.
-- |
-- | The blanket form of `close`, on exactly the same terms and behind the same capability: no
-- | cascade to consider, because nothing is left.
-- |
-- | # Operation
-- |
-- | docs.close_all
-- |
-- | # Arguments
-- |
-- | (none)
-- |
-- | # Returns
-- |
-- | How many documentation views went, and `0` rather than a failure when none was open.
-- |
-- | # Throws
-- |
-- | `Unavailable` under a run that did not enable closing documentation views.
closeAll :: Effect Int
closeAll = Wire.call "close_all" "docs" "Gg.Docs.closeAll" []

-- | One page of results, read field by field because `kind` is a string on the wire and a value here.
docSearch :: Wire.Wire -> DocSearch
docSearch value =
  { total: Wire.field "total" value
  , offset: Wire.field "offset" value
  , hits: docHit <$> (Wire.field "hits" value :: Array Wire.Wire)
  }

-- | One hit, with its kind taken from the wire's word for it.
docHit :: Wire.Wire -> DocHit
docHit value =
  { key: Wire.text "key" value
  , kind: docKind (Wire.text "kind" value)
  , module: Wire.text "module" value
  , name: Wire.text "name" value
  , summary: Wire.text "summary" value
  }

-- | Which kind of entry this is. The wire's set is closed at two and gg owns it, so the fallback
-- | exists only because the conversion has to be total.
docKind :: String -> DocKind
docKind = case _ of
  "type" -> TypeEntry
  _ -> FunctionEntry

-- | A kind as the filter word the guest takes.
docKindWire :: DocKind -> String
docKindWire = case _ of
  FunctionEntry -> "function"
  TypeEntry -> "type"
