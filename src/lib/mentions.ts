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

export function mentionsSql(text: SQLWrapper, label: SQLWrapper): SQL {
  return sql`(btrim(${words(label)}) <> '' and strpos(' ' || ${words(text)} || ' ', ' ' || btrim(${words(label)}) || ' ') > 0)`
}

/**
 * Ticket 10, Q9: sentences are hidden at READ time. True when no concept
 * forgotten in this passage's chat is mentioned by it. `forgotten` is scoped
 * to one chat (spec §3.2), so another chat's forgetting never hides this one.
 */
export function notForgottenSql(sessionId: SQLWrapper, matchText: SQLWrapper): SQL {
  return sql`not exists (select 1 from ${forgotten} where ${forgotten.sessionId} = ${sessionId} and ${mentionsSql(matchText, forgotten.nodeLabel)})`
}
