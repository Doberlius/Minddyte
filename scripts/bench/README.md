# Retrieval benchmark

Tools for checking that a change to retrieval (`src/services/retrieval.ts`)
keeps its results and how fast it is, on a corpus much bigger than anyone's
real chats. Built for ticket 20. The downloaded text stays in
`.scratch/bench-corpus/`, which git ignores: it is never committed.

Run each command from the repository root. **Point `MINDDYTE_DATA_DIR` at a
fresh directory or at a copy of real data, never at real data itself**: the
comparison pools every chat into one workspace.

1. **Download** the articles in `wiki-topics.txt` and the books in
   `books.txt` (needs network; about 5 minutes, one request a second):

   ```bash
   bun scripts/bench/fetch-corpus.ts
   ```

2. **Build** them into a fresh database through the app's own save path
   (each article a chat, each section a turn; each book a chat):

   ```bash
   MINDDYTE_DATA_DIR=/tmp/bench-db bun scripts/bench/build-corpus.ts
   ```

3. **Make the searches**, the same list every time (seed 20), adding the
   approved questions if you have them:

   ```bash
   bun scripts/bench/make-queries.ts --corpus .scratch/bench-corpus \
     --approved <question files...> --out .scratch/bench-corpus/queries.json
   ```

4. **Compare** a git revision's retrieval against the working tree's. It exits
   1 on any difference, and refuses to run unless `MINDDYTE_DATA_DIR` points
   at a copy outside any `.data` folder:

   ```bash
   MINDDYTE_DATA_DIR=/tmp/bench-db bun scripts/bench/compare-retrieval.ts \
     --old <rev> --sample 200 --require-faster \
     --report .scratch/bench-corpus/report.json
   ```

   Keep the report under `.scratch/` (git ignores it): a report that lists
   differences quotes the searches, and those can include your own questions.

   `--check-bar` also fails when the two ticket-20 drafts are slower than
   1.5 s and 0.5 s through the whole retrieval.

   **Only `src/services/retrieval.ts` is old.** Everything it imports is the
   working tree's, for both sides. That is a fair comparison only when the
   change being measured is inside `retrieval.ts`. Otherwise, check the old
   revision out into its own worktree and run there.
