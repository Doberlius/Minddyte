<div align="center">

# Minddyte

**A chat application whose conversations build a personal knowledge graph —
authored deterministically, so no model ever writes to it.**

[![Next.js](https://img.shields.io/badge/Next.js-15.5-000000?logo=next.js&logoColor=white)](https://nextjs.org)
[![React](https://img.shields.io/badge/React-19.2-61DAFB?logo=react&logoColor=black)](https://react.dev)
[![TypeScript](https://img.shields.io/badge/TypeScript-strict-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org)
[![PGlite](https://img.shields.io/badge/PGlite-embedded%20Postgres-336791?logo=postgresql&logoColor=white)](https://pglite.dev)
[![Tests](https://img.shields.io/badge/tests-112%20passing-10B981)](#testing)
[![License](https://img.shields.io/badge/license-MIT-6B7280)](LICENSE)

</div>

---

## Try it — no sign-up, no account, nothing to install

**▶︎ Live demo: _(deploy in progress — link goes here)_**

The demo opens with five unrelated conversations already on the canvas. Nobody
filed them into folders and nobody tagged them; the structure between them was
computed from what was said.

**Three things worth doing, in about sixty seconds:**

| Do this | Watch for |
|---|---|
| Click **"We run PostgreSQL on Kubernetes in production."** | `PostgreSQL` goes from **3** to **4** and your conversation joins two clusters at once — without you filing it anywhere |
| Type a sentence naming a tool nothing else mentions | It becomes a lone concept. Say it again in another message and the link appears by itself |
| Watch the word **"production"** after the first prompt | It is deliberately *not* indexed. A plain lowercase word is a correct concept only 29% of the time, so it is offered, never assumed |

**What is real and what is not.** The replies in the demo are written, not
generated. Everything else runs the application's own code in your browser: the
extractor that finds the concepts, the rule that decides their identity, and the
compaction that builds the memory. Removing the model removes nothing the graph
depended on — that is the whole design claim, and the demo is the proof.

---

## The idea

Most assistants either forget everything between sessions or hand the whole
transcript back to a model and hope. Minddyte does neither.

Every conversation contributes three things to a shared graph: a **Compaction**
(sentences taken verbatim from its own messages, never rewritten), a
**Headline**, and the **Concepts** found in it. Two conversations are connected
when they hold the same concept — not because a model judged them similar, but
because the same words were actually said in both.

That makes the graph auditable. You can point at any edge and name the sentence
that put it there.

---

## Tech stack, and what each part is responsible for

| Layer | Choice | Why it is there |
|---|---|---|
| Framework | **Next.js 15** (App Router) + **React 19** | Server routes and UI in one deployable unit; the demo route compiles to a static page with no server at all |
| Database | **PGlite** — Postgres compiled to WebAssembly | Real Postgres semantics (foreign keys, `CHECK` constraints, transactions) with no server to run. The user's data stays on the user's disk |
| Query layer | **Drizzle ORM** | Typed queries, and migrations generated from the schema rather than hand-kept — a hand-written copy drifts and nothing notices until production |
| Model | **Ollama** via the Vercel **AI SDK** | Runs locally. Minddyte holds no API key and sends no conversation to a third party |
| Extraction | **compromise** (grammar), plus project rules | One grammar pattern, no statistical ranking — measured, TF-IDF and RAKE are unusable on a single short message with no corpus |
| Canvas | **@xyflow/react** | Pan, zoom and drag on the demo graph |
| Tests | **Vitest** against real in-memory PGlite | Integration tests run in the ordinary `test` script; a separate command is one nobody runs when in a hurry |

---

## How it fits together

```
                   ┌─────────────────────────────────────────┐
  you type ───────▶│  POST /api/chat                         │
                   │                                         │
                   │  1. retrieveContext()   ── reads graph  │──┐
                   │  2. streamText()        ── Ollama       │  │
                   │  3. ingestUserMessage()  ── writes graph│  │
                   └─────────────────────────────────────────┘  │
                                                                │
   ┌────────────────────────────────────────────────────────────┘
   │
   ▼  PGlite (embedded Postgres, on your disk)
   ┌──────────┐   session_nodes    ┌──────────┐
   │ sessions │◀──────────────────▶│  nodes   │
   └──────────┘   (the whole graph)└──────────┘

   The graph is BIPARTITE. Conversations link to concepts; concepts link to
   conversations. There is no concept-to-concept edge, because two
   conversations being related IS the two edges meeting at a shared concept.
```

Step 3 runs **after** the reply has finished streaming. Nothing the model needs
depends on it, and running it first would add 300–500ms before the first token.

---

## Patterns worth reading

### 1. No model ever writes to the graph — [`src/lib/extract.ts`](src/lib/extract.ts)

Concepts come from one grammar pattern and a shape gate, not from asking a model
to "list the key topics". Precision was measured by shape, and the gate follows
the measurement rather than intuition:

| Shape | Example | Precision | Action |
|---|---|---|---|
| multi-word | `relational schema` | 87% | auto-create |
| shaped (caps, digits, dots) | `PostgreSQL`, `max.poll.records` | 100% | auto-create |
| bare lowercase | `data`, `team` | **29%** | suggest only, never create |

The same input gives the same graph forever, which is the property that makes a
memory system trustworthy — and it is why the live demo can drop the model
entirely and still be the real thing.

### 2. A trimming bug that silently destroyed memory — [`src/lib/compaction.ts`](src/lib/compaction.ts)

A Compaction is capped at 500 characters, so sentences that do not fit are
dropped. The first version `break`-ed on the first sentence too long to fit,
which reads as "drop from the tail" and is wrong in two measured ways:

- **It destroyed existing memory.** New sentences queue ahead of old ones, so a
  single oversized message stopped the loop before any older sentence was
  considered — one 611-character message wiped a chat's entire memory, silently.
- **It discarded short sentences that fit.** On a real reply: 30 sentences, only
  2 over cap, and still just 3 were kept.

`continue` instead of `break` skips what cannot fit and keeps looking. Sentences
are also dropped **whole**, never truncated, because half a sentence can invert
its meaning: *"We tried X first, but that made it worse"* cut short becomes an
endorsement.

### 3. Refusing to delete the user's database — [`db/index.ts`](db/index.ts)

PGlite is alpha-stage, and a version bump can leave an on-disk database it will
no longer open. The tempting fix is to recreate the directory. Minddyte instead
fails with instructions for copying the data somewhere safe first, and touches
nothing. A data-loss bug costs a user something no error message can return.

The same file takes a PID lock, because two processes opening one PGlite
directory corrupts it — and releases it on clean exit.

### 4. The demo is the real engine, not a mock — [`src/demo/`](src/demo/)

`src/demo/graph.ts` is the production ingest path with the database taken out:
same extractor, same identity rule, same compaction. What it drops is
persistence and retrieval ranking, and it says so. Its tests assert the rules
against the real extractor, so the demo cannot quietly drift away from the
application it is advertising.

---

## Getting started

Requires [Bun](https://bun.sh) and [Ollama](https://ollama.com) with one model pulled.

```bash
bun install
ollama pull gemma3          # or any model you have
bun run dev                 # http://localhost:3000
```

The demo page needs neither Ollama nor a database — open
[`localhost:3000/demo`](http://localhost:3000/demo) straight after `bun install`.

The database is created on first run at `./.data/minddyte`. Override with
`MINDDYTE_DATA_DIR`; `bun run db:reset` starts over and `bun run db:export`
takes a copy.

## Testing

```bash
bun run test        # 112 tests, 14 files — unit and integration together
bun run typecheck
bun run build
```

Integration tests run against a real PGlite instance in memory, one per test
file, so they exercise actual SQL rather than a mocked query builder.

---

## Measuring retrieval

```bash
bun run eval:retrieval
```

Runs the real `retrieveContext` against the labelled cases in `eval/cases.ts`
and reports precision, recall and MRR.

It **refuses to print a score** from a corpus too small to carry one, and says
what is still missing instead. Four conversations with no shared concept will
happily produce "100% precision", and a number like that is worse than no
number — it looks like evidence. What has been measured so far is extraction
precision by shape (87 / 100 / 29%) and traversal reach (two steps reach
99–100% of the corpus); retrieval quality has not, and the script will not
pretend otherwise.

It does not compare this graph shape against a concept-to-concept one. That
needs a second retriever, and the rule chosen for its edges — co-occurrence,
embeddings, a model — would dominate the result rather than the shape.

## Honest status

Built and tested: the graph engine, the retrieval path, the local-first data
layer, the chat interface, the Neural Brain and Memory Archives panels — one
implementation each, worn by both the app and the demo — and the live demo
itself.

**Forgetting runs in the demo only.** Deleting a concept from a conversation
unlinks it, rebuilds that conversation's memory without the sentences that
named it, and keeps it out for good. The `forgotten` table has been in the
schema since the first migration, but nothing in `src/services/` reads or
writes it yet, so the app cannot do this — the view model carries the field as
optional for exactly that reason.

Also open: extraction still swallows a leading verb into some concepts
(`Rust checks memory safety` should be two concepts, not one), which is why the
demo's seeded conversations name technologies plainly.

## License

MIT — see [LICENSE](LICENSE).
