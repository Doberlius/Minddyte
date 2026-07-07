import {create} from 'zustand'

interface ArchiveStore {
    activePanelId: string | null
    deleteTargetId: string | null
    setActivePanel: (id: string | null ) => void
    setDeleteTarget: (id: string | null) => void
}

export const useArchiveStore = create<ArchiveStore>()
((set) => ({
    activePanelId: null,
    deleteTargetId: null,
    setActivePanel: (id) => set({activePanelId: id}),
    setDeleteTarget: (id) => set({deleteTargetId: id}),
}))
