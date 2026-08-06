'use client'

import {Brain, MessageSquare, BookOpen, Settings, User} from 'lucide-react'

type Tab = 'chat' | 'brain' | 'archive'

interface TopNavProps{
    activeTab: Tab,
    onTabChange: (tab: Tab) => void
    sessionTitle?: string | null
}

const TABS: {key: Tab; label: string; icon: React.ReactNode}[] = [
    {key: 'chat', label: 'Chat', icon: <MessageSquare size={14}/>},
    {key: 'brain', label: 'Neural Brain', icon: <Brain size={14}/>},
    {key: 'archive', label: 'Memory Archives', icon: <BookOpen size={14}/>},
]

export function TopNav({activeTab, onTabChange, sessionTitle }: TopNavProps){
    return (
         <div style={{
              height: 52, borderBottom: '1px solid var(--border)',
              display: 'flex', alignItems: 'center',
              padding: '0 18px', background: 'var(--white)',
              flexShrink: 0, gap: 0,
            }}>
              {/* Logo */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginRight: 18 }}>
                <div style={{
                  width: 30, height: 30, borderRadius: '50%',
                  background: 'var(--violet)', display: 'flex',
                  alignItems: 'center', justifyContent: 'center', color: '#fff',
                }}>
                  <Brain size={15} />
                </div>
                <span style={{ fontSize: 14, fontWeight: 600, fontFamily: "'Fraunces',serif", letterSpacing: '-.01em' }}>
                  Minddyte
                </span>
              </div>
        
              {/* Divider */}
              <div style={{ width: 1, height: 22, background: 'var(--border)', marginRight: 16 }} />
        
              {/* Nav tabs */}
              <nav style={{ display: 'flex', gap: 2, flex: 1 }}>
                {TABS.map(t => (
                  <button
                    key={t.key}
                    onClick={() => onTabChange(t.key)}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 6,
                      padding: '5px 13px', borderRadius: 8, border: 'none', cursor: 'pointer',
                      fontSize: 13, fontWeight: activeTab === t.key ? 600 : 400,
                      fontFamily: "'DM Sans',sans-serif",
                      background: activeTab === t.key ? 'var(--violet-l)' : 'transparent',
                      color: activeTab === t.key ? 'var(--violet)' : 'var(--ink2)',
                      transition: 'all .15s',
                    }}
                  >
                    <span style={{ opacity: .8 }}>{t.icon}</span>
                    {t.label}
                  </button>
                ))}
              </nav>
        
              {/* Right side */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                {sessionTitle && (
                  <span style={{ fontSize: 13, fontWeight: 500, color: 'var(--violet)', fontFamily: "'Fraunces',serif" }}>
                    {sessionTitle}
                  </span>
                )}
                <button className="btn-ghost" style={{ padding: 6, color: 'var(--ink2)' }}>
                  <Settings size={15} />
                </button>
                <button className="btn-ghost" style={{ padding: 6, color: 'var(--ink2)' }}>
                  <User size={15} />
                </button>
              </div>
            </div>
    )
}