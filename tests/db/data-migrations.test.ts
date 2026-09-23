import { beforeEach, describe, expect, it } from 'vitest'
import { PGlite } from '@electric-sql/pglite'
import { pg_trgm } from '@electric-sql/pglite/contrib/pg_trgm'
import { drizzle } from 'drizzle-orm/pglite'
import { getDb, dataMigrations } from '../../db'
import * as schema from '../../db/schema'
import { ensureSchema } from '../../db/bootstrap'
import { runDataMigrations } from '../../db/data-migrations'
import { persistMessage } from '@/services/graph'
import { countRows, newChat, truncateAll, FIXTURE_WORKSPACE_ID, firstMigrationStatements } from '../helpers/pglite'

beforeEach(truncateAll)

describe('runDataMigrations', () => {
  it('backfills pointers for messages written before pointers existed, once', async () => {
    const chatId = await newChat()
    // persistMessage alone writes no pointers — exactly what the live
    // database holds for every message sent before this change.
    await persistMessage({ workspaceId: FIXTURE_WORKSPACE_ID, sessionId: chatId, role: 'user', content: 'One. Two.' })
    await persistMessage({ workspaceId: FIXTURE_WORKSPACE_ID, sessionId: chatId, role: 'assistant', content: 'Three.' })
    expect(await countRows('chat_pointers')).toBe(0)

    const db = await getDb()
    expect(await runDataMigrations(db)).toEqual(['0001_backfill_chat_pointers'])
    expect(await countRows('chat_pointers')).toBe(3)

    // Recorded, so a second boot does nothing.
    expect(await runDataMigrations(db)).toEqual([])
    expect(await countRows('data_migrations')).toBe(1)
  })

  it('a step that throws records nothing, so it runs again next boot', async () => {
    const db = await getDb()
    const boom = [{ name: 'test_boom', run: async () => { throw new Error('boom') } }]
    await expect(runDataMigrations(db, boom)).rejects.toThrow('boom')
    const rows = await db.select().from(dataMigrations)
    expect(rows).toEqual([])
  })

  // Review Focus 1: the Render disk, end to end.
  it('carries a pre-migrator database with chats all the way to pointers', async () => {
    const pg = await PGlite.create({ extensions: { pg_trgm } })
    for (const s of firstMigrationStatements()) await pg.exec(s)
    await pg.exec(`insert into sessions (id, workspace_id, title)
                   values ('00000000-0000-4000-8000-00000000000a', '00000000-0000-4000-8000-000000000001', 'live chat')`)
    await pg.exec(`insert into messages (session_id, role, content)
                   values ('00000000-0000-4000-8000-00000000000a', 'user', 'Kafka keeps order. Redis caches.')`)

    await ensureSchema(pg)
    const db = drizzle(pg, { schema })
    await runDataMigrations(db as never)

    const { rows } = await pg.query<{ n: number }>(`select count(*)::int as n from chat_pointers`)
    expect(rows[0].n).toBe(2)
    const { rows: kept } = await pg.query<{ title: string }>(`select title from sessions`)
    expect(kept).toEqual([{ title: 'live chat' }])
    await pg.close()
  })
})
