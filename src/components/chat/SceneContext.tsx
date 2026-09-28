'use client'

import { createContext } from 'react'

/**
 * What a diagram needs to know about the reply it sits in (repair names the
 * message). `streaming` is true only for the LAST message, only while it is
 * still being written (`useChat` status `'streaming'` or `'submitted'`) —
 * the assistant message is not in the database yet then, and repair needs
 * to know that before it spends an attempt asking for a message that does
 * not exist YET, not a message that never will.
 */
export type SceneInfo = { sessionId: string | null; messageId: string | null; fresh: boolean; model: string | null; streaming: boolean }

export const SceneContext = createContext<SceneInfo>({ sessionId: null, messageId: null, fresh: false, model: null, streaming: false })
