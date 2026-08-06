'use client'

import { useState } from 'react'
import { TopNav }          from '@/components/layout/TopNav'
import { NeuralChat }      from '@/components/chat'
import { NeuralBrain }     from '@/components/brain'
import { MemoryArchives }  from '@/components/archive'

type Tab = 'chat' | 'brain' | 'archive'

export default function Page() {
  const [tab, setTab] = useState<Tab>('chat')

  const sessionTitle = tab === 'chat' ? 'Architectural Patterns Review' : null

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', overflow: 'hidden' }}>
      <TopNav activeTab={tab} onTabChange={setTab} sessionTitle={sessionTitle} />
      <div style={{ flex: 1, overflow: 'hidden' }}>
        {tab === 'chat'    && <NeuralChat />}
        {tab === 'brain'   && <NeuralBrain />}
        {tab === 'archive' && <MemoryArchives />}
      </div>
    </div>
  )
}
