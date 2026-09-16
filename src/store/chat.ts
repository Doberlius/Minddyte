import {create} from 'zustand'
import {persist} from 'zustand/middleware'
import type { DbNode } from '@/types/db'

interface ChatStore{
    activeSessionId: string | null,
    activeNodes: DbNode[]
    mode: 'focus' | 'explore'
    /** null until the user picks one; the server resolves it against the daemon. */
    activeModel: string | null
    pullingModels: Record<string, number>
    setActiveSession: (id: string | null) => void
    addNode: (node: DbNode) => void
    removeNode: (id: string) => void
    setMode: (mode: 'focus' | 'explore') => void
    clearNodes: () => void
    setActiveModel: (modelId: string | null) => void
    setPullProgress: (modelId: string, progress: number) => void
    clearPulling: (modelId: string) => void
}

export const useChatStore = create<ChatStore>()(
    persist(  // zustand keeps store logic and auto save state to (local storage)
        (set) => ({
            activeSessionId: null,
            activeNodes: [],
            mode: 'explore',
            activeModel: null,
            pullingModels: {},

            setActiveSession: (id) => set(
                {activeSessionId: id, activeNodes: []}
            ),
            addNode: (node) =>
                set((s) => ({
                activeNodes: s.activeNodes
                .find((n) => n.id === node.id)
                    ? s.activeNodes
                    : [...s.activeNodes, node],
                })
            ),
            removeNode: (id) =>
                set((s) => ({activeNodes: s.activeNodes
                    .filter((n)=> n.id !== id)})
            ),
            setMode: (mode) => set({mode}),
            clearNodes: () => set({activeNodes: []}),
            setActiveModel: (activeModel) => set({activeModel}),
            setPullProgress: (modelId, progress) =>
                set((s)=> (
                    {pullingModels: {...s.pullingModels, [modelId]: progress}})
                ),
            clearPulling: (modelId) =>
                set((s) => {
                    const {[modelId]: _, ...rest} = s.pullingModels
                    return {pullingModels: rest}
                }),
        }),
        {
            name: 'minddyte-chat', // key in local storage
            partialize: (s) => ({ // choose which state saves in storage
                activeSessionId: s.activeSessionId,
                mode: s.mode,
                activeModel: s.activeModel
            }),
            // A persisted tag is no longer checked here: whether a model still
            // exists is a question for the daemon, not a constant. The server
            // re-validates on every request and falls back if it has gone.
            merge: (persisted, current) => ({
                ...current,
                ...((persisted ?? {}) as Partial<ChatStore>),
            }),
        }
    )
)

