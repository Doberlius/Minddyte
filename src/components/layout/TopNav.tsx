'use client'

import {Brain, MessageSquare, BookOpen, Settings, User} from 'lucide-react'

type Tab = 'chat' | 'brain' | 'archive'

interface TopNavProps{
    activeTab: Tab,
    onTabChange: (tab: Tab) => void
    sessionTitle?: string | null
    /**
     * Replaces the settings and account buttons on the right.
     *
     * The demo passes its own controls here. Those two buttons do nothing
     * there, and a control that looks live and answers to nothing is worse
     * than no control at all.
     */
    actions?: React.ReactNode
}

const TABS: {key: Tab; label: string; icon: React.ReactNode}[] = [
    {key: 'chat', label: 'Chat', icon: <MessageSquare size={14}/>},
    {key: 'brain', label: 'Neural Brain', icon: <Brain size={14}/>},
    {key: 'archive', label: 'Memory Archives', icon: <BookOpen size={14}/>},
]

/** Shared with every panel so `aria-controls` points at something real. */
export const panelId = (tab: Tab) => `panel-${tab}`
const tabId = (tab: Tab) => `tab-${tab}`

export function TopNav({activeTab, onTabChange, sessionTitle, actions }: TopNavProps){
    return (
         <header style={{
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
                  flexShrink: 0,
                }}>
                  <Brain size={15} />
                </div>
                <span style={{ fontSize: 14, fontWeight: 600, fontFamily: "'Fraunces',serif", letterSpacing: '-.01em' }}>
                  Minddyte
                </span>
              </div>

              {/* Divider */}
              <div style={{ width: 1, height: 22, background: 'var(--border)', marginRight: 16, flexShrink: 0 }} />

              {/* Nav tabs */}
              <nav
                role="tablist"
                aria-label="Workspace"
                style={{ display: 'flex', gap: 2, flex: 1, minWidth: 0 }}
              >
                {TABS.map(t => (
                  <button
                    key={t.key}
                    id={tabId(t.key)}
                    role="tab"
                    // The label folds away under 600px, so the button keeps an
                    // accessible name of its own rather than borrowing one from
                    // text that may not be rendered.
                    aria-label={t.label}
                    aria-selected={activeTab === t.key}
                    aria-controls={panelId(t.key)}
                    onClick={() => onTabChange(t.key)}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 6,
                      padding: '5px 13px', borderRadius: 8, border: 'none', cursor: 'pointer',
                      fontSize: 13, fontWeight: activeTab === t.key ? 600 : 400,
                      fontFamily: "'DM Sans',sans-serif",
                      background: activeTab === t.key ? 'var(--violet-l)' : 'transparent',
                      color: activeTab === t.key ? 'var(--violet)' : 'var(--ink2)',
                      transition: 'background .15s, color .15s',
                    }}
                  >
                    <span style={{ display: 'flex', opacity: activeTab === t.key ? 1 : .75 }}>{t.icon}</span>
                    <span className="nav-tab-label">{t.label}</span>
                  </button>
                ))}
              </nav>

              {/* Right side */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0, flexShrink: 0 }}>
                {sessionTitle && (
                  <span
                    className="nav-session"
                    style={{
                      fontSize: 13, fontWeight: 500, color: 'var(--violet)',
                      fontFamily: "'Fraunces',serif",
                      whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                      maxWidth: 240,
                    }}
                  >
                    {sessionTitle}
                  </span>
                )}
                {actions ?? (
                  <>
                    <button className="btn-ghost" aria-label="Settings" style={{ padding: 6, color: 'var(--ink2)' }}>
                      <Settings size={15} />
                    </button>
                    <button className="btn-ghost" aria-label="Account" style={{ padding: 6, color: 'var(--ink2)' }}>
                      <User size={15} />
                    </button>
                  </>
                )}
              </div>
            </header>
    )
}
