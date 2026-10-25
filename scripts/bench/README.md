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
   1 on any difference:

   ```bash
   MINDDYTE_DATA_DIR=/tmp/bench-db bun scripts/bench/compare-retrieval.ts \
     --old <rev> --sample 200 --require-faster --report report.json
   ```

   `--check-bar` also fails when the two ticket-20 drafts are slower than
   1.5 s and 0.5 s through the whole retrieval.
