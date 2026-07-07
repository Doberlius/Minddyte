import {create} from 'zustand'

interface BrainStore {
    selectedNodeId: string | null
    setSelectedNode: (id: string | null) => void
}

export const useBrainStore = create<BrainStore>()
((set) => ({
    selectedNodeId: null,
    setSelectedNode: (id) => set({selectedNodeId: id}),
}))