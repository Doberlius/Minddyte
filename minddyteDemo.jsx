import { useState, useRef, useEffect } from "react";
import {
  Brain, MessageSquare, BookOpen, Search, Plus, X, Send,
  Paperclip, AtSign, Cpu, Folder, Link2, Crosshair, Trash2,
  Download, Check, ZoomIn, ZoomOut, Settings, User,
  MoreHorizontal, ArrowRight, ChevronDown, Sparkles, Circle
} from "lucide-react";

// ─────────────────────────────────────────────────────────────
// DATA
// ─────────────────────────────────────────────────────────────
const SESSIONS = [
  { id: 1, title: "Synthesis of Q3 Earnings", preview: "Summary of the latest earnings call and projections.", time: "Today, 2:14 PM", nodes: 2 },
  { id: 2, title: "Architectural Patterns Review", preview: "Discussing event streaming vs batch processing.", time: "Yesterday, 10:50 AM", nodes: 4 },
  { id: 3, title: "Drafting Project Proposal", preview: "Initial outline for the new client initiative.", time: "Mon, 4:00 PM", nodes: 1 },
];

const ALL_NODES = [
  { id: 1, label: "System Architecture", type: "Technical", connections: 4 },
  { id: 2, label: "Q3 Metrics", type: "Analytics", connections: 3 },
  { id: 3, label: "Adaptive Learning", type: "AI/ML", connections: 2 },
  { id: 4, label: "Core Data Base", type: "Infrastructure", connections: 5 },
  { id: 5, label: "Linguistic Patterns", type: "Research", connections: 2 },
  { id: 6, label: "Semantic Search", type: "Technical", connections: 3 },
  { id: 7, label: "Platform Architecture V2", type: "Technical", connections: 6 },
  { id: 8, label: "Ethics Framework", type: "Philosophy", connections: 2 },
];

const SLASH_COMMANDS = [
  { cmd: "/help",      desc: "Show all available commands" },
  { cmd: "/memory",    desc: "Show active nodes this session" },
  { cmd: "/mode",      desc: "Switch focus | explore mode" },
  { cmd: "/clear",     desc: "Clear all active nodes" },
  { cmd: "/save",      desc: "Save session to Memory Archive" },
  { cmd: "/connect",   desc: "Manually attach a node" },
  { cmd: "/forget",    desc: "Detach a specific node" },
  { cmd: "/summarize", desc: "Summarize this conversation" },
  { cmd: "/node",      desc: "Create a new Brain node" },
  { cmd: "/rename",    desc: "Rename the current session" },
  { cmd: "/new",       desc: "Start a new session" },
  { cmd: "/search",    desc: "Search sessions and nodes" },
  { cmd: "/brain",     desc: "Open mini Brain panel inline" },
  { cmd: "/model",     desc: "Open model switcher" },
];

const MODEL_REGISTRY = [
  { id: "qwen3.5:cloud",         label: "Qwen 3.5",          size: "4.7 GB",  downloaded: true  },
  { id: "gemma4",                label: "Gemma 4",           size: "5.0 GB",  downloaded: true  },
  { id: "qwen3.6",               label: "Qwen 3.6",          size: "5.2 GB",  downloaded: true  },
  { id: "nemotron-3-super:cloud",label: "Nemotron 3 Super",  size: "12 GB",   downloaded: false },
  { id: "gemma4:31b-cloud",      label: "Gemma 4 31B",       size: "19 GB",   downloaded: false },
  { id: "qwen3.5:397B-cloud",    label: "Qwen 3.5 397B",     size: "230 GB",  downloaded: false },
  { id: "kimi-k2.5:cloud",       label: "Kimi K2.5",         size: "9.8 GB",  downloaded: false },
];

const GRAPH_NODES_INIT = [
  { id: 1, label: "Adaptive Learning",  sub: "New Insight Cluster", x: 160, y: 200 },
  { id: 2, label: "Core Data Base",     sub: "Primary Hub",         x: 440, y: 295 },
  { id: 3, label: "Linguistic Patterns",sub: "Linked Node",         x: 640, y: 145 },
  { id: 4, label: "Semantic Search",    sub: "Secondary Link",      x: 610, y: 400 },
];

const GRAPH_EDGES = [
  { from: 1, to: 2, dashed: true },
  { from: 1, to: 3, dashed: true },
  { from: 2, to: 3, dashed: false },
  { from: 2, to: 4, dashed: false },
];

const CLUSTERS = [
  { id: 1, title: "The Ethics of Autonomous Agents", category: "PHILOSOPHY", sessions: 12, lastActive: "2 hours ago", featured: true,
    desc: "Explorations into the moral frameworks required for self-directing AI systems. Discussions cover utilitarian vs. deontological approaches and bias mitigation.",
    tags: ["Philosophy", "Frameworks", "Long-term Safety"],
    sessionList: [
      { id: 1, title: "Moral frameworks overview", preview: "Utilitarian vs deontological debate", time: "Today, 9:41 AM" },
      { id: 2, title: "Bias in training data", preview: "Systemic bias detection methods", time: "Yesterday, 3:20 PM" },
      { id: 3, title: "Machine consciousness", preview: "Philosophical implications of sentient AI", time: "Mon, 11:00 AM" },
    ],
    linkedNodes: ["Ethics Framework", "Adaptive Learning"] },
  { id: 2, title: 'Worldbuilding: "Aetheria"', category: "CREATIVE DRAFTS", sessions: 8, lastActive: "3 weeks ago", featured: false,
    desc: "Constructing the socio-political dynamics, magic systems, and geographical maps for the upcoming fantasy novel project.",
    tags: ["Creative Writing"],
    sessionList: [{ id: 1, title: "Magic system rules", preview: "Hard vs soft magic debate", time: "3 weeks ago" }],
    linkedNodes: ["Linguistic Patterns"] },
  { id: 3, title: "Platform Architecture V2", category: "CODING", sessions: 24, lastActive: "3 weeks ago", featured: false,
    desc: "Technical specifications, API endpoint designs, and database schema migrations for the core system overhaul.",
    tags: ["System Design", "API"],
    sessionList: [{ id: 1, title: "API endpoint design", preview: "REST vs GraphQL evaluation", time: "3 weeks ago" }],
    linkedNodes: ["Core Data Base", "System Architecture"] },
  { id: 4, title: "Cognitive Behavioral Mode", category: "RESEARCH", sessions: 5, lastActive: "3 weeks ago", featured: false,
    desc: "Reviewing literature on modern CBT applications and synthesizing key intervention strategies for digital health tools.",
    tags: ["Psychology", "Research"],
    sessionList: [{ id: 1, title: "CBT literature review", preview: "Digital intervention efficacy", time: "3 weeks ago" }],
    linkedNodes: ["Semantic Search"] },
];

// ─────────────────────────────────────────────────────────────
// STYLES
// ─────────────────────────────────────────────────────────────
const GLOBAL_CSS = `
@import url('https://fonts.googleapis.com/css2?family=Fraunces:ital,opsz,wght@0,9..144,300;0,9..144,400;0,9..144,500;0,9..144,600;1,9..144,300&family=DM+Sans:opsz,wght@9..40,300;9..40,400;9..40,500;9..40,600&display=swap');
*{box-sizing:border-box;margin:0;padding:0}
:root{
  --ink:#1A1A2E; --ink2:#6B7280; --ink3:#9CA3AF;
  --violet:#4F46E8; --violet-l:#EEF0FD; --violet-m:#C7C3F7;
  --border:#E5E7EB; --border2:#F3F4F6;
  --bg:#F8F8FC; --white:#FFFFFF; --red:#EF4444;
}
html,body{height:100%;font-family:'DM Sans',sans-serif;background:var(--bg);color:var(--ink)}
::-webkit-scrollbar{width:3px;height:3px}
::-webkit-scrollbar-track{background:transparent}
::-webkit-scrollbar-thumb{background:var(--border);border-radius:2px}

@keyframes wave{0%,60%,100%{transform:translateY(0);opacity:.4}30%{transform:translateY(-5px);opacity:1}}
.dot{display:inline-block;width:6px;height:6px;border-radius:50%;background:var(--violet);animation:wave 1.2s infinite}
.dot:nth-child(2){animation-delay:.2s}
.dot:nth-child(3){animation-delay:.4s}

@keyframes slide-in{from{transform:translateX(100%);opacity:0}to{transform:translateX(0);opacity:1}}
.slide-in{animation:slide-in .28s cubic-bezier(.22,.68,0,1.1)}

@keyframes pop{from{opacity:0;transform:scale(.96) translateY(4px)}to{opacity:1;transform:scale(1) translateY(0)}}
.pop{animation:pop .15s ease}

@keyframes fade-up{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:translateY(0)}}
.fade-up{animation:fade-up .2s ease}

@keyframes pulse-ring{0%{box-shadow:0 0 0 0 rgba(79,70,232,.4)}100%{box-shadow:0 0 0 12px rgba(79,70,232,0)}}
.pulse{animation:pulse-ring .8s ease 2}

.btn-ghost{background:none;border:none;cursor:pointer;display:flex;align-items:center;justify-content:center;border-radius:6px;transition:background .12s, color .12s}
.btn-ghost:hover{background:var(--violet-l);color:var(--violet)}
.sess-item{cursor:pointer;border-radius:8px;transition:background .12s}
.sess-item:hover{background:#F5F4FF}
.sess-item.active{background:var(--violet-l)}
.node-row{cursor:pointer;border-radius:7px;transition:background .12s}
.node-row:hover{background:var(--violet-l)}
.card{cursor:pointer;transition:box-shadow .2s, transform .15s;border-radius:12px}
.card:hover{box-shadow:0 6px 24px rgba(79,70,232,.12);transform:translateY(-2px)}
.cmd-row{cursor:pointer;transition:background .1s}
.cmd-row:hover,.cmd-row.hi{background:var(--violet-l)}
.at-row{cursor:pointer;transition:background .1s}
.at-row:hover,.at-row.hi{background:var(--violet-l)}
.model-row{cursor:pointer;padding:8px 12px;border-radius:8px;transition:background .1s}
.model-row:hover{background:var(--violet-l)}
.g-node{cursor:grab;user-select:none}
.g-node:active{cursor:grabbing}
`;

// ─────────────────────────────────────────────────────────────
// NEURAL CHAT
// ─────────────────────────────────────────────────────────────
function NeuralChat() {
  const [activeSession, setActiveSession] = useState(2);
  const [input, setInput] = useState("");
  const [showSlash, setShowSlash] = useState(false);
  const [showAt, setShowAt] = useState(false);
  const [showModel, setShowModel] = useState(false);
  const [slashIdx, setSlashIdx] = useState(0);
  const [atIdx, setAtIdx] = useState(0);
  const [activeNodes, setActiveNodes] = useState([ALL_NODES[0], ALL_NODES[1]]);
  const [activeModel, setActiveModel] = useState("qwen3.5:cloud");
  const [toast, setToast] = useState("");
  const [streaming] = useState(true);
  const inputRef = useRef(null);
  const messagesRef = useRef(null);

  const slashFilter = input.split(" ").pop().startsWith("/") ? input.split(" ").pop() : "";
  const atFilter = input.split(" ").pop().startsWith("@") ? input.split(" ").pop().slice(1) : "";
  const filteredCmds = SLASH_COMMANDS.filter(c => c.cmd.startsWith(slashFilter));
  const filteredNodes = ALL_NODES.filter(n => n.label.toLowerCase().includes(atFilter.toLowerCase()));

  const showToast = (msg) => {
    setToast(msg);
    setTimeout(() => setToast(""), 2200);
  };

  const handleInput = (e) => {
    const val = e.target.value;
    setInput(val);
    const last = val.split(" ").pop();
    if (last.startsWith("/") && last.length > 0) {
      setShowSlash(true); setShowAt(false); setShowModel(false); setSlashIdx(0);
    } else if (last.startsWith("@")) {
      setShowAt(true); setShowSlash(false); setShowModel(false); setAtIdx(0);
    } else {
      setShowSlash(false); setShowAt(false);
    }
  };

  const selectCmd = (cmd) => {
    const parts = input.split(" ");
    parts[parts.length - 1] = cmd + " ";
    setInput(parts.join(" "));
    setShowSlash(false);
    if (inputRef.current) inputRef.current.focus();
    if (cmd === "/clear") { setActiveNodes([]); showToast("All active nodes cleared"); }
    if (cmd === "/memory") showToast("🧠 Using: " + activeNodes.map(n => n.label).join(" · "));
    if (cmd === "/model") setShowModel(true);
  };

  const selectNode = (node) => {
    const parts = input.split(" ");
    parts[parts.length - 1] = "@" + node.label + " ";
    setInput(parts.join(" "));
    setShowAt(false);
    if (!activeNodes.find(n => n.id === node.id)) {
      setActiveNodes(prev => [...prev, node]);
      showToast("✓ " + node.label + " added to context");
    }
    if (inputRef.current) inputRef.current.focus();
  };

  const handleKeyDown = (e) => {
    if (showSlash) {
      if (e.key === "ArrowDown") { e.preventDefault(); setSlashIdx(i => Math.min(i+1, filteredCmds.length-1)); }
      if (e.key === "ArrowUp")   { e.preventDefault(); setSlashIdx(i => Math.max(i-1, 0)); }
      if (e.key === "Enter")     { e.preventDefault(); if (filteredCmds[slashIdx]) selectCmd(filteredCmds[slashIdx].cmd); }
      if (e.key === "Escape")    { setShowSlash(false); }
    } else if (showAt) {
      if (e.key === "ArrowDown") { e.preventDefault(); setAtIdx(i => Math.min(i+1, filteredNodes.length-1)); }
      if (e.key === "ArrowUp")   { e.preventDefault(); setAtIdx(i => Math.max(i-1, 0)); }
      if (e.key === "Enter")     { e.preventDefault(); if (filteredNodes[atIdx]) selectNode(filteredNodes[atIdx]); }
      if (e.key === "Escape")    { setShowAt(false); }
    }
  };

  const session = SESSIONS.find(s => s.id === activeSession);
  const modelLabel = MODEL_REGISTRY.find(m => m.id === activeModel);

  return (
    <div style={{ display:"flex", height:"100%", overflow:"hidden" }}>
      {/* Sidebar */}
      <div style={{ width:280, borderRight:"1px solid var(--border)", display:"flex", flexDirection:"column", background:"var(--white)", flexShrink:0 }}>
        <div style={{ padding:"14px 14px 10px" }}>
          <button style={{ width:"100%", background:"var(--violet)", color:"#fff", border:"none", borderRadius:10, padding:"10px 0", fontSize:13, fontWeight:600, cursor:"pointer", display:"flex", alignItems:"center", justifyContent:"center", gap:6, fontFamily:"'DM Sans',sans-serif" }}>
            <Plus size={14}/> New Session
          </button>
        </div>
        <div style={{ padding:"0 14px 10px" }}>
          <div style={{ display:"flex", alignItems:"center", gap:8, background:"var(--bg)", borderRadius:8, border:"1px solid var(--border)", padding:"7px 10px" }}>
            <Search size={13} color="var(--ink3)"/>
            <input placeholder="Search history..." style={{ border:"none", background:"transparent", fontSize:12, color:"var(--ink)", outline:"none", width:"100%", fontFamily:"'DM Sans',sans-serif" }}/>
          </div>
        </div>
        <div style={{ flex:1, overflowY:"auto", padding:"0 8px" }}>
          {SESSIONS.map(s => (
            <div key={s.id} className={"sess-item" + (activeSession===s.id?" active":"")} onClick={() => setActiveSession(s.id)}
              style={{ padding:"10px 10px", marginBottom:2 }}>
              <div style={{ display:"flex", justifyContent:"space-between", gap:6 }}>
                <div style={{ flex:1, minWidth:0 }}>
                  <p style={{ fontSize:13, fontWeight:600, marginBottom:2, whiteSpace:"nowrap", overflow:"hidden", textOverflow:"ellipsis" }}>{s.title}</p>
                  <p style={{ fontSize:11, color:"var(--ink2)", marginBottom:4, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{s.preview}</p>
                  <div style={{ display:"flex", alignItems:"center", gap:6 }}>
                    <span style={{ fontSize:10, color:"var(--ink3)" }}>{s.time}</span>
                    <span style={{ fontSize:10, fontWeight:600, padding:"1px 7px", borderRadius:20, background:"var(--violet-l)", color:"var(--violet)" }}>{s.nodes} nodes</span>
                  </div>
                </div>
                <button className="btn-ghost" style={{ padding:3, color:"var(--ink3)", alignSelf:"flex-start" }}><MoreHorizontal size={13}/></button>
              </div>
            </div>
          ))}
        </div>
        {/* Active context strip */}
        {activeNodes.length > 0 && (
          <div style={{ borderTop:"1px solid var(--border)", padding:"10px 14px", background:"var(--white)" }}>
            <div style={{ display:"flex", alignItems:"center", gap:5, marginBottom:7 }}>
              <div style={{ width:6, height:6, borderRadius:"50%", background:"var(--violet)" }}/>
              <span style={{ fontSize:10, fontWeight:600, letterSpacing:".06em", textTransform:"uppercase", color:"var(--ink3)" }}>AI Context</span>
            </div>
            {activeNodes.map(n => (
              <div key={n.id} style={{ display:"flex", alignItems:"center", justifyContent:"space-between", padding:"5px 8px", borderRadius:6, background:"var(--violet-l)", marginBottom:4 }}>
                <span style={{ fontSize:11, color:"var(--violet)", fontWeight:500 }}>{n.label}</span>
                <button onClick={() => setActiveNodes(prev => prev.filter(x => x.id !== n.id))}
                  style={{ background:"none", border:"none", cursor:"pointer", color:"var(--violet)", padding:0, display:"flex" }}>
                  <X size={11}/>
                </button>
              </div>
            ))}
          </div>
        )}
        <div style={{ borderTop:"1px solid var(--border)", padding:"10px 14px", display:"flex", gap:16 }}>
          <button style={{ fontSize:11, color:"var(--ink2)", background:"none", border:"none", cursor:"pointer", fontFamily:"'DM Sans',sans-serif" }}>Help</button>
          <button style={{ fontSize:11, color:"var(--ink2)", background:"none", border:"none", cursor:"pointer", fontFamily:"'DM Sans',sans-serif" }}>Feedback</button>
        </div>
      </div>

      {/* Chat main */}
      <div style={{ flex:1, display:"flex", flexDirection:"column", overflow:"hidden" }}>
        <div ref={messagesRef} style={{ flex:1, overflowY:"auto", padding:"36px 44px" }}>
          {/* User bubble */}
          <div style={{ display:"flex", justifyContent:"flex-end", marginBottom:28 }}>
            <div style={{ maxWidth:560, background:"var(--bg)", border:"1px solid var(--border)", borderRadius:"16px 16px 4px 16px", padding:"14px 18px", fontSize:14, lineHeight:1.65, color:"var(--ink)" }}>
              Can you synthesize the key architectural decisions we made regarding the event streaming pipeline? I need to ensure we have accounted for the expected Q3 load metrics.
            </div>
          </div>
          {/* AI bubble */}
          <div style={{ display:"flex", gap:14, marginBottom:28 }}>
            <div style={{ width:36, height:36, borderRadius:"50%", background:"var(--violet)", display:"flex", alignItems:"center", justifyContent:"center", color:"#fff", flexShrink:0 }}>
              <Brain size={16}/>
            </div>
            <div style={{ flex:1, maxWidth:640 }}>
              <p style={{ fontSize:14, lineHeight:1.7, marginBottom:14 }}>Based on the nodes currently loaded — <strong>System Architecture</strong> and <strong>Q3 Metrics</strong> — here is a synthesis of our structural commitments.</p>
              <p style={{ fontSize:14, lineHeight:1.7, marginBottom:14 }}>We transitioned to a highly decoupled Kafka-based architecture to manage the projected 400% increase in data ingress by end of Q3. The pivotal decisions center around isolation and resilience:</p>
              {[
                { t:"Partition Strategy Redesign", b:"We opted to over-partition our high-throughput topics by a factor of 4, anticipating the Q3 load spikes. This allows us to scale out consumers horizontally." },
                { t:"Schema Registry Enforcement", b:"Strict Avro schema validation at the ingress layer prevents malformed payloads from poisoning the downstream analytical views." },
              ].map((item,i) => (
                <div key={i} style={{ display:"flex", gap:10, marginBottom:12, padding:"11px 13px", background:"var(--bg)", borderRadius:8, border:"1px solid var(--border)" }}>
                  <div style={{ width:16, height:16, borderRadius:"50%", border:"2px solid var(--violet)", display:"flex", alignItems:"center", justifyContent:"center", flexShrink:0, marginTop:2 }}>
                    <Check size={8} color="var(--violet)" strokeWidth={3}/>
                  </div>
                  <div>
                    <p style={{ fontSize:13, fontWeight:600, marginBottom:3 }}>{item.t}</p>
                    <p style={{ fontSize:13, color:"var(--ink2)", lineHeight:1.55 }}>{item.b}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
          {/* Streaming */}
          {streaming && (
            <div className="fade-up" style={{ display:"flex", gap:14, alignItems:"center" }}>
              <div style={{ width:36, height:36, borderRadius:"50%", background:"var(--violet)", display:"flex", alignItems:"center", justifyContent:"center", color:"#fff", flexShrink:0 }}>
                <Brain size={16}/>
              </div>
              <div style={{ display:"flex", gap:5, alignItems:"center", padding:"10px 14px", background:"var(--bg)", border:"1px solid var(--border)", borderRadius:"12px 12px 12px 4px" }}>
                <span className="dot"/><span className="dot"/><span className="dot"/>
              </div>
            </div>
          )}
        </div>

        {/* Input area */}
        <div style={{ borderTop:"1px solid var(--border)", padding:"12px 20px 16px", background:"var(--white)", position:"relative" }}>
          {/* Slash picker */}
          {showSlash && filteredCmds.length > 0 && (
            <div className="pop" style={{ position:"absolute", bottom:"100%", left:20, right:20, background:"var(--white)", border:"1px solid var(--border)", borderRadius:10, boxShadow:"0 8px 32px rgba(0,0,0,.1)", marginBottom:4, overflow:"hidden", maxHeight:280, overflowY:"auto" }}>
              <div style={{ padding:"7px 12px 5px", borderBottom:"1px solid var(--border2)" }}>
                <span style={{ fontSize:10, fontWeight:600, color:"var(--ink3)", letterSpacing:".06em", textTransform:"uppercase" }}>Commands</span>
              </div>
              {filteredCmds.map((c,i) => (
                <div key={c.cmd} className={"cmd-row"+(i===slashIdx?" hi":"")} onClick={() => selectCmd(c.cmd)}
                  style={{ padding:"8px 13px", display:"flex", gap:12, alignItems:"center" }}>
                  <code style={{ fontSize:12, fontWeight:700, color:"var(--violet)", minWidth:100 }}>{c.cmd}</code>
                  <span style={{ fontSize:12, color:"var(--ink2)" }}>{c.desc}</span>
                </div>
              ))}
            </div>
          )}
          {/* @ picker */}
          {showAt && filteredNodes.length > 0 && (
            <div className="pop" style={{ position:"absolute", bottom:"100%", left:20, right:20, background:"var(--white)", border:"1px solid var(--border)", borderRadius:10, boxShadow:"0 8px 32px rgba(0,0,0,.1)", marginBottom:4, overflow:"hidden", maxHeight:260, overflowY:"auto" }}>
              <div style={{ padding:"7px 12px 5px", borderBottom:"1px solid var(--border2)" }}>
                <span style={{ fontSize:10, fontWeight:600, color:"var(--ink3)", letterSpacing:".06em", textTransform:"uppercase" }}>Nodes — {filteredNodes.length} available</span>
              </div>
              {filteredNodes.map((n,i) => (
                <div key={n.id} className={"at-row"+(i===atIdx?" hi":"")} onClick={() => selectNode(n)}
                  style={{ padding:"9px 13px", display:"flex", alignItems:"center", justifyContent:"space-between" }}>
                  <div>
                    <p style={{ fontSize:13, fontWeight:500 }}>{n.label}</p>
                    <p style={{ fontSize:11, color:"var(--ink3)" }}>{n.type} · {n.connections} connections</p>
                  </div>
                  <Link2 size={12} color="var(--ink3)"/>
                </div>
              ))}
            </div>
          )}
          {/* Model switcher */}
          {showModel && (
            <>
              <div onClick={() => setShowModel(false)} style={{ position:"fixed", inset:0, zIndex:40 }}/>
              <div className="pop" style={{ position:"absolute", bottom:"100%", left:20, width:280, background:"var(--white)", border:"1px solid var(--border)", borderRadius:10, boxShadow:"0 8px 32px rgba(0,0,0,.12)", marginBottom:4, overflow:"hidden", zIndex:50 }}>
                <div style={{ padding:"8px 12px 6px", borderBottom:"1px solid var(--border2)" }}>
                  <input placeholder="Find model..." style={{ width:"100%", border:"none", outline:"none", fontSize:12, color:"var(--ink)", fontFamily:"'DM Sans',sans-serif" }}/>
                </div>
                <div style={{ padding:"4px 0" }}>
                  <p style={{ fontSize:10, fontWeight:600, color:"var(--ink3)", letterSpacing:".05em", textTransform:"uppercase", padding:"4px 12px 2px" }}>Downloaded</p>
                  {MODEL_REGISTRY.filter(m => m.downloaded).map(m => (
                    <div key={m.id} className="model-row" onClick={() => { setActiveModel(m.id); setShowModel(false); showToast("Switched to " + m.label); }}
                      style={{ display:"flex", alignItems:"center", justifyContent:"space-between" }}>
                      <div>
                        <p style={{ fontSize:13, fontWeight:500 }}>{m.label}</p>
                        <p style={{ fontSize:11, color:"var(--ink3)" }}>{m.size}</p>
                      </div>
                      {activeModel === m.id && <Check size={14} color="var(--violet)"/>}
                    </div>
                  ))}
                  <p style={{ fontSize:10, fontWeight:600, color:"var(--ink3)", letterSpacing:".05em", textTransform:"uppercase", padding:"8px 12px 2px" }}>Available to pull</p>
                  {MODEL_REGISTRY.filter(m => !m.downloaded).map(m => (
                    <div key={m.id} className="model-row" style={{ display:"flex", alignItems:"center", justifyContent:"space-between" }}>
                      <div>
                        <p style={{ fontSize:13, fontWeight:500, color:"var(--ink2)" }}>{m.label}</p>
                        <p style={{ fontSize:11, color:"var(--ink3)" }}>{m.size}</p>
                      </div>
                      <Download size={14} color="var(--ink3)"/>
                    </div>
                  ))}
                </div>
              </div>
            </>
          )}
          {/* Active node pills */}
          {activeNodes.length > 0 && (
            <div style={{ display:"flex", alignItems:"center", gap:6, marginBottom:9, flexWrap:"wrap" }}>
              <Brain size={13} color="var(--ink3)"/>
              <span style={{ fontSize:11, color:"var(--ink3)", fontWeight:500 }}>Using:</span>
              {activeNodes.map(n => (
                <span key={n.id} style={{ display:"inline-flex", alignItems:"center", gap:4, fontSize:11, fontWeight:500, padding:"2px 8px", borderRadius:20, background:"var(--violet-l)", color:"var(--violet)", border:"1px solid var(--violet-m)" }}>
                  {n.label}
                  <button onClick={() => setActiveNodes(p => p.filter(x => x.id !== n.id))}
                    style={{ background:"none", border:"none", cursor:"pointer", color:"var(--violet)", padding:0, display:"flex" }}>
                    <X size={10}/>
                  </button>
                </span>
              ))}
            </div>
          )}
          <textarea ref={inputRef} value={input} onChange={handleInput} onKeyDown={handleKeyDown}
            placeholder="Ask anything — type / for commands or @ for nodes"
            style={{ width:"100%", border:"1px solid var(--border)", borderRadius:12, padding:"12px 16px", fontSize:13, fontFamily:"'DM Sans',sans-serif", color:"var(--ink)", outline:"none", resize:"none", height:78, lineHeight:1.6, background:"var(--bg)" }}
          />
          <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginTop:8 }}>
            <div style={{ display:"flex", gap:8 }}>
              <button className="btn-ghost" title="Attach file" style={{ padding:"5px 8px", color:"var(--ink3)", gap:4, fontSize:11 }}><Paperclip size={14}/></button>
              <button className="btn-ghost" title="@mention a node" onClick={() => { setInput(prev => prev+"@"); setShowAt(true); if(inputRef.current) inputRef.current.focus(); }}
                style={{ padding:"5px 8px", color:"var(--ink3)", gap:4, fontSize:11 }}><AtSign size={14}/><span>Node</span></button>
              <button className="btn-ghost" title="Switch model" onClick={() => setShowModel(v => !v)}
                style={{ padding:"5px 9px", color:"var(--ink3)", gap:5, fontSize:11, border:"1px solid var(--border)", borderRadius:7 }}>
                <Cpu size={13}/>
                <span>{modelLabel ? modelLabel.label : activeModel}</span>
                <ChevronDown size={11}/>
              </button>
            </div>
            <button style={{ background:"var(--violet)", color:"#fff", border:"none", borderRadius:8, padding:"8px 18px", fontSize:13, fontWeight:600, cursor:"pointer", display:"flex", alignItems:"center", gap:6, fontFamily:"'DM Sans',sans-serif" }}>
              Send <Send size={13}/>
            </button>
          </div>
          <p style={{ fontSize:11, color:"var(--ink3)", textAlign:"center", marginTop:8 }}>Editorial AI generates context-aware responses based on linked memory nodes.</p>
        </div>
      </div>
      {toast && (
        <div className="pop" style={{ position:"fixed", bottom:24, left:"50%", transform:"translateX(-50%)", background:"var(--ink)", color:"#fff", padding:"9px 18px", borderRadius:8, fontSize:12, fontWeight:500, zIndex:1000, whiteSpace:"nowrap" }}>
          {toast}
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// NEURAL BRAIN
// ─────────────────────────────────────────────────────────────
function NeuralBrain() {
  const [positions, setPositions] = useState(() => {
    const pos = {};
    GRAPH_NODES_INIT.forEach(n => { pos[n.id] = { x: n.x, y: n.y }; });
    return pos;
  });
  const [selectedId, setSelectedId] = useState(1);
  const [ctxMenu, setCtxMenu] = useState(null);
  const [pulseId, setPulseId] = useState(null);
  const [toast, setToast] = useState("");
  const dragRef = useRef(null);
  const canvasRef = useRef(null);

  const showToast = (msg) => { setToast(msg); setTimeout(() => setToast(""), 2000); };

  const jumpTo = (node) => {
    setSelectedId(node.id);
    setPulseId(node.id);
    setTimeout(() => setPulseId(null), 1800);
    showToast("Jumped to: " + node.label);
  };

  useEffect(() => {
    const onMove = (e) => {
      if (!dragRef.current) return;
      const { id, sx, sy } = dragRef.current;
      const dx = e.clientX - sx;
      const dy = e.clientY - sy;
      dragRef.current.sx = e.clientX;
      dragRef.current.sy = e.clientY;
      setPositions(prev => ({
        ...prev,
        [id]: { x: prev[id].x + dx, y: prev[id].y + dy }
      }));
    };
    const onUp = () => { dragRef.current = null; };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => { window.removeEventListener("mousemove", onMove); window.removeEventListener("mouseup", onUp); };
  }, []);

  const handleNodeMouseDown = (e, id) => {
    e.preventDefault();
    e.stopPropagation();
    setSelectedId(id);
    dragRef.current = { id, sx: e.clientX, sy: e.clientY };
  };

  const handleCanvasRightClick = (e) => {
    e.preventDefault();
    const rect = canvasRef.current.getBoundingClientRect();
    setCtxMenu({ x: e.clientX - rect.left, y: e.clientY - rect.top, type: "canvas", node: null });
  };

  const handleNodeRightClick = (e, node) => {
    e.preventDefault();
    e.stopPropagation();
    const rect = canvasRef.current.getBoundingClientRect();
    setCtxMenu({ x: e.clientX - rect.left, y: e.clientY - rect.top, type: "node", node });
  };

  useEffect(() => {
    const close = () => setCtxMenu(null);
    window.addEventListener("click", close);
    return () => window.removeEventListener("click", close);
  }, []);

  const selectedNode = GRAPH_NODES_INIT.find(n => n.id === selectedId);

  const getEdgePts = (edge) => {
    const f = GRAPH_NODES_INIT.find(n => n.id === edge.from);
    const t = GRAPH_NODES_INIT.find(n => n.id === edge.to);
    if (!f || !t) return null;
    const fp = positions[f.id];
    const tp = positions[t.id];
    if (!fp || !tp) return null;
    return { x1: fp.x + 80, y1: fp.y + 22, x2: tp.x + 60, y2: tp.y + 22 };
  };

  return (
    <div style={{ display:"flex", height:"100%", overflow:"hidden" }}>
      {/* Sidebar */}
      <div style={{ width:280, borderRight:"1px solid var(--border)", display:"flex", flexDirection:"column", background:"var(--white)", flexShrink:0, overflowY:"auto" }}>
        <div style={{ padding:"16px 16px 8px" }}>
          <p style={{ fontSize:13, fontWeight:700, marginBottom:2 }}>Map Context</p>
          <p style={{ fontSize:11, color:"var(--ink2)" }}>View and manage selected node details.</p>
        </div>
        <div style={{ padding:"8px 14px 10px", borderBottom:"1px solid var(--border)" }}>
          <p style={{ fontSize:10, fontWeight:600, letterSpacing:".06em", textTransform:"uppercase", color:"var(--ink3)", marginBottom:6 }}>Search Nodes</p>
          <div style={{ display:"flex", alignItems:"center", gap:8, background:"var(--bg)", borderRadius:8, border:"1px solid var(--border)", padding:"7px 10px" }}>
            <Search size={13} color="var(--ink3)"/>
            <input placeholder="Search..." style={{ border:"none", background:"transparent", fontSize:12, outline:"none", width:"100%", fontFamily:"'DM Sans',sans-serif" }}/>
          </div>
        </div>
        {selectedNode && (
          <div style={{ padding:"12px 14px", borderBottom:"1px solid var(--border)" }}>
            <p style={{ fontSize:10, fontWeight:600, letterSpacing:".06em", textTransform:"uppercase", color:"var(--ink3)", marginBottom:8 }}>Selected Node</p>
            <div style={{ background:"var(--violet-l)", borderRadius:10, padding:"12px 13px", border:"1px solid var(--violet-m)" }}>
              <div style={{ display:"flex", gap:8, alignItems:"center", marginBottom:6 }}>
                <div style={{ width:26, height:26, borderRadius:7, background:"var(--violet)", display:"flex", alignItems:"center", justifyContent:"center", color:"#fff" }}><Brain size={13}/></div>
                <p style={{ fontSize:13, fontWeight:600 }}>{selectedNode.label}</p>
              </div>
              <p style={{ fontSize:11, color:"var(--ink2)", marginBottom:10, lineHeight:1.5 }}>A newly identified insight cluster based on recent semantic queries.</p>
              <button style={{ width:"100%", background:"var(--violet)", color:"#fff", border:"none", borderRadius:7, padding:"7px 0", fontSize:12, fontWeight:600, cursor:"pointer", fontFamily:"'DM Sans',sans-serif" }}>
                Expand Details
              </button>
            </div>
          </div>
        )}
        <div style={{ padding:"12px 14px" }}>
          <p style={{ fontSize:10, fontWeight:600, letterSpacing:".06em", textTransform:"uppercase", color:"var(--ink3)", marginBottom:8 }}>All Nodes</p>
          {GRAPH_NODES_INIT.map(node => (
            <div key={node.id} className="node-row" onClick={() => jumpTo(node)}
              style={{ display:"flex", alignItems:"center", gap:8, padding:"8px 8px", marginBottom:3 }}>
              <Link2 size={12} color="var(--ink3)"/>
              <div style={{ flex:1, minWidth:0 }}>
                <p style={{ fontSize:12, fontWeight:500, color: selectedId===node.id ? "var(--violet)" : "var(--ink)" }}>{node.label}</p>
                <p style={{ fontSize:10, color:"var(--ink3)" }}>{node.sub}</p>
              </div>
              <button title="Jump to node" onClick={(e) => { e.stopPropagation(); jumpTo(node); }}
                style={{ background:"none", border:"none", cursor:"pointer", color:"var(--ink3)", padding:2, display:"flex", borderRadius:4 }}>
                <Crosshair size={12}/>
              </button>
              <button style={{ background:"none", border:"none", cursor:"pointer", color:"var(--ink3)", padding:2, display:"flex" }}>
                <MoreHorizontal size={13}/>
              </button>
            </div>
          ))}
        </div>
      </div>

      {/* Canvas */}
      <div ref={canvasRef} style={{ flex:1, position:"relative", overflow:"hidden", background:"radial-gradient(ellipse at 40% 40%, #F0EFF9 0%, var(--bg) 65%)" }}
        onContextMenu={handleCanvasRightClick}>
        {/* Dot grid */}
        <svg style={{ position:"absolute", inset:0, width:"100%", height:"100%", pointerEvents:"none" }}>
          <defs>
            <pattern id="dots" x="0" y="0" width="28" height="28" patternUnits="userSpaceOnUse">
              <circle cx="1" cy="1" r="1" fill="#C7BFEF" opacity=".5"/>
            </pattern>
          </defs>
          <rect width="100%" height="100%" fill="url(#dots)"/>
        </svg>
        {/* Header */}
        <div style={{ position:"absolute", top:0, left:0, right:0, padding:"14px 20px", display:"flex", alignItems:"center", justifyContent:"space-between", zIndex:10 }}>
          <div style={{ display:"flex", alignItems:"center", gap:8 }}>
            <span style={{ fontSize:17, fontWeight:500, fontFamily:"'Fraunces',serif" }}>Neural Knowledge Graph</span>
            <span style={{ fontSize:11, padding:"2px 9px", borderRadius:20, border:"1px solid var(--border)", color:"var(--ink2)" }}>Map View</span>
          </div>
          <div style={{ display:"flex", gap:8 }}>
            <button style={{ background:"var(--white)", border:"1px solid var(--border)", borderRadius:8, padding:"6px 13px", fontSize:12, fontWeight:500, cursor:"pointer", fontFamily:"'DM Sans',sans-serif" }}>Export Map</button>
            <button style={{ background:"var(--violet)", color:"#fff", border:"none", borderRadius:8, padding:"6px 13px", fontSize:12, fontWeight:600, cursor:"pointer", fontFamily:"'DM Sans',sans-serif", display:"flex", alignItems:"center", gap:5 }}>
              <Plus size={13}/> New Node
            </button>
          </div>
        </div>

        {/* SVG edges */}
        <svg style={{ position:"absolute", inset:0, width:"100%", height:"100%", pointerEvents:"none" }}>
          <defs>
            <marker id="arr" markerWidth="7" markerHeight="7" refX="6" refY="3.5" orient="auto">
              <path d="M1,1 L6,3.5 L1,6" fill="none" stroke="#C7C3F7" strokeWidth="1.2"/>
            </marker>
          </defs>
          {GRAPH_EDGES.map((edge, i) => {
            const pts = getEdgePts(edge);
            if (!pts) return null;
            return (
              <line key={i}
                x1={pts.x1} y1={pts.y1} x2={pts.x2} y2={pts.y2}
                stroke={edge.dashed ? "#C7C3F7" : "#D1D5DB"}
                strokeWidth={edge.dashed ? 1.5 : 1}
                strokeDasharray={edge.dashed ? "5,4" : "none"}
                markerEnd={edge.dashed ? "url(#arr)" : undefined}
                opacity={edge.dashed ? 0.8 : 1}
              />
            );
          })}
        </svg>

        {/* Nodes */}
        {GRAPH_NODES_INIT.map(node => {
          const pos = positions[node.id];
          if (!pos) return null;
          const isSel = selectedId === node.id;
          const isPulse = pulseId === node.id;
          return (
            <div key={node.id}
              className={"g-node" + (isPulse ? " pulse" : "")}
              style={{ position:"absolute", left:pos.x, top:pos.y, userSelect:"none" }}
              onMouseDown={(e) => handleNodeMouseDown(e, node.id)}
              onClick={() => setSelectedId(node.id)}
              onContextMenu={(e) => handleNodeRightClick(e, node)}>
              <div style={{
                display:"flex", alignItems:"center", gap:8, padding:"9px 14px",
                borderRadius:10, border:`1.5px solid ${isSel ? "var(--violet)" : "var(--border)"}`,
                background: isSel ? "var(--violet)" : "var(--white)",
                color: isSel ? "#fff" : "var(--ink)",
                boxShadow: isSel ? "0 4px 20px rgba(79,70,232,.28)" : "0 2px 8px rgba(0,0,0,.06)",
                transition:"all .18s",
                minWidth:160,
              }}>
                <div style={{ width:22, height:22, borderRadius:6, background: isSel ? "rgba(255,255,255,.2)" : "var(--violet-l)", display:"flex", alignItems:"center", justifyContent:"center", color: isSel ? "#fff" : "var(--violet)" }}>
                  <Brain size={12}/>
                </div>
                <div>
                  <p style={{ fontSize:12, fontWeight:600 }}>{node.label}</p>
                  <p style={{ fontSize:10, opacity:.7, marginTop:1 }}>{node.sub}</p>
                </div>
              </div>
            </div>
          );
        })}

        {/* Right-click menu */}
        {ctxMenu && (
          <div className="pop" onClick={e => e.stopPropagation()}
            style={{ position:"absolute", left:ctxMenu.x, top:ctxMenu.y, background:"var(--white)", border:"1px solid var(--border)", borderRadius:8, boxShadow:"0 8px 24px rgba(0,0,0,.12)", zIndex:100, minWidth:160, overflow:"hidden" }}>
            {ctxMenu.type === "node" && ctxMenu.node ? (
              <>
                <div style={{ padding:"7px 12px 4px", borderBottom:"1px solid var(--border2)" }}>
                  <span style={{ fontSize:10, fontWeight:600, color:"var(--ink3)", textTransform:"uppercase", letterSpacing:".05em" }}>{ctxMenu.node.label}</span>
                </div>
                {[["Export node", null], ["Connect to...", null], ["Jump to node", null]].map(([label], i) => (
                  <div key={i} className="cmd-row" onClick={() => { setCtxMenu(null); showToast(label); }}
                    style={{ padding:"8px 13px", fontSize:12, color:"var(--ink)" }}>{label}</div>
                ))}
                <div style={{ borderTop:"1px solid var(--border2)" }}>
                  <div className="cmd-row" style={{ padding:"8px 13px", display:"flex", gap:7, alignItems:"center", fontSize:12, color:"var(--red)", cursor:"pointer" }}
                    onClick={() => setCtxMenu(null)}>
                    <Trash2 size={12}/> Delete node
                  </div>
                </div>
              </>
            ) : (
              <>
                <div className="cmd-row" onClick={() => { setCtxMenu(null); showToast("New node created"); }} style={{ padding:"8px 13px", fontSize:12, color:"var(--ink)", cursor:"pointer", display:"flex", gap:7, alignItems:"center" }}><Plus size={12}/> New node here</div>
                <div className="cmd-row" onClick={() => { setCtxMenu(null); showToast("Map exported"); }} style={{ padding:"8px 13px", fontSize:12, color:"var(--ink)", cursor:"pointer" }}>Export map</div>
              </>
            )}
          </div>
        )}

        {/* Zoom controls */}
        <div style={{ position:"absolute", bottom:70, right:20, display:"flex", flexDirection:"column", background:"var(--white)", border:"1px solid var(--border)", borderRadius:8, overflow:"hidden", boxShadow:"0 2px 8px rgba(0,0,0,.07)" }}>
          <button className="btn-ghost" style={{ padding:"8px 10px" }}><ZoomIn size={14}/></button>
          <div style={{ height:1, background:"var(--border)" }}/>
          <button className="btn-ghost" style={{ padding:"8px 10px" }}><ZoomOut size={14}/></button>
        </div>
        <div style={{ position:"absolute", bottom:48, right:20 }}>
          <span style={{ fontSize:10, color:"var(--ink3)" }}>Canvas View 100%</span>
        </div>

        {/* Mini map */}
        <div style={{ position:"absolute", bottom:70, right:70, background:"var(--white)", border:"1px solid var(--border)", borderRadius:8, padding:"6px 8px", boxShadow:"0 2px 8px rgba(0,0,0,.07)", cursor:"crosshair" }}>
          <p style={{ fontSize:9, color:"var(--ink3)", textAlign:"center", marginBottom:4, letterSpacing:".05em", textTransform:"uppercase", fontWeight:600 }}>Mini-Map</p>
          <div style={{ width:84, height:56, background:"var(--bg)", borderRadius:4, position:"relative" }}>
            {GRAPH_NODES_INIT.map(n => {
              const p = positions[n.id];
              return p ? <div key={n.id} style={{ position:"absolute", left:p.x/10, top:p.y/8, width:10, height:6, borderRadius:2, background: selectedId===n.id ? "var(--violet)" : "var(--violet-m)" }}/> : null;
            })}
            <div style={{ position:"absolute", inset:"6px 8px 6px 8px", border:"1px solid var(--violet)", borderRadius:2, opacity:.4 }}/>
          </div>
        </div>
      </div>

      {toast && (
        <div className="pop" style={{ position:"fixed", bottom:24, left:"50%", transform:"translateX(-50%)", background:"var(--ink)", color:"#fff", padding:"9px 18px", borderRadius:8, fontSize:12, fontWeight:500, zIndex:1000, whiteSpace:"nowrap" }}>
          {toast}
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// MEMORY ARCHIVES
// ─────────────────────────────────────────────────────────────
function MemoryArchives() {
  const [clusters, setClusters] = useState(CLUSTERS);
  const [activePanel, setActivePanel] = useState(null);
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [toast, setToast] = useState("");

  const showToast = (msg) => { setToast(msg); setTimeout(() => setToast(""), 2200); };

  const confirmDelete = () => {
    if (!deleteTarget) return;
    setClusters(prev => prev.filter(c => c.id !== deleteTarget.id));
    if (activePanel && activePanel.id === deleteTarget.id) setActivePanel(null);
    setDeleteTarget(null);
    showToast("Cluster and associated nodes removed");
  };

  return (
    <div style={{ display:"flex", height:"100%", overflow:"hidden", position:"relative" }}>
      {/* Sidebar */}
      <div style={{ width:280, borderRight:"1px solid var(--border)", display:"flex", flexDirection:"column", background:"var(--white)", flexShrink:0, overflowY:"auto" }}>
        <div style={{ padding:"14px 14px 10px" }}>
          <div style={{ display:"flex", alignItems:"center", gap:8, background:"var(--bg)", borderRadius:8, border:"1px solid var(--border)", padding:"7px 10px" }}>
            <Search size={13} color="var(--ink3)"/>
            <input placeholder="Search..." style={{ border:"none", background:"transparent", fontSize:12, outline:"none", width:"100%", fontFamily:"'DM Sans',sans-serif" }}/>
          </div>
        </div>
        <div style={{ padding:"0 14px 12px" }}>
          <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:8 }}>
            <span style={{ fontSize:12, fontWeight:600 }}>Folders</span>
            <div style={{ display:"flex", gap:4 }}>
              <button className="btn-ghost" style={{ padding:3 }}><Plus size={13}/></button>
              <button className="btn-ghost" style={{ padding:3 }}><ChevronDown size={13}/></button>
            </div>
          </div>
          {["Coding","Research"].map(f => (
            <div key={f} className="node-row" style={{ display:"flex", alignItems:"center", gap:8, padding:"7px 7px", borderRadius:6, marginBottom:2 }}>
              <Folder size={13} color="var(--ink3)"/>
              <span style={{ fontSize:12, flex:1 }}>{f}</span>
              <button style={{ background:"none", border:"none", cursor:"pointer", color:"var(--ink3)", display:"flex" }}><MoreHorizontal size={12}/></button>
            </div>
          ))}
        </div>
        <div style={{ padding:"8px 14px", borderTop:"1px solid var(--border)", flex:1 }}>
          <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:8 }}>
            <span style={{ fontSize:12, fontWeight:600 }}>Collections</span>
            <button className="btn-ghost" style={{ padding:3 }}><ChevronDown size={13}/></button>
          </div>
          {clusters.map(c => (
            <div key={c.id} className="node-row" onClick={() => setActivePanel(c)}
              style={{ display:"flex", alignItems:"center", gap:7, padding:"7px 7px", marginBottom:2 }}>
              <div style={{ width:6, height:6, borderRadius:"50%", background: activePanel && activePanel.id===c.id ? "var(--violet)" : "var(--border)", flexShrink:0 }}/>
              <div style={{ flex:1, minWidth:0 }}>
                <p style={{ fontSize:12, fontWeight:500, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap", color: activePanel && activePanel.id===c.id ? "var(--violet)" : "var(--ink)" }}>{c.title}</p>
                <p style={{ fontSize:10, color:"var(--ink3)" }}>{c.sessions} sessions</p>
              </div>
              <button onClick={e => { e.stopPropagation(); setDeleteTarget(c); }} style={{ background:"none", border:"none", cursor:"pointer", color:"var(--ink3)", padding:2 }}><MoreHorizontal size={12}/></button>
            </div>
          ))}
        </div>
        <div style={{ padding:"12px 14px", borderTop:"1px solid var(--border)" }}>
          <button style={{ width:"100%", background:"none", border:"1px solid var(--border)", borderRadius:8, padding:"7px 0", fontSize:12, cursor:"pointer", fontFamily:"'DM Sans',sans-serif", color:"var(--ink2)" }}>
            Browse all quick notes
          </button>
        </div>
      </div>

      {/* Main grid */}
      <div style={{ flex:1, overflowY:"auto", padding:"28px 32px" }}>
        <h1 style={{ fontFamily:"'Fraunces',serif", fontSize:32, fontWeight:400, marginBottom:6 }}>Archive Collections</h1>
        <p style={{ fontSize:13, color:"var(--ink2)", marginBottom:28, lineHeight:1.6 }}>A curated view of your past conversational threads, automatically clustered by thematic resonance and intellectual pursuit.</p>

        {/* Hero card */}
        {clusters.filter(c => c.featured).map(c => (
          <div key={c.id} className="card fade-up" onClick={() => setActivePanel(c)}
            style={{ border:"1px solid var(--border)", borderLeft:"3px solid var(--violet)", padding:"22px 24px", marginBottom:16, background:"var(--white)" }}>
            <div style={{ display:"flex", alignItems:"center", gap:6, marginBottom:10 }}>
              <span style={{ fontSize:10, fontWeight:700, letterSpacing:".08em", textTransform:"uppercase", color:"var(--ink3)" }}>{c.category}</span>
              <Circle size={3} fill="var(--ink3)" color="var(--ink3)"/>
              <span style={{ fontSize:11, color:"var(--ink3)" }}>{c.sessions} Sessions</span>
              <Circle size={3} fill="var(--ink3)" color="var(--ink3)"/>
              <span style={{ fontSize:11, color:"var(--violet)", fontWeight:500 }}>Last active {c.lastActive}</span>
            </div>
            <h2 style={{ fontFamily:"'Fraunces',serif", fontSize:24, fontWeight:400, marginBottom:8 }}>{c.title}</h2>
            <p style={{ fontSize:13, color:"var(--ink2)", marginBottom:14, lineHeight:1.6 }}>{c.desc}</p>
            <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between" }}>
              <div style={{ display:"flex", gap:6, flexWrap:"wrap" }}>
                {c.tags.map(t => <span key={t} style={{ fontSize:11, fontWeight:500, padding:"3px 10px", borderRadius:20, border:"1px solid var(--border)", color:"var(--ink2)" }}>{t}</span>)}
              </div>
              <button onClick={e => { e.stopPropagation(); setDeleteTarget(c); }} style={{ background:"none", border:"none", cursor:"pointer", color:"var(--ink3)" }}><MoreHorizontal size={15}/></button>
            </div>
          </div>
        ))}

        {/* 2-col grid */}
        <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:14 }}>
          {clusters.filter(c => !c.featured).map(c => (
            <div key={c.id} className="card fade-up" onClick={() => setActivePanel(c)}
              style={{ border:"1px solid var(--border)", borderLeft:"3px solid var(--violet-m)", padding:"18px 20px", background:"var(--white)" }}>
              <div style={{ display:"flex", alignItems:"center", gap:5, marginBottom:7 }}>
                <span style={{ fontSize:10, fontWeight:600, textTransform:"uppercase", letterSpacing:".06em", color:"var(--ink3)" }}>{c.category}</span>
                <Circle size={3} fill="var(--ink3)" color="var(--ink3)"/>
                <span style={{ fontSize:10, color:"var(--ink3)" }}>{c.sessions} Sessions</span>
                <Circle size={3} fill="var(--ink3)" color="var(--ink3)"/>
                <span style={{ fontSize:10, color:"var(--violet)", fontWeight:500 }}>Active {c.lastActive}</span>
              </div>
              <h3 style={{ fontFamily:"'Fraunces',serif", fontSize:17, fontWeight:400, marginBottom:7 }}>{c.title}</h3>
              <p style={{ fontSize:12, color:"var(--ink2)", marginBottom:12, lineHeight:1.55 }}>{c.desc}</p>
              <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between" }}>
                <div style={{ display:"flex", gap:5 }}>{c.tags.map(t => <span key={t} style={{ fontSize:10, fontWeight:500, padding:"2px 8px", borderRadius:20, border:"1px solid var(--border)", color:"var(--ink2)" }}>{t}</span>)}</div>
                <button onClick={e => { e.stopPropagation(); setDeleteTarget(c); }} style={{ background:"none", border:"none", cursor:"pointer", color:"var(--ink3)" }}><MoreHorizontal size={13}/></button>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Slide-in panel */}
      {activePanel && (
        <>
          <div onClick={() => setActivePanel(null)} style={{ position:"absolute", inset:0, background:"rgba(0,0,0,.08)", zIndex:40 }}/>
          <div className="slide-in" style={{ position:"absolute", top:0, right:0, bottom:0, width:440, background:"var(--white)", borderLeft:"1px solid var(--border)", zIndex:50, display:"flex", flexDirection:"column", overflowY:"auto", boxShadow:"-8px 0 32px rgba(0,0,0,.07)" }}>
            <div style={{ padding:"16px 20px", borderBottom:"1px solid var(--border)", display:"flex", alignItems:"flex-start", justifyContent:"space-between" }}>
              <div>
                <p style={{ fontSize:10, fontWeight:600, color:"var(--ink3)", letterSpacing:".06em", textTransform:"uppercase", marginBottom:3 }}>{activePanel.category} · {activePanel.sessions} sessions</p>
                <h3 style={{ fontFamily:"'Fraunces',serif", fontSize:17, fontWeight:400 }}>{activePanel.title}</h3>
              </div>
              <button onClick={() => setActivePanel(null)} className="btn-ghost" style={{ padding:5, color:"var(--ink3)" }}><X size={15}/></button>
            </div>
            <div style={{ padding:"14px 20px", borderBottom:"1px solid var(--border)" }}>
              <p style={{ fontSize:12, color:"var(--ink2)", lineHeight:1.6, marginBottom:8 }}>{activePanel.desc}</p>
              <div style={{ display:"flex", gap:5, flexWrap:"wrap", marginBottom:8 }}>
                {activePanel.tags.map(t => <span key={t} style={{ fontSize:11, padding:"2px 9px", borderRadius:20, border:"1px solid var(--border)", color:"var(--ink2)" }}>{t}</span>)}
              </div>
              <p style={{ fontSize:11, color:"var(--violet)", fontWeight:500 }}>Last active {activePanel.lastActive}</p>
            </div>
            <div style={{ padding:"14px 20px", borderBottom:"1px solid var(--border)" }}>
              <p style={{ fontSize:10, fontWeight:600, letterSpacing:".06em", textTransform:"uppercase", color:"var(--ink3)", marginBottom:10 }}>Sessions</p>
              {activePanel.sessionList.map(s => (
                <div key={s.id} style={{ padding:"10px 12px", borderRadius:8, border:"1px solid var(--border)", marginBottom:8, background:"var(--bg)" }}>
                  <div style={{ display:"flex", justifyContent:"space-between", gap:8, marginBottom:6 }}>
                    <div>
                      <p style={{ fontSize:13, fontWeight:500, marginBottom:2 }}>{s.title}</p>
                      <p style={{ fontSize:11, color:"var(--ink2)" }}>{s.preview}</p>
                    </div>
                    <span style={{ fontSize:10, color:"var(--ink3)", whiteSpace:"nowrap", flexShrink:0 }}>{s.time}</span>
                  </div>
                  <button style={{ fontSize:11, fontWeight:600, color:"var(--violet)", background:"var(--violet-l)", border:"none", borderRadius:6, padding:"4px 10px", cursor:"pointer", fontFamily:"'DM Sans',sans-serif", display:"flex", alignItems:"center", gap:4 }}>
                    Continue <ArrowRight size={11}/>
                  </button>
                </div>
              ))}
            </div>
            <div style={{ padding:"14px 20px", borderBottom:"1px solid var(--border)" }}>
              <p style={{ fontSize:10, fontWeight:600, letterSpacing:".06em", textTransform:"uppercase", color:"var(--ink3)", marginBottom:8 }}>Linked Brain Nodes</p>
              {activePanel.linkedNodes.map(n => (
                <div key={n} style={{ display:"flex", alignItems:"center", gap:7, padding:"6px 9px", borderRadius:7, background:"var(--violet-l)", marginBottom:5 }}>
                  <Link2 size={12} color="var(--violet)"/>
                  <span style={{ fontSize:12, fontWeight:500, color:"var(--violet)" }}>{n}</span>
                </div>
              ))}
            </div>
            <div style={{ padding:"14px 20px" }}>
              <button onClick={() => { setDeleteTarget(activePanel); setActivePanel(null); }}
                style={{ fontSize:12, color:"var(--red)", background:"none", border:"1px solid #FCA5A5", borderRadius:7, padding:"7px 14px", cursor:"pointer", fontFamily:"'DM Sans',sans-serif", display:"flex", alignItems:"center", gap:6 }}>
                <Trash2 size={13}/> Delete cluster
              </button>
            </div>
          </div>
        </>
      )}

      {/* Delete modal */}
      {deleteTarget && (
        <>
          <div style={{ position:"absolute", inset:0, background:"rgba(0,0,0,.18)", zIndex:60 }}/>
          <div className="pop" style={{ position:"absolute", top:"50%", left:"50%", transform:"translate(-50%,-50%)", background:"var(--white)", borderRadius:14, padding:"26px 24px", width:380, zIndex:70, boxShadow:"0 20px 60px rgba(0,0,0,.15)" }}>
            <div style={{ width:40, height:40, borderRadius:"50%", background:"#FEE2E2", display:"flex", alignItems:"center", justifyContent:"center", marginBottom:14, color:"var(--red)" }}>
              <Trash2 size={18}/>
            </div>
            <h3 style={{ fontSize:15, fontWeight:600, marginBottom:8 }}>Delete "{deleteTarget.title}"?</h3>
            <p style={{ fontSize:13, color:"var(--ink2)", lineHeight:1.6, marginBottom:20 }}>
              This will permanently remove this cluster and all {deleteTarget.sessions} associated sessions from memory. This cannot be undone.
            </p>
            <div style={{ display:"flex", gap:8, justifyContent:"flex-end" }}>
              <button onClick={() => setDeleteTarget(null)} style={{ background:"none", border:"1px solid var(--border)", borderRadius:8, padding:"8px 16px", fontSize:13, cursor:"pointer", fontFamily:"'DM Sans',sans-serif" }}>Cancel</button>
              <button onClick={confirmDelete} style={{ background:"var(--red)", color:"#fff", border:"none", borderRadius:8, padding:"8px 16px", fontSize:13, fontWeight:600, cursor:"pointer", fontFamily:"'DM Sans',sans-serif" }}>Delete cluster</button>
            </div>
          </div>
        </>
      )}

      {toast && (
        <div className="pop" style={{ position:"fixed", bottom:24, left:"50%", transform:"translateX(-50%)", background:"var(--ink)", color:"#fff", padding:"9px 18px", borderRadius:8, fontSize:12, fontWeight:500, zIndex:200, whiteSpace:"nowrap" }}>
          {toast}
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// APP SHELL
// ─────────────────────────────────────────────────────────────
export default function App() {
  const [tab, setTab] = useState("chat");

  const tabs = [
    { key:"chat",    label:"Chat",            icon:<MessageSquare size={14}/> },
    { key:"brain",   label:"Neural Brain",    icon:<Brain size={14}/> },
    { key:"archive", label:"Memory Archives", icon:<BookOpen size={14}/> },
  ];

  const sessionTitle = tab === "chat" ? "Architectural Patterns Review" : null;

  return (
    <>
      <style>{GLOBAL_CSS}</style>
      <div style={{ display:"flex", flexDirection:"column", height:"100vh", overflow:"hidden" }}>
        {/* Topbar */}
        <div style={{ height:52, borderBottom:"1px solid var(--border)", display:"flex", alignItems:"center", padding:"0 18px", background:"var(--white)", flexShrink:0, gap:0 }}>
          <div style={{ display:"flex", alignItems:"center", gap:8, marginRight:18 }}>
            <div style={{ width:30, height:30, borderRadius:"50%", background:"var(--violet)", display:"flex", alignItems:"center", justifyContent:"center", color:"#fff" }}>
              <Brain size={15}/>
            </div>
            <span style={{ fontSize:14, fontWeight:600, fontFamily:"'Fraunces',serif", letterSpacing:"-.01em" }}>Editorial AI</span>
          </div>
          <div style={{ width:1, height:22, background:"var(--border)", marginRight:16 }}/>
          <nav style={{ display:"flex", gap:2, flex:1 }}>
            {tabs.map(t => (
              <button key={t.key} onClick={() => setTab(t.key)}
                style={{ display:"flex", alignItems:"center", gap:6, padding:"5px 13px", borderRadius:8, border:"none", cursor:"pointer", fontSize:13, fontWeight: tab===t.key ? 600 : 400, fontFamily:"'DM Sans',sans-serif", background: tab===t.key ? "var(--violet-l)" : "transparent", color: tab===t.key ? "var(--violet)" : "var(--ink2)", transition:"all .15s" }}>
                <span style={{ opacity:.8 }}>{t.icon}</span>{t.label}
              </button>
            ))}
          </nav>
          <div style={{ display:"flex", alignItems:"center", gap:12 }}>
            {sessionTitle && <span style={{ fontSize:13, fontWeight:500, color:"var(--violet)", fontFamily:"'Fraunces',serif" }}>{sessionTitle}</span>}
            <button className="btn-ghost" style={{ padding:6, color:"var(--ink2)" }}><Settings size={15}/></button>
            <button className="btn-ghost" style={{ padding:6, color:"var(--ink2)" }}><User size={15}/></button>
          </div>
        </div>
        {/* Panel */}
        <div style={{ flex:1, overflow:"hidden" }}>
          {tab === "chat"    && <NeuralChat/>}
          {tab === "brain"   && <NeuralBrain/>}
          {tab === "archive" && <MemoryArchives/>}
        </div>
      </div>
    </>
  );
}
