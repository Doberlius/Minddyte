# MindDyte — Full Project Specification
## For AI Agent Implementation

---

## 1. Project Overview

**Product Name:** MindDyte  
**Type:** AI-powered knowledge management chatbot with persistent memory graph  
**Core concept:** A three-panel web application where conversations automatically build a visual knowledge graph. The AI learns from every session, organizes knowledge into clusters, and surfaces relevant memory context automatically — without the user managing it manually.

**Three panels:**
1. **Neural Chat** — Conversational interface with AI-powered memory context
2. **Neural Brain** — Visual knowledge graph of all nodes and their connections
3. **Memory Archives** — Clustered view of all past sessions organized by theme

---

## 2. Design System

### 2.1 Typography
- **Display / headings:** Fraunces (Google Fonts) — serif, weights 300/400/500/600
- **Body / UI:** DM Sans (Google Fonts) — weights 300/400/500/600
- **Monospace (commands):** System monospace stack

### 2.2 Color Tokens
```
--purple:       #4F46E8   (primary brand, CTAs, active states)
--purple-light: #EEF0FD   (backgrounds, hover states, pills)
--purple-mid:   #C7C3F7   (borders, inactive edges, secondary elements)
--text:         #1A1A2E   (primary text)
--text-2:       #6B7280   (secondary text, descriptions)
--text-3:       #9CA3AF   (tertiary text, timestamps, placeholders)
--border:       #E5E7EB   (default borders)
--border-2:     #F3F4F6   (subtle dividers)
--bg:           #FAFAFA   (page background)
--white:        #FFFFFF   (panel backgrounds, cards)
--red:          #EF4444   (destructive actions)
--green:        #10B981   (success states)
```

### 2.3 Layout
- **Topbar height:** 52px — fixed, contains logo + nav + session title + icons
- **Sidebar width:** 280px — fixed, scrollable
- **Main content:** flex: 1, overflow: hidden, scrollable internally
- **Border radius:** 8px (components), 10px (cards/panels), 12px (modals)
- **Global font:** DM Sans

### 2.4 Animation Principles
- **Streaming dots:** 3-dot staggered wave, 1.2s loop, delays 0s / 0.2s / 0.4s
- **Slide-in panel:** 0.25s cubic-bezier(.22,.68,0,1.2) from right
- **Context menu:** 0.12s scale from 0.95 → 1
- **Node pulse:** box-shadow expand on jump-to, 2 cycles
- **Toast:** 0.2s fade + translateY from +8px
- **Card hover:** box-shadow + translateY(-1px) 0.2s
- **All transitions:** 0.15s ease unless specified

---

## 3. Global Shell

### 3.1 Topbar
- **Left:** Logo mark (purple circle + brain icon) + "MindDyte" in Fraunces serif
- **Divider:** 1px vertical separator
- **Center nav:** Three tab buttons — Chat | Neural Brain | Memory Archives
  - Active tab: purple-light background, purple text, 600 weight
  - Inactive: transparent background, text-2 color, 400 weight
  - Each tab has matching icon prefix
- **Right:** Session title (Fraunces serif, purple color — only visible on Chat tab) + gear icon + user icon

### 3.2 Navigation State
- Tab switch does not reset any panel state
- Session title in topbar reflects the currently active chat session
- Active tab highlighted with filled background pill

---

## 4. Neural Chat — Full Specification

### 4.1 Layout
- **Sidebar (280px):** Session list + active context strip + help/feedback footer
- **Main area:** Chat messages (scrollable) + Input area (fixed bottom)

### 4.2 Sidebar — Session List
**New Session button:**
- Full-width, purple background, white text, "+" prefix icon
- Creates new empty session, clears chat, sets topbar title to "New Session"

**Search bar:**
- Rounded input, search icon prefix, placeholder "Search history..."
- Filters session list in real-time

**Session items:**
- Bold title (13px, 600 weight) — truncated with ellipsis
- Preview text (11px, text-2) — first message summary, truncated
- Timestamp (11px, text-3) + node count badge (purple-light pill)
- ··· overflow menu on hover
- Active session: purple-light background
- Hover: #F9F8FF background

**Overflow menu per session:**
- Rename
- Delete session
- Save to Archive

### 4.3 Sidebar — Active Context Strip
Appears at bottom of sidebar above footer when any nodes are active.

**Display:**
- Section label: "AI Context" with purple dot indicator
- Each active node: purple-light pill, node name in purple (500 weight), × button to detach
- No "Add Node" button — nodes are AI-managed

**Behavior:**
- Auto-populated by AI on each message based on semantic relevance
- User can only remove (×), never manually add from this strip
- Adding is done via @mention in input

### 4.4 Chat Messages

**User messages:**
- Right-aligned, max-width 560px
- Background: var(--bg), border: var(--border), border-radius: 16px 16px 4px 16px
- Font: 14px, line-height 1.6

**AI messages:**
- Left-aligned with brain avatar (36px circle, purple background, brain icon, white)
- Max-width 640px
- No background — plain text on white
- Font: 14px (same size as user messages), line-height 1.7

**Streaming state:**
- Brain avatar + three pulsing dots in a pill bubble
- Dots animate as staggered wave (not simultaneous)
- Appears immediately after user sends message

**Structured list items in AI response:**
- Check circle icon prefix (purple border circle with checkmark)
- Bold title + body text below
- Subtle gray background pill per item

### 4.5 Input Area

**Context strip (above input):**
- Visible when activeNodes.length > 0
- Shows: brain icon + "Using:" label + node pills
- Each pill: node name + × to detach
- Pills: purple-light background, purple-mid border, purple text

**Textarea:**
- Background: var(--bg), border: var(--border), border-radius: 12px
- Height: 80px, resizable: none
- Font: DM Sans 13px
- **Placeholder:** "Ask anything — type / for commands or @ for nodes"

**Toolbar row (below textarea):**
- Left: paperclip icon (attach file) + @ icon labeled "Node" (triggers node picker) + model selector icon (brain chip icon, triggers ModelSwitcher picker)
- Model selector shows currently active model name abbreviated next to the icon (e.g. "qwen3.5" truncated)
- Right: Send button — purple background, "Send" + send icon

**Footer disclaimer:**
- "MindDyte generates context-aware responses based on linked memory nodes."
- 11px, text-3, centered, opacity reduced

### 4.6 @ Mention System

**Trigger:** User types `@` anywhere in the input

**Picker UI:**
- Appears above input as floating panel
- Header: "Nodes — {count} available" in small caps
- Each row: node label (500 weight) + type + connection count + link icon
- Keyboard: ↑↓ to navigate, Enter to select, Escape to dismiss
- Search: filters as user types after @

**On selection:**
- Replaces `@partialtext` with `@NodeName ` in the input
- Adds node to active context strip
- Shows toast: "✓ {NodeName} added to context"
- Picker closes

**Example:** `@Platform Architecture V2 how does this compare to what we decided?`

### 4.7 / Command System

**Trigger:** User types `/` anywhere in the input

**Picker UI:**
- Floating panel above input
- Header: "Commands" in small caps
- Each row: monospace command (purple, 700 weight, 100px min-width) + description
- Keyboard navigable (↑↓ Enter Escape)

**Full command list:**

| Command | Behavior |
|---|---|
| `/help` | Show all available commands inline in chat |
| `/memory` | Show active nodes as inline panel above input (toast notification) |
| `/mode [focus\|explore]` | Switch AI behavior. focus = strictly active nodes only. explore = all memory (default) |
| `/clear` | Clear all active nodes for this session |
| `/save` | Save session to Memory Archive |
| `/connect [node name]` | Manually attach a node. No name = opens node search picker |
| `/forget [node name]` | Detach specific node immediately |
| `/summarize` | AI summarizes current conversation, pins to session top |
| `/node [name]` | Create new Brain node, AI pre-fills summary from conversation |
| `/rename [title]` | Rename current session inline |
| `/new` | Start new session (prompts save if unsaved content) |
| `/search [query]` | Search across all sessions and nodes, results inline |
| `/brain` | Open mini Brain panel inline as peek view with "Open full Brain" link |
| `/model` | Open model switcher picker inline — same as clicking the model icon |

**On selection:**
- Replaces `/partialtext` with `/command ` in input
- For commands with side effects (/clear, /memory), executes immediately + shows toast

### 4.8 AI Node Handling (Core Logic)

- AI automatically selects relevant nodes on every message
- Works at any scale (10 to 10,000+ nodes)
- User action: none required by default
- @mention = override/force specific node
- /mode focus = restrict AI to only active nodes
- /mode explore = AI ranges freely (default)
- Active context strip is read-only display of what AI picked

### 4.9 Model Switcher

**Trigger:** Click the model icon in the toolbar OR type `/model` in input

**Picker UI:**
- Floating panel above input, same width as input area
- Search input at top — placeholder "Find model..."
- Two sections: **Downloaded** (available immediately) and **Available to pull** (requires download)
- Each row: model name + status icon on right
  - No icon = downloaded, ready to use
  - Cloud + download arrow icon = not yet pulled, click to download
  - Animated spinner = currently downloading (progress %)
- Active model: highlighted row with a subtle purple-light background + checkmark
- Keyboard navigable (↑↓ Enter Escape)
- Search filters both sections in real-time

**Model status icons:**
```
✓  (no icon)     — downloaded, active or available
↓  cloud-arrow   — available on Ollama registry, not yet pulled
⟳  spinner       — currently pulling (shows "47%" progress inline)
```

**On selecting a downloaded model:**
- `activeModel` updates in ChatStore immediately
- Picker closes
- Toolbar shows new model name
- Toast: "Switched to {modelName}"
- All subsequent messages use the new model — no session restart needed

**On selecting a not-yet-pulled model:**
- Pull begins immediately via `POST /api/models/pull`
- Row shows spinner + progress percentage (streamed from Ollama pull API)
- User can continue chatting on current model while pull happens in background
- When pull completes: row switches to "downloaded" state + toast: "{modelName} ready"
- Model does NOT auto-switch after pull — user must click again to activate

**On hover over any model row:**
- Show subtle tooltip with: model size on disk (e.g. "4.7 GB") + parameter count if known

**Data source:**
- Downloaded models: `GET /api/models` → Ollama `GET /api/tags`
- Available-to-pull list: curated static list in `lib/models-registry.ts` merged with Ollama tags response
- Real-time pull progress: streamed from `POST /api/models/pull` via ReadableStream

**Curated registry** (`lib/models-registry.ts`) — list of recommended models shown in the picker even before being pulled:
```typescript
export const MODEL_REGISTRY: ModelEntry[] = [
  { id: "qwen3.5:cloud",        label: "Qwen 3.5",           size: "~4.7 GB", params: "7B"   },
  { id: "qwen3.5:397B-cloud",   label: "Qwen 3.5 397B",      size: "~230 GB", params: "397B" },
  { id: "qwen3.6",              label: "Qwen 3.6",           size: "~5.2 GB", params: "8B"   },
  { id: "nemotron-3-super:cloud",label: "Nemotron 3 Super",  size: "~12 GB",  params: "22B"  },
  { id: "gemma4:31b-cloud",     label: "Gemma 4 31B",        size: "~19 GB",  params: "31B"  },
  { id: "gemma4",               label: "Gemma 4",            size: "~5.0 GB", params: "9B"   },
  { id: "kimi-k2.5:cloud",      label: "Kimi K2.5",          size: "~9.8 GB", params: "16B"  },
  // Add more as needed
]
```

**Persistence:** `activeModel` persisted in localStorage via Zustand persist middleware. Survives page reload.

---

## 5. Neural Brain — Full Specification

### 5.1 Layout
- **Sidebar (280px):** Map Context panel — search, selected node details, all nodes list
- **Main area:** Infinite canvas with SVG graph + controls

### 5.2 Sidebar

**Header:**
- "Map Context" title (700 weight)
- Subtitle: "View and manage selected node details."

**Search Nodes:**
- Full-width search input with icon
- Filters node list in real-time
- Does NOT filter the canvas (canvas is separate)

**Selected Node panel:**
- Purple-light background card with purple-mid border
- Brain icon (28px, purple circle) + node name
- Description text (AI-generated summary)
- "Expand Details" button — full-width purple CTA

**All Nodes list:**
- Section label: "All Nodes" in small caps
- Each row: link icon + node label + sub-label + locate icon (⌖) + ··· menu
- Click row OR locate icon → canvas flies to that node + node pulse animation + toast "Jumped to: {name}"
- ··· menu: Rename, Connect to..., Delete

### 5.3 Canvas

**Library:** React Flow v12 (`@xyflow/react`) — replaces custom SVG/D3 implementation entirely.

**Background:** React Flow `<Background>` component — `variant="dots"`, gap 28, size 1, color `#D1D5DB` at 50% opacity.

**Graph header bar (overlay on canvas):**
- Left: "Neural Knowledge Graph" (Fraunces serif) + "Map View" pill
- Right: "Export Map" (outlined button) + "+ New Node" (purple button)

**Node design — custom React Flow node component (`BrainNode`):**
- All nodes: same rounded rectangle (border-radius: 10px)
- Same padding: 9px 14px
- Same icon size: 22px square with 6px radius, brain icon inside
- **Unselected:** white background, var(--border) border, subtle box-shadow
- **Selected:** purple background, white text, white icon, purple box-shadow
- Subtitle text below label at 70% opacity
- React Flow handles drag, selection state, and hover natively
- `nodeTypes={{ brain: BrainNode }}` registered on `<ReactFlow />`

**Edges — React Flow edge types:**
- **Confirmed edges:** `type="default"`, stroke `#D1D5DB`, strokeWidth 1
- **Suggested edges:** `type="default"`, stroke `#C7C3F7`, strokeWidth 1.5, `strokeDasharray="5 4"`, markerEnd arrowhead
- Edge `data.confidence` drives opacity (0.5 for new, 1.0 when solidified)
- Edge `data.relationshipLabel` shown in tooltip on hover
- Right-click edge → custom context menu → "Remove connection"

**Auto-connect behavior:**
- New edges added to React Flow `edges` state automatically (no user approval)
- Animate new edge: briefly set `animated: true`, revert after 2s
- "Recently connected" toast: "{Node A} → {Node B} connected"

**Edge confidence (opacity):**
- New edges: `style={{ opacity: 0.5 }}`
- Solidify: `style={{ opacity: 1 }}` as topic recurs — updated in DB and re-fetched

**Right-click context menu — on node (`onNodeContextMenu`):**
- Node name as header (small caps, text-3)
- Export node / Connect to... / Jump to node / Delete node (red)

**Right-click context menu — on canvas (`onPaneContextMenu`):**
- New node here (uses click coordinates as initial position) / Export map

**Jump-to-node animation:**
- Call `reactFlowInstance.fitView({ nodes: [targetNode], duration: 600 })`
- Node pulses via CSS class toggled for 2 cycles
- Toast notification confirms

### 5.4 Controls

**Zoom buttons:**
- Use React Flow `<Controls />` component — built-in zoom in/out/fit
- Style override: white background, var(--border) border, matches design system

**Mini-map:**
- Use React Flow `<MiniMap />` component — built-in, renders node positions
- `nodeColor` prop: purple for selected node, purple-mid for others
- `maskColor`: rgba overlay matching design system
- **Drag to navigate** — built into React Flow MiniMap natively
- Style: white background, border, border-radius 8px

### 5.5 Optimized Zoom Levels (Scale behavior)

| Zoom level | Node rendering |
|---|---|
| < 60% (far) | Skeleton ghost nodes — low-opacity pill, no label |
| 60%–100% | Node with label, no subtitle |
| > 100% (close) | Full node with label + subtitle |

### 5.6 Interaction — Desktop vs Mobile

**Desktop:**
- Drag nodes to reposition
- Scroll to zoom in/out
- Right-click for context menu

**Mobile:**
- Pinch to zoom
- Touch-drag to pan canvas
- Long-press node for context menu (replaces right-click)
- No drag-to-reposition on mobile

---

## 6. Memory Archives — Full Specification

### 6.1 Layout
- **Sidebar (280px):** Search + Folders + Collections
- **Main area:** Masonry card grid
- **Slide-in panel:** 440px from right (overlay)

### 6.2 Sidebar

**Search:**
- Full-width search, filters both sidebar and card grid

**Folders section:**
- Collapsible (chevron toggle)
- + button to create new folder
- Each folder row: folder icon + name + ··· menu (Rename, Delete)
- Hover: purple-light background

**Collections section:**
- Collapsible
- Lists all clusters as quick-jump items
- Each row: colored dot indicator (purple if active panel) + title + session count + ··· menu
- Click → opens that cluster's slide-in detail panel
- Dot color: purple if open, border-color if closed
- ··· menu: Rename cluster, Move to folder, Delete cluster

**Footer:**
- "Browse all quick notes" outlined button

### 6.3 Main Card Grid

**Page header:**
- "Archive Collections" — Fraunces serif, 32px, weight 400
- Subtitle description — 14px, text-2

**Hero card (featured/active cluster):**
- Full-width spanning the grid
- Left border accent: 3px solid var(--purple)
- Category label (10px, uppercase, text-3) + bullet + session count + bullet + "Last active X ago" (purple)
- Title: Fraunces serif, 26px, weight 400
- Description: 2 sentences max (13px, text-2, line-height 1.6)
- Tag pills + ··· overflow menu
- Hover: box-shadow + translateY(-1px)
- Click: opens slide-in detail panel

**Secondary cards (2-column grid):**
- Same structure at smaller scale
- Title: Fraunces serif, 18px
- Left border: 3px solid var(--purple-mid)
- Hover: same as hero card

**Card ··· menu:**
- Open details
- Move to folder
- Delete cluster (with confirmation)

### 6.4 Slide-in Detail Panel

**Trigger:** Click any cluster card

**Behavior:**
- Slides in from right, 440px wide
- Archive grid stays visible on left (not pushed, overlaid)
- Background overlay: rgba(0,0,0,0.1) — click to dismiss
- Close button (×) top-right

**Panel content:**

*Header:*
- Category + session count (small caps, text-3)
- Cluster title (Fraunces serif, 18px)

*Description section:*
- Full description text
- Tags row
- "Last active X ago" in purple

*Sessions section:*
- "Sessions" label in small caps
- Each session card: title + preview + timestamp + "Continue →" button
- "Continue" → closes panel + opens that session in Chat + auto-loads linked nodes

*Linked Brain Nodes section:*
- "Linked Brain Nodes" label
- Each node: link icon + name in purple-light pill

*Danger section:*
- "Delete cluster" button — red text, red border, trash icon

### 6.5 Delete Cluster Confirmation Modal

**Trigger:** "Delete cluster" from card menu or slide-in panel

**Modal:**
- Centered overlay, 380px wide, border-radius 14px
- Red circle icon with trash icon
- Title: "Delete '{cluster name}'?"
- Body: "This will permanently remove this cluster and all {N} associated sessions from memory. This cannot be undone."
- Buttons: "Cancel" (outlined) + "Delete cluster" (red background)
- On confirm: removes cluster from grid + sidebar + shows toast

---

## 7. Data Models

### 7.1 Node
```typescript
interface Node {
  id: string;           // uuid
  label: string;        // display name
  type: string;         // category (Technical, Research, etc.)
  summary: string;      // AI-generated description
  createdAt: Date;
  lastReferencedAt: Date;
  connectionCount: number;
  confidence: number;   // 0–1, drives edge opacity
  embedding?: number[]; // 768-dim vector from nomic-embed-text, stored in pgvector
  sessionIds: string[]; // sessions where this node appeared
}
```

### 7.2 Edge
```typescript
interface Edge {
  id: string;
  fromNodeId: string;
  toNodeId: string;
  type: "confirmed" | "suggested";
  confidence: number;   // 0–1, drives opacity
  relationshipLabel: string; // e.g. "shared topic cluster"
  occurrenceCount: number;  // how many times co-referenced
  createdAt: Date;
}
```

### 7.3 Session
```typescript
interface Session {
  id: string;
  title: string;
  preview: string;      // first user message summary
  createdAt: Date;
  updatedAt: Date;
  messages: Message[];
  activeNodeIds: string[];
  clusterId: string | null;
}
```

### 7.4 Message
```typescript
interface Message {
  id: string;
  role: "user" | "assistant";
  content: string;      // markdown
  timestamp: Date;
  nodeIdsUsed: string[]; // which nodes were active for this message
}
```

### 7.5 Cluster
```typescript
interface Cluster {
  id: string;
  title: string;
  category: string;
  description: string;  // AI-generated 2-sentence summary
  tags: string[];
  sessionIds: string[];
  nodeIds: string[];
  folderId: string | null;
  featured: boolean;    // active focus cluster
  createdAt: Date;
  lastActiveAt: Date;
}
```

### 7.6 Folder
```typescript
interface Folder {
  id: string;
  name: string;
  clusterIds: string[];
  createdAt: Date;
}
```

### 7.7 GraphPosition
```typescript
interface GraphPosition {
  nodeId: string;
  x: number;
  y: number;
}
```

### 7.8 OllamaModel
```typescript
// Returned by Ollama GET /api/tags
interface OllamaLocalModel {
  name: string;           // e.g. "qwen3.5:cloud"
  size: number;           // bytes on disk
  digest: string;
  modifiedAt: Date;
}

// Curated registry entry (lib/models-registry.ts)
interface ModelEntry {
  id: string;             // Ollama model tag e.g. "qwen3.5:cloud"
  label: string;          // Display name e.g. "Qwen 3.5"
  size: string;           // Human-readable e.g. "4.7 GB"
  params: string;         // Parameter count e.g. "7B"
}

// Combined model state used in the switcher
interface ModelSwitcherItem extends ModelEntry {
  status: "downloaded" | "pulling" | "available"
  pullProgress?: number   // 0–100 during pull
}
```

---

## 8. State Management

### 8.1 Client State — Zustand

Four stores. No React Context. No re-render storms.

```typescript
// store/global.ts
interface GlobalStore {
  activeTab: "chat" | "brain" | "archive"
  setActiveTab: (tab: GlobalStore["activeTab"]) => void
}

// store/chat.ts
interface ChatStore {
  activeSessionId: string | null
  activeNodes: Node[]           // AI-managed + @mention additions
  mode: "focus" | "explore"     // /mode command, default: explore
  activeModel: string           // Ollama model tag, default: "qwen3.5:cloud"
  pullingModels: Record<string, number>  // modelId → progress 0–100
  setActiveSession: (id: string) => void
  addNode: (node: Node) => void
  removeNode: (id: string) => void
  setMode: (mode: "focus" | "explore") => void
  clearNodes: () => void
  setActiveModel: (modelId: string) => void
  setPullProgress: (modelId: string, progress: number) => void
  clearPulling: (modelId: string) => void
}

// store/brain.ts
interface BrainStore {
  selectedNodeId: string | null
  setSelectedNode: (id: string | null) => void
}

// store/archive.ts
interface ArchiveStore {
  activePanelId: string | null
  deleteTargetId: string | null
  setActivePanel: (id: string | null) => void
  setDeleteTarget: (id: string | null) => void
}
```

**Zustand persist middleware** — ChatStore and BrainStore persist to `localStorage`:
```typescript
import { persist } from 'zustand/middleware'
// key: 'editorial-ai-chat', 'editorial-ai-brain'
// partialize: persist mode, activeSessionId, activeModel
// does NOT persist: activeNodes (re-hydrated per session), pullingModels (reset on reload)
```

### 8.2 Server State — TanStack Query v5

All data from Supabase goes through TanStack Query. Never store server data in Zustand.

```typescript
// Sessions list
useQuery({ queryKey: ['sessions'], queryFn: () => supabase.from('sessions').select() })

// Active session messages
useQuery({ queryKey: ['messages', sessionId], queryFn: ... })

// All nodes (Brain)
useQuery({ queryKey: ['nodes'], queryFn: ... })

// All edges
useQuery({ queryKey: ['edges'], queryFn: ... })

// Clusters (Archive)
useQuery({ queryKey: ['clusters'], queryFn: ... })
```

**Mutations with optimistic updates:**
```typescript
// Add node — optimistic
useMutation({
  mutationFn: createNode,
  onMutate: async (newNode) => {
    await queryClient.cancelQueries({ queryKey: ['nodes'] })
    const prev = queryClient.getQueryData(['nodes'])
    queryClient.setQueryData(['nodes'], (old) => [...old, newNode])
    return { prev }
  },
  onError: (_, __, ctx) => queryClient.setQueryData(['nodes'], ctx.prev),
  onSettled: () => queryClient.invalidateQueries({ queryKey: ['nodes'] })
})
```

### 8.3 React Flow State

React Flow manages its own internal state for node positions, viewport, and selection. Sync to DB on `onNodesChange` with a debounced save (500ms).

```typescript
const [nodes, setNodes, onNodesChange] = useNodesState(initialNodes)
const [edges, setEdges, onEdgesChange] = useEdgesState(initialEdges)

// Debounced position save
useEffect(() => {
  const timer = setTimeout(() => savePositions(nodes), 500)
  return () => clearTimeout(timer)
}, [nodes])
```

---

## 9. AI / LLM Integration

### 9.1 Model
- **Provider:** Ollama (local, self-hosted)
- **Model:** `qwen3.5:cloud`
- **SDK:** Vercel AI SDK v4 (`ai` + `ollama-ai-provider`)
- **Streaming:** handled automatically by `useChat()` hook
- **Base URL:** `http://localhost:11434` (default) — configurable via `OLLAMA_BASE_URL` env var

### 9.2 Chat Completion — Vercel AI SDK

**Route Handler** (`app/api/chat/route.ts`):
```typescript
import { ollama } from 'ollama-ai-provider'
import { streamText } from 'ai'

export async function POST(req: Request) {
  const { messages, activeNodes, mode, model: selectedModel = 'qwen3.5:cloud' } = await req.json()

  const systemPrompt = mode === 'focus'
    ? `You are MindDyte. Respond ONLY using the provided node context. Do not use information outside of the active nodes.\n\nActive nodes:\n${activeNodes.map((n: { label: string; summary: string }) => `- ${n.label}: ${n.summary}`).join('\n')}`
    : `You are MindDyte, a context-aware assistant. Use the provided node context to give informed responses. You may also draw on general knowledge.\n\nActive nodes:\n${activeNodes.map((n: { label: string; summary: string }) => `- ${n.label}: ${n.summary}`).join('\n')}`

  const result = streamText({
    model: ollama(selectedModel),  // whatever the user picked in the model switcher
    system: systemPrompt,
    messages,
    maxTokens: 2048,
  })

  return result.toDataStreamResponse()
}
```

**Ollama provider config** (`lib/ollama.ts`):
```typescript
import { createOllama } from 'ollama-ai-provider'

export const ollama = createOllama({
  baseURL: process.env.OLLAMA_BASE_URL ?? 'http://localhost:11434/api',
})
```

**Client hook** (`useChat` in `NeuralChat` component):
```typescript
const { activeModel } = useChatStore()

const { messages, input, handleInputChange, handleSubmit, isLoading, stop } = useChat({
  api: '/api/chat',
  body: { activeNodes, mode, model: activeModel },  // model sent on every request
  onFinish: (message) => {
    extractTopicFromMessage(message.content)
  }
})
```

`isLoading` drives the streaming dots indicator. `stop()` cancels generation.

### 9.3 Node Extraction (post-message)

Separate route handler (`app/api/extract/route.ts`) called via `onFinish`:
```typescript
import { ollama } from '@/lib/ollama'
import { generateText } from 'ai'

// Accepts the same active model the user is chatting with
// model param passed from client alongside messageContent
const { text } = await generateText({
  model: ollama(model),   // dynamic — matches user's active model selection
  prompt: `Extract the main topic and key facts from this AI response.
Return ONLY valid JSON, no markdown, no explanation:
{ "topic": string, "summary": string, "shouldCreateNode": boolean }
shouldCreateNode = true only if a genuinely new distinct topic was introduced.

Response: ${messageContent}`,
  maxTokens: 256,
})

const result = JSON.parse(text)
```

If `shouldCreateNode: true`:
1. Create node in Supabase `nodes` table
2. Generate embedding via Ollama `nomic-embed-text` → store in `embedding` column
3. Trigger edge suggestion pipeline

### 9.4 Edge Suggestion (post-node-creation)

Uses pgvector similarity search — **no LLM call needed for finding similar nodes**:
```sql
-- Find top 3 most similar existing nodes by embedding cosine distance
SELECT id, label, summary,
  1 - (embedding <=> $1::vector) AS similarity
FROM nodes
WHERE id != $2
ORDER BY embedding <=> $1::vector
LIMIT 3;
```

Then call the active model via Ollama to generate a `relationshipLabel` for each pair:
```typescript
// Only called for the top 3 results — generateText, not streaming
// model param passed from the calling context (same active model as chat)
const { text } = await generateText({
  model: ollama(model),   // dynamic — uses user's active model selection
  prompt: `In 5 words or less, describe the relationship between these two topics.
Topic A: ${newNode.label} — ${newNode.summary}
Topic B: ${similarNode.label} — ${similarNode.summary}
Return only the relationship phrase, nothing else.`,
  maxTokens: 20,
})
// e.g. "shared topic: distributed systems"
```

Auto-create edges with `confidence` = similarity score. No user approval.

### 9.5 AI Node Selection at Scale (per message)

When user sends a message, before calling `/api/chat`:
```typescript
import { embed } from 'ai'
import { ollama } from '@/lib/ollama'

// 1. Embed the user's message via Ollama nomic-embed-text (local, no API cost)
const { embedding: queryEmbedding } = await embed({
  model: ollama.embedding('nomic-embed-text'),
  value: userMessage,
})

// 2. pgvector cosine similarity search
const { data: relevantNodes } = await supabase.rpc('match_nodes', {
  query_embedding: queryEmbedding,
  match_threshold: 0.75,
  match_count: 8
})

// 3. Merge with @mentioned nodes (always included regardless of score)
const contextNodes = mergeUnique([...mentionedNodes, ...relevantNodes])
```

Supabase function `match_nodes`:
```sql
CREATE OR REPLACE FUNCTION match_nodes(
  query_embedding vector(768),
  match_threshold float,
  match_count int
)
RETURNS TABLE(id uuid, label text, summary text, similarity float)
LANGUAGE sql STABLE AS $$
  SELECT id, label, summary,
    1 - (embedding <=> query_embedding) AS similarity
  FROM nodes
  WHERE 1 - (embedding <=> query_embedding) > match_threshold
  ORDER BY embedding <=> query_embedding
  LIMIT match_count;
$$;
```

### 9.6 Cluster Generation (`/api/cluster/route.ts`)

Triggered by `/save` command or auto after 5+ sessions:
```typescript
// Prompt
`Group these conversation sessions into 3–8 thematic clusters.
Return ONLY valid JSON array:
[{
  "title": string,
  "category": string,          // e.g. "PHILOSOPHY", "CODING", "RESEARCH"
  "description": string,       // 2 sentences max
  "tags": string[],            // 3-5 tags
  "sessionIds": string[]
}]

Sessions: ${JSON.stringify(sessions.map(s => ({ id: s.id, title: s.title, preview: s.preview })))}`
```

### 9.7 /summarize Command

```typescript
// app/api/summarize/route.ts
`Summarize this conversation in 2 sentences for a session preview label.
Return plain text only, no formatting.

Messages: ${conversationText}`
```

Result saved to `sessions.preview` in Supabase.

### 9.9 Model Management API

**List downloaded models** (`GET /api/models`):
```typescript
// Proxies Ollama GET /api/tags
export async function GET() {
  const res = await fetch(`${process.env.OLLAMA_BASE_URL}/tags`)
  const { models } = await res.json()
  return Response.json(models)
}
```

**Pull a model** (`POST /api/models/pull`):
```typescript
// Streams Ollama pull progress back to the client
export async function POST(req: Request) {
  const { model } = await req.json()

  const ollamaRes = await fetch(`${process.env.OLLAMA_BASE_URL}/pull`, {
    method: 'POST',
    body: JSON.stringify({ name: model, stream: true }),
  })

  // Stream NDJSON progress lines → transform to SSE
  const stream = new ReadableStream({
    async start(controller) {
      const reader = ollamaRes.body!.getReader()
      const decoder = new TextDecoder()
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        const lines = decoder.decode(value).split('\n').filter(Boolean)
        for (const line of lines) {
          const data = JSON.parse(line)
          // { status: "pulling manifest" | "downloading", completed: N, total: N }
          const progress = data.total ? Math.round((data.completed / data.total) * 100) : 0
          controller.enqueue(`data: ${JSON.stringify({ status: data.status, progress })}\n\n`)
        }
      }
      controller.close()
    }
  })

  return new Response(stream, {
    headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' }
  })
}
```

**Delete a model** (`DELETE /api/models`):
```typescript
export async function DELETE(req: Request) {
  const { model } = await req.json()
  await fetch(`${process.env.OLLAMA_BASE_URL}/delete`, {
    method: 'DELETE',
    body: JSON.stringify({ name: model }),
  })
  return Response.json({ success: true })
}
```

**Client-side pull with progress** (inside ModelSwitcher component):
```typescript
const startPull = async (modelId: string) => {
  setPullProgress(modelId, 0)
  const res = await fetch('/api/models/pull', {
    method: 'POST', body: JSON.stringify({ model: modelId })
  })
  const reader = res.body!.getReader()
  const decoder = new TextDecoder()
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    const text = decoder.decode(value)
    const lines = text.split('\n').filter(l => l.startsWith('data:'))
    for (const line of lines) {
      const { progress } = JSON.parse(line.slice(6))
      setPullProgress(modelId, progress)
    }
  }
  clearPulling(modelId)
  queryClient.invalidateQueries({ queryKey: ['models'] })
  toast(`${modelId} ready`)
}
```
- **Provider:** Ollama (local, same instance as chat model)
- **Model:** `nomic-embed-text` — pull with `ollama pull nomic-embed-text`
- **Dimensions:** 768
- **SDK:** Vercel AI SDK `embed()` with `ollama.embedding('nomic-embed-text')`
- **When:** On node creation + on each user message (for similarity search)
- **Cost:** Free — runs entirely locally
- **Note:** pgvector column type must be `vector(768)` to match this model's output

---

## 10. Technology Stack

### 10.1 Full Stack

```
Framework:        Next.js 15 (App Router)
Language:         TypeScript 5 — strict mode enabled
Styling:          Tailwind CSS v4
Package manager:  Bun
```

### 10.2 Frontend

```
Client state:     Zustand v5 (+ persist middleware for localStorage)
Server state:     TanStack Query v5 (useQuery, useMutation, optimistic updates)
Graph canvas:     React Flow v12 (@xyflow/react)
Fonts:            Google Fonts — Fraunces + DM Sans
Markdown:         react-markdown + remark-gfm (AI message rendering)
```

### 10.3 AI / LLM

```
AI SDK:           Vercel AI SDK v4 (ai)
Ollama provider:  ollama-ai-provider
Default model:    qwen3.5:cloud  (user-switchable at runtime)
All LLM calls:    dynamically use activeModel from ChatStore — chat, extraction, edge labeling
Embeddings:       nomic-embed-text via Ollama (768 dimensions, fully local, fixed — not switchable)
Ollama base URL:  http://localhost:11434 (dev) — set OLLAMA_BASE_URL for production
```

**Required Ollama models — pull before running:**
```bash
ollama pull qwen3.5:cloud       # default chat model
ollama pull nomic-embed-text    # embeddings — always required regardless of active model
```

**Additional models available via model switcher** (pulled on demand by user):
```bash
ollama pull nemotron-3-super:cloud
ollama pull gemma4:31b-cloud
ollama pull gemma4
ollama pull qwen3.6
ollama pull qwen3.5:397B-cloud
ollama pull kimi-k2.5:cloud
```

### 10.4 Backend — Next.js Route Handlers (no separate server)

```
/app/api/chat/route.ts              POST — streaming chat completion (accepts model param)
/app/api/extract/route.ts           POST — node extraction from AI message
/app/api/cluster/route.ts           POST — cluster generation from sessions
/app/api/summarize/route.ts         POST — session summary for preview
/app/api/embed/route.ts             POST — generate embedding for a node
/app/api/models/route.ts            GET  — list downloaded Ollama models
                                    DELETE — remove a downloaded model
/app/api/models/pull/route.ts       POST — pull a model with streamed progress (SSE)
```

### 10.5 Database

```
Provider:         Supabase (PostgreSQL 15)
ORM:              Drizzle ORM (drizzle-orm + drizzle-kit)
Vector search:    pgvector extension (768-dim embeddings via nomic-embed-text, cosine distance)
Real-time:        Supabase Realtime (for future multi-user)
Auth:             Supabase Auth (magic link + Google OAuth)
Storage:          Supabase Storage (file attachments via paperclip)
```

### 10.6 Deployment

```
Hosting:          Vercel (native Next.js + Supabase integration)
CI/CD:            Vercel GitHub integration (auto preview deploys on PR)
Environment:      OLLAMA_BASE_URL (defaults to http://localhost:11434 in dev)
                  NEXT_PUBLIC_SUPABASE_URL
                  SUPABASE_SERVICE_ROLE_KEY
```

**`.env.local` template:**
```bash
# Ollama — no API key needed, just the base URL
OLLAMA_BASE_URL=http://localhost:11434/api

# Supabase
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-key
```

> **Production note:** For Vercel deployment, Ollama must be hosted on a reachable server (e.g. a VPS running Ollama with `OLLAMA_HOST=0.0.0.0`). Set `OLLAMA_BASE_URL` to that server's URL in Vercel environment settings.

### 10.7 Bootstrap Commands

```bash
bunx create-next-app@latest editorial-ai --typescript --tailwind --app --src-dir
cd editorial-ai

# Core dependencies
bun add ai ollama-ai-provider @xyflow/react
bun add zustand @tanstack/react-query
bun add @supabase/supabase-js drizzle-orm
bun add react-markdown remark-gfm

# Dev dependencies
bun add -d drizzle-kit @types/pg dotenv-cli

# Pull required Ollama models (Ollama must be installed)
ollama pull qwen3.5:cloud
ollama pull nomic-embed-text
```

---

## 11. Infrastructure — Memory Scaling

### 11.1 Contextual Zoom Levels (Brain)
- **Zoom < 60%:** Render skeleton nodes (ghost pill, no text, low opacity)
- **Zoom 60–100%:** Node label only
- **Zoom > 100%:** Full node with subtitle
- Implementation: check zoom level in render loop, conditionally render node detail

### 11.2 Gravity Decay (Brain)
- Nodes not referenced in 30+ days drift to canvas periphery
- Implementation: on each node position calculation, apply `decayFactor = daysSinceLastRef / 30`, multiply by distance multiplier in force simulation

### 11.3 Session Focus Mode (Brain)
- When a session is active, Brain highlights relevant nodes
- Dim all nodes not in `session.activeNodeIds` to 20% opacity
- Triggered by opening a session in Chat

### 11.4 Hierarchical Clusters (Archive)
- When cluster exceeds 8 sessions → auto-suggest sub-clustering
- Parent cluster collapses into folder with child clusters
- Implementation: watch cluster.sessionIds.length, trigger re-cluster API call

### 11.5 Cold Storage (Archive)
- Clusters inactive for 90 days → move to "Cold Storage" section
- Still accessible, just separated from active clusters
- Implementation: filter clusters by lastActiveAt < 90 days on Archive load

### 11.6 AI Node Selection at Scale
- Never load all nodes into context — use vector similarity search
- Index all node summaries as embeddings
- On each message, embed user query → cosine similarity → top-k nodes
- Pass only top 5-10 nodes as context, not all 1000+

---

## 12. Component Tree

```
App
├── Topbar
│   ├── Logo
│   ├── Nav (Chat | Neural Brain | Memory Archives)
│   └── SessionTitle + Icons
│
├── NeuralChat
│   ├── ChatSidebar
│   │   ├── NewSessionButton
│   │   ├── SearchBar
│   │   ├── SessionList
│   │   │   └── SessionItem (title, preview, timestamp, node badge, ··· menu)
│   │   ├── ActiveContextStrip
│   │   │   └── NodePill (label + × button)
│   │   └── Footer (Help, Feedback)
│   └── ChatMain
│       ├── MessageList (scrollable)
│       │   ├── UserMessage
│       │   └── AIMessage (avatar + content + structured items)
│       ├── StreamingIndicator (dots)
│       └── InputArea
│           ├── ActiveNodeStrip (read-only pills above textarea)
│           ├── SlashCommandPicker (floating)
│           ├── AtMentionPicker (floating)
│           ├── ModelSwitcher (floating, above input)
│           │   ├── SearchInput ("Find model...")
│           │   ├── DownloadedSection
│           │   │   └── ModelRow (name, active checkmark)
│           │   └── AvailableSection
│           │       └── ModelRow (name, size, download icon / spinner + progress)
│           ├── Textarea
│           └── Toolbar (paperclip, @Node button, model icon + name, Send)
│
├── NeuralBrain
│   ├── BrainSidebar
│   │   ├── SearchNodes
│   │   ├── SelectedNodeCard
│   │   └── NodeList (each with locate ⌖ + ··· menu)
│   └── GraphCanvas
│       ├── DotGridBackground (SVG pattern)
│       ├── CanvasHeader (title + Export + New Node)
│       ├── SVGEdgeLayer (confirmed + suggested edges)
│       ├── NodeLayer (draggable node cards)
│       ├── ContextMenu (right-click, node or canvas)
│       ├── ZoomControls (+ / −)
│       └── MiniMap
│
└── MemoryArchives
    ├── ArchiveSidebar
    │   ├── SearchBar
    │   ├── FoldersSection (collapsible)
    │   └── CollectionsSection (collapsible, quick-jump)
    ├── ArchiveGrid
    │   ├── PageHeader
    │   ├── HeroCard (featured cluster)
    │   └── CardGrid (2-column masonry)
    │       └── ClusterCard (hover, click)
    ├── SlideInPanel (overlay from right)
    │   ├── PanelHeader
    │   ├── DescriptionSection
    │   ├── SessionsList (each with Continue button)
    │   ├── LinkedNodesSection
    │   └── DeleteButton
    └── DeleteConfirmModal
```

---

## 13. Key Interaction Flows

### 13.1 First Message in New Session
1. User types message → hits Send
2. StreamingIndicator appears (3 dots)
3. API call: /api/chat with empty history, empty nodes (explore mode)
4. Stream tokens → render AI message progressively
5. After completion: extract topic/facts from response
6. If shouldCreateNode: create node in Brain silently
7. Suggest edges: AI picks top 3 similar nodes → auto-connect with pulse
8. Toast: "{NewNode} → {ExistingNode} connected"
9. Update active context strip with nodes used

### 13.2 @mention Flow
1. User types `@Kaf` → picker appears, shows filtered nodes
2. User selects "Kafka Pipeline" → input becomes `@Kafka Pipeline `
3. Node added to activeNodes → appears in context strip
4. Next message sent with Kafka Pipeline in context (regardless of mode)

### 13.3 Jump-to-Node Flow
1. User on Brain panel, clicks ⌖ on "Core Data Base" in sidebar
2. Canvas smoothly pans to center on that node (CSS transform transition)
3. Node pulses (box-shadow animation, 2 cycles)
4. Node selected → sidebar updates to show details
5. Toast: "Jumped to: Core Data Base"

### 13.4 Delete Cluster Flow
1. User clicks ··· on cluster → "Delete cluster"
2. OR: User opens slide-in panel → clicks "Delete cluster"
3. Confirmation modal appears with session count warning
4. User clicks "Delete cluster" (red)
5. Cluster removed from grid + sidebar
6. Associated sessions removed from session store
7. Associated nodes unlinked (not deleted — nodes persist unless explicitly deleted from Brain)
8. Toast: "Cluster and associated nodes removed"
9. Slide-in panel closes if that cluster was open

### 13.5 Continue Session from Archive
1. User opens cluster slide-in panel
2. User clicks "Continue →" on a session
3. App switches to Chat tab
4. That session becomes active
5. Linked nodes auto-loaded into active context strip
6. User can continue the conversation

---

## 14. Toast Notification System

- **Position:** Bottom center, fixed
- **Style:** Dark background (#1A1A2E), white text, 12px, border-radius 8px
- **Padding:** 9px 18px
- **Duration:** 2500ms auto-dismiss
- **Animation:** fade + translateY on enter, fade on exit
- **Queue:** New toast replaces previous (no stacking)
- **Z-index:** 1000+

**Standard toast messages:**
- `✓ {NodeName} added to context`
- `All active nodes cleared`
- `Jumped to: {NodeName}`
- `{NodeA} → {NodeB} connected`
- `Cluster and associated nodes removed`
- `Session saved to Memory Archive`

---

## 15. Empty States

### 15.1 New Chat Session
- Center-aligned in chat area
- Brand icon (large, purple)
- Title: "Start a conversation"
- Subtitle: "Type a message or use / for commands"
- Suggested prompts: 3 clickable chips with example questions
- Recently active nodes shown as "Load context from:" pills

### 15.2 Empty Brain Canvas
- Center: "No nodes yet"
- Subtext: "Nodes are created automatically as you chat, or type /node [name] to create one manually"
- Dot-grid background still visible

### 15.3 Empty Archive
- Center illustration
- "No collections yet"
- Subtext: "Your conversations will be automatically clustered here as you chat"

---

## 16. Accessibility

- All interactive elements: keyboard focusable
- Command pickers: full keyboard nav (↑↓ Enter Escape)
- Icons: aria-label or title attributes
- Color contrast: all text meets WCAG AA
- Focus rings: visible on all interactive elements
- Modal: focus trapped inside while open
- Tooltips on icon-only buttons

---

## 17. Responsive Behavior

### Desktop (> 1024px)
- Full three-column layout as designed
- Sidebar: 280px fixed

### Tablet (768–1024px)
- Sidebar collapses to icon-only rail (48px)
- Click icon → slide-out drawer

### Mobile (< 768px)
- Full-screen panels, no sidebar
- Bottom nav bar replaces topbar tabs
- Slide-in panels full-screen
- Brain: touch-pinch zoom, no right-click (long-press instead)
