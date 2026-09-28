<div align="center">

# Minddyte

**An AI chat app that remembers your past conversations, and can show you exactly where each memory came from.**

[![Live demo](https://img.shields.io/badge/live%20demo-minddyte.onrender.com-4F46E8)](https://minddyte.onrender.com)
[![Next.js](https://img.shields.io/badge/Next.js-15.5-000000?logo=next.js&logoColor=white)](https://nextjs.org)
[![React](https://img.shields.io/badge/React-19-61DAFB?logo=react&logoColor=black)](https://react.dev)
[![TypeScript](https://img.shields.io/badge/TypeScript-strict-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org)
[![Postgres](https://img.shields.io/badge/database-PGlite%20(Postgres)-336791?logo=postgresql&logoColor=white)](https://pglite.dev)
[![Tests](https://img.shields.io/badge/tests-574%20passing-10B981)](#how-it-is-tested)
[![License](https://img.shields.io/badge/license-MIT-6B7280)](LICENSE)

</div>

---

## Try it in one minute

**Open the live app: https://minddyte.onrender.com**

There is no sign up and nothing to install. Your browser gets its own private space the first time you visit, so you will not see anyone else's chats and nobody will see yours.

Five things to try:

| Do this | What you should see |
|---|---|
| In one chat, write *"We run PostgreSQL in production."* Then press **New chat** and ask *"What database do we use?"* | The answer knows it is PostgreSQL, because it found your earlier chat on its own. Under the answer it says which chat it used and why. |
| Open **Brain** in the top menu | A map of your chats, joined by the topics they share. |
| Type **`/visualize how the frequency changes a sine wave`** | An animated diagram inside the answer, in the style of the 3Blue1Brown maths videos. Press play, drag the timeline, move the slider. |
| Type **`/forget`** in a chat and pick a topic | Minddyte shows exactly which sentences it will stop remembering before you agree. |
| Open **About you** in the sidebar and write a line about yourself | Every answer from now on can use it. Only you can change it. |

---

## What problem it solves

Most AI chat apps forget everything once you start a new conversation. The ones that do remember usually ask the AI to write a summary of your past chats, and that summary loses details and can quietly get things wrong. You cannot check it.

Minddyte remembers differently:

- **It keeps what you actually said, word for word.** Every sentence, code sample and table is stored exactly as written. Nothing is summarised or rewritten.
- **It picks memory when you ask a question, not before.** For each new message it looks through your past chats and brings in only the sentences that fit that question.
- **It shows its work.** Every past chat it uses comes with a short reason, such as *"matches words "journal", "crash""*. You can always trace an answer back to the sentence it came from.
- **You stay in control.** You can pull a specific chat in with **@**, lock a chat so it uses nothing else (**Focus** mode), or tell it to forget a topic.

---

## What you can do in the app

| Feature | What it does |
|---|---|
| **Chat** | Talk to an AI model, as in any chat app. On the live site you can pick GPT-OSS 120B or Gemma 4 31B. |
| **Memory across chats** | Related past chats are found automatically and used in the answer, with the reason shown. |
| **Explore and Focus modes** | *Explore* (the default) may use your other chats and general knowledge. *Focus* answers only from this chat and the chats you add, and says plainly when the answer is not there. |
| **@ to add a chat** | Type **@** and pick a past chat to include it in full. |
| **About you** | A short note about yourself that every answer can use. |
| **Brain** | A map of your conversations and the topics that connect them. |
| **Archive** | Everything Minddyte has saved from each chat, so you can see what it remembers. |
| **/forget** | Stop a topic from being used as memory in your other chats. It shows exactly which sentences are affected before anything happens. |
| **/visualize** | Ask for an animated, interactive diagram: a curve, a vector, a sorting algorithm, messages flowing through a system. |
| **Rich answers** | Answers show formatted text, tables, maths formulas and code with syntax colours and a Copy button, similar to Claude or ChatGPT. |
| **/help** | Lists every command. |

---

## How it works, step by step

When you send a message, five things happen:

```
  1. You send a message
          |
  2. Minddyte searches your past chats for sentences that fit it
     (it looks at the rare, meaningful words in your message)
          |
  3. The best sentences are sent to the AI together with your message,
     each labelled with the chat and the date it came from
          |
  4. The AI writes the answer, which appears on screen as it is written
          |
  5. After the answer is finished, your new message is saved
     sentence by sentence, ready to be found by future questions
```

Step 5 happens only after the answer is on screen, so saving memory never slows down the reply.

### How it decides which past chats are related

Minddyte does **not** ask an AI to decide what is related. It uses rules you can check:

- **Shared topics.** When you name something like *PostgreSQL* or *Kafka*, Minddyte records it as a topic of that chat. Two chats that name the same topic are connected. These connections are what you see on the Brain map.
- **Rare words count most.** When you ask a question, Minddyte looks at the meaningful words in it and weighs each one by how rare it is across your chats. A word that appears in almost every chat, like *database*, counts for little. A word that appears in only one chat, like *journal*, counts for a lot. A past chat is used only if it covers enough of what makes your question specific.

Because these are rules and not AI guesses, the same conversation always gives the same result, and every connection can be explained.

### How the animated diagrams work

When you ask to see something, the AI writes a few lines of drawing instructions using a small drawing library built for Minddyte (axes, curves, arrows, arrays, trees, queues, sliders and animation steps). Minddyte then draws them in a sealed box inside the answer:

- **The box is locked down.** The AI's instructions cannot reach the internet, your other chats, your browser cookies or the rest of the page. They can only describe a picture, which Minddyte's own tested code then draws.
- **Nothing can freeze the page.** If the instructions take more than 2 seconds, they are stopped.
- **It fixes itself.** If a diagram fails to draw, Minddyte sends the error back to the AI and asks for a corrected version, up to twice, and saves the fix so the diagram works next time.

---

## Tech stack, and what each part does

| Part | Technology | Its job in Minddyte |
|---|---|---|
| Web app | **Next.js 15, React 19, TypeScript** | The pages you see and the server that answers them, in one project. |
| Database | **PGlite** (the Postgres database running inside the app) | Stores chats, sentences and topics with the safety of a real database, without running a separate database server. |
| Database access | **Drizzle ORM** | Type-checked database queries, and database changes generated from one schema file. |
| AI models | **Ollama** (local or cloud) through the **Vercel AI SDK** | Writes the answers and streams them to the screen as they are written. |
| Search | **Postgres pg_trgm** plus Minddyte's rare-word scoring | Finds the past sentences that fit a new question, tolerant of small typos. |
| Topic detection | **compromise** (an English grammar library) | Finds the named things in a message (tools, products, terms) without asking an AI. |
| Answer display | **react-markdown**, **KaTeX**, **highlight.js** | Formatted text, tables, maths and coloured code. |
| Diagrams | Minddyte's own drawing library, **SVG**, **Web Workers**, **esbuild** | Draws the animated diagrams inside a sealed, offline box. |
| Brain map | **React Flow** | The zoomable map of chats and topics. |
| Tests | **Vitest** against a real database, **Playwright** in Microsoft Edge | 574 automated tests, plus browser checks for the diagram sandbox. |
| Hosting | **Render** with Docker and a persistent disk | Runs the live demo, with your chats kept between restarts. |

---

## Problems I solved along the way

These are the parts most worth opening in the code.

### 1. Memory was losing about 98% of long answers

**The problem.** The first version kept a short summary of each chat, capped at 500 characters and filled in order. Measured on real answers, it kept the short opening of a long reply and threw away almost everything after it, which is exactly where the useful facts were.

**The fix.** Remove the summary entirely. Every sentence is now stored where it was said, and nothing is chosen until a question is asked. Sentences are included whole or not at all, because half a sentence can flip its meaning: *"We tried X first, but that made it worse"* cut short sounds like a recommendation.

Code: [`src/lib/pointers.ts`](src/lib/pointers.ts), [`src/lib/windows.ts`](src/lib/windows.ts)

### 2. Unrelated chats were leaking into answers

**The problem.** The original search compared your whole message letter by letter with past sentences. Filler words like *what*, *is* and *the* counted as much as real ones, so *"What is the plot of Hamlet?"* pulled in three unrelated chats, one of them about Kafka. I tested 120 questions: it brought in unrelated chats for 30 out of 50 questions that had no right answer.

**The fix.** Score only the meaningful words, weighted by how rare they are. I tuned it on 80 questions and then checked it on 40 questions it had never seen.

| On all 120 test questions | Before | After |
|---|---|---|
| Right past chat found | 58 of 70 | **66 of 70** |
| Unrelated chats pulled in | 30 of 50 | **13 of 50** |

It improved both numbers at once, which no simple setting change could do.

Code: [`src/lib/coverage.ts`](src/lib/coverage.ts), [`src/services/retrieval.ts`](src/services/retrieval.ts)

### 3. Running code written by an AI, safely, on a public website

**The problem.** Interactive diagrams need the AI to write code, and the live site is open to anyone with no rate limit. Code from an AI must never be able to read someone's chats or send data away.

**The fix.** The code runs inside a sealed frame that the browser treats as a stranger to the page, with a security policy that blocks all network access, and inside a background worker that is stopped after 2 seconds. The code can only describe a picture; Minddyte's own tested code draws it. The same thinking applies to answers: an image inside an AI answer is never loaded automatically, because loading it could send your conversation to someone else's server.

Code: [`src/scene/frameDoc.ts`](src/scene/frameDoc.ts), [`src/scene/runtime/run.ts`](src/scene/runtime/run.ts), [`src/components/chat/ScenePlayer.tsx`](src/components/chat/ScenePlayer.tsx)

### 4. Forgetting that shows you exactly what it will do

**The problem.** "Forget this topic" is only trustworthy if you can see what will be forgotten, and if it really stops the memory from being used.

**The fix.** Before anything happens, Minddyte lists the exact sentences that will stop being used as memory, including sentences that mention only part of a name. After you agree, those sentences are never used in other chats again, while your messages stay visible in their own chat.

Code: [`src/services/forget.ts`](src/services/forget.ts), [`src/components/forget/ForgetDialog.tsx`](src/components/forget/ForgetDialog.tsx)

---

## Run it yourself

You need [Bun](https://bun.sh) and [Ollama](https://ollama.com) with one model downloaded.

```bash
bun install
ollama pull gemma3
bun run dev          # then open http://localhost:3000
```

Your data is saved in `./.data/minddyte` on your own computer. `bun run db:export` makes a backup copy.

## How it is tested

```bash
bun run test         # 574 automated tests
bun run typecheck
npx tsx scripts/scene-check.ts   # browser checks for the diagram sandbox (Microsoft Edge)
```

The tests run against a real database, not a fake one, so they check the actual queries. Changes to how memory is found were measured on labelled question sets before they were kept, and the measurement scripts are kept so the numbers can be checked again.

## Honest status

Working and tested: chat, memory across chats, Explore and Focus modes, @ to add chats, About you, Brain, Archive, forgetting, rich answers with maths and code, and interactive diagrams.

Known limits:

- **Topic detection works in English only.**
- **Small talk can pull in old chats.** Messages like *"hi"* or *"thanks"* can still bring in past chats. This is recorded as an open ticket.
- **A long pasted paragraph can take several seconds** before the answer starts, because every word is searched. Also an open ticket.
- **Diagram quality depends on the AI model.** In my tests, 6 of 8 diagrams drew correctly the first time and 1 more fixed itself. The sandbox has been checked in Microsoft Edge only.
- **There are no user accounts.** Each browser gets its own private space, which suits a demo but not a shared product.

## License

MIT. See [LICENSE](LICENSE).
