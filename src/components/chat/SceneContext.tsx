'use client'

import { createContext } from 'react'

/** What a diagram needs to know about the reply it sits in (repair names the message). */
export type SceneInfo = { sessionId: string | null; messageId: string | null; fresh: boolean; model: string | null }

export const SceneContext = createContext<SceneInfo>({ sessionId: null, messageId: null, fresh: false, model: null })
