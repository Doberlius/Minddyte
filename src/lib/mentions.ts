import { sql, type SQL, type SQLWrapper } from 'drizzle-orm'
import { forgotten } from '../../db/schema'

/**
 * Ticket 10, Q8: does a passage mention a concept? The ONE definition, used
 * by retrieval, by the forget preview and by the Archive's passage count, so
 * they can never disagree about which sentences a forgotten concept hides.
 *
 * Both sides are reduced to lowercase words: every run of characters that is
 * not a letter, digit or `_` becomes one space. Then the label must appear
 * between spaces. "Kafka's" contains the word kafka; "Kafkaesque" does not.
 * No regex or LIKE is built from the label, so a `.` or `_` in a label can
 * never act as a wildcard. A label with no word characters matches nothing.
 */
function words(x: SQLWrapper): SQL {
  return sql`lower(regexp_replace(${x}, '[^[:alnum:]_]+', ' ', 'g'))`
}

/** The text's words with a space on each side, ready for `hasLabel`. */
function paddedWords(text: SQLWrapper): SQL {
  return sql`(' ' || ${words(text)} || ' ')`
}

/**
 * Does text already reduced by `paddedWords` contain the label's words? The
 * label is reduced once: `nullif` turns a label with no words into null, the
 * search string becomes null, and coalesce makes that "no match".
 */
function hasLabel(padded: SQLWrapper, label: SQLWrapper): SQL {
  return sql`coalesce(strpos(${padded}, ' ' || nullif(btrim(${words(label)}), '') || ' ') > 0, false)`
}

export function mentionsSql(text: SQLWrapper, label: SQLWrapper): SQL {
  return hasLabel(paddedWords(text), label)
}

/**
 * Ticket 10, Q9: sentences are hidden at READ time. True when no concept
 * forgotten in this passage's chat is mentioned by it. `forgotten` is scoped
 * to one chat (spec §3.2), so another chat's forgetting never hides this one.
 *
 * Same rule as `mentionsSql`, shaped for speed. Written as a plain
 * `not exists (… mentionsSql(matchText, label))`, Postgres turns it into an
 * anti-join that reduces the passage to words once per (passage, label)
 * PAIR, on the single connection every visitor shares: 2,500 short passages
 * with 23 labels forgotten took 630 ms per read, and a giant message's 206
 * chunks with 10 labels took 1,000 ms (now 245 ms and 115 ms). So instead:
 *   - a chat with nothing forgotten skips the check (Postgres reads
 *     `forgotten` once per query for this and hashes it);
 *   - otherwise the passage is reduced to words ONCE, in a one-row subquery
 *     that `offset 0` keeps the planner from inlining back into the per-label
 *     check, and each forgotten label is looked up in that.
 * CASE evaluates its branches lazily, which is what makes the first point
 * true. The scalar subquery keeps this an expression, usable in any WHERE.
 */
export function notForgottenSql(sessionId: SQLWrapper, matchText: SQLWrapper): SQL {
  return sql`(case when not exists (select 1 from ${forgotten} where ${forgotten.sessionId} = ${sessionId}) then true
    else (select not exists (select 1 from ${forgotten} where ${forgotten.sessionId} = ${sessionId} and ${hasLabel(sql`pw.padded`, forgotten.nodeLabel)})
            from (select ${paddedWords(matchText)} as padded offset 0) pw) end)`
}
