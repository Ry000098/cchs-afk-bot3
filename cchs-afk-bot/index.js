"use strict";

const { addLog, getLogs } = require("./logger");
const mineflayer = require("mineflayer");
const { Movements, pathfinder, goals } = require("mineflayer-pathfinder");
const { GoalBlock } = goals;
const config = require("./settings.json");
const express = require("express");
const http = require("http");
const https = require("https");
const discordBot = require("./discord-bot");
const aternosAuto = require("./aternos-auto");

// ============================================================
// EXPRESS SERVER - Keep Render/Aternos alive
// ============================================================
const app = express();
app.use(express.json());
const PORT = process.env.PORT || 5000;

// Bot state tracking
let botState = {
  connected: false,
  lastActivity: Date.now(),
  reconnectAttempts: 0,
  startTime: Date.now(),
  errors: [],
  wasThrottled: false,
  wasDuplicateLogin: false,
};

// Chat history (last 50 messages)
let chatHistory = [];

// ─── Death count tracking ─────────────────────────────────────────────────────
const DEATH_COUNTS_FILE = "death-counts.json";
let deathCounts = {};
try {
  if (require("fs").existsSync(DEATH_COUNTS_FILE)) {
    deathCounts = JSON.parse(require("fs").readFileSync(DEATH_COUNTS_FILE, "utf8"));
  }
} catch (_) {}

function saveDeathCounts() {
  try { require("fs").writeFileSync(DEATH_COUNTS_FILE, JSON.stringify(deathCounts, null, 2)); } catch (_) {}
}

function recordDeath(username, rawMessage) {
  if (!username) return;
  deathCounts[username] = (deathCounts[username] || 0) + 1;
  const count = deathCounts[username];
  saveDeathCounts();
  discordBot.notifyPlayerDeath(rawMessage);
  discordBot.notifyDeathMilestone(username, count);
}

// Dashboard
app.get('/', (req, res) => {
  res.send(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>${config.name}</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap" rel="stylesheet">
  <style>
    *,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
    :root{
      --bg:#0a0c10;
      --surface:#111318;
      --surface2:#181c23;
      --border:#1e2330;
      --border2:#252b38;
      --text:#e8edf5;
      --muted:#5a6478;
      --muted2:#3d4455;
      --green:#22c55e;
      --green-bg:rgba(34,197,94,.08);
      --green-border:rgba(34,197,94,.25);
      --red:#ef4444;
      --red-bg:rgba(239,68,68,.08);
      --red-border:rgba(239,68,68,.25);
      --yellow:#f59e0b;
      --yellow-bg:rgba(245,158,11,.08);
      --yellow-border:rgba(245,158,11,.25);
      --blue:#3b82f6;
      --radius:14px;
      --radius-sm:9px;
    }
    html,body{height:100%}
    body{
      font-family:'Inter',-apple-system,sans-serif;
      background:var(--bg);
      color:var(--text);
      min-height:100vh;
      line-height:1.5;
    }

    /* ── Layout ── */
    .shell{display:flex;flex-direction:column;min-height:100vh}

    .topbar{
      display:flex;align-items:center;justify-content:space-between;
      padding:0 24px;height:58px;
      background:var(--surface);
      border-bottom:1px solid var(--border);
      position:sticky;top:0;z-index:10;
    }
    .topbar-left{display:flex;align-items:center;gap:12px}
    .topbar-icon{
      width:32px;height:32px;border-radius:8px;
      background:linear-gradient(135deg,#16a34a,#22c55e);
      display:flex;align-items:center;justify-content:center;
      font-size:16px;flex-shrink:0;
    }
    .topbar-name{font-size:15px;font-weight:700;color:var(--text);letter-spacing:-.3px}
    .topbar-sub{font-size:12px;color:var(--muted);margin-top:1px}
    .topbar-right{display:flex;align-items:center;gap:10px}

    .live-pill{
      display:flex;align-items:center;gap:6px;
      font-size:12px;font-weight:600;
      padding:4px 10px;border-radius:20px;
      transition:all .3s;
    }
    .live-pill.online {background:var(--green-bg);color:var(--green);border:1px solid var(--green-border)}
    .live-pill.offline{background:var(--red-bg);color:var(--red);border:1px solid var(--red-border)}
    .live-pill.stopped{background:var(--yellow-bg);color:var(--yellow);border:1px solid var(--yellow-border)}
    .pill-dot{width:7px;height:7px;border-radius:50%;background:currentColor;flex-shrink:0}
    .pill-dot.pulse{animation:pulse 1.8s ease-in-out infinite}
    @keyframes pulse{0%,100%{opacity:1}50%{opacity:.35}}

    .page{
      flex:1;
      display:grid;
      grid-template-columns:320px 1fr;
      gap:0;
      max-width:1100px;
      width:100%;
      margin:0 auto;
      padding:24px;
      gap:20px;
      align-items:start;
    }
    @media(max-width:780px){.page{grid-template-columns:1fr;padding:16px;gap:14px}}

    /* ── Cards ── */
    .card{
      background:var(--surface);
      border:1px solid var(--border);
      border-radius:var(--radius);
      overflow:hidden;
    }
    .card-header{
      padding:16px 20px 14px;
      border-bottom:1px solid var(--border);
      display:flex;align-items:center;justify-content:space-between;
    }
    .card-title{font-size:12px;font-weight:600;color:var(--muted);text-transform:uppercase;letter-spacing:.6px}
    .card-badge{font-size:11px;font-weight:600;color:var(--muted);background:var(--surface2);border:1px solid var(--border2);padding:2px 8px;border-radius:20px}
    .card-body{padding:20px}

    /* ── Status hero ── */
    .status-hero{
      padding:28px 24px;
      display:flex;align-items:center;gap:20px;
      transition:all .35s ease;
    }
    .status-hero.online {background:linear-gradient(135deg,rgba(34,197,94,.06),transparent)}
    .status-hero.offline{background:linear-gradient(135deg,rgba(239,68,68,.06),transparent)}
    .status-hero.stopped{background:linear-gradient(135deg,rgba(245,158,11,.06),transparent)}

    .status-orb{
      width:56px;height:56px;border-radius:50%;flex-shrink:0;
      display:flex;align-items:center;justify-content:center;
      font-size:22px;font-weight:700;
      transition:all .35s;
      position:relative;
    }
    .status-orb.online {background:var(--green-bg);color:var(--green);box-shadow:0 0 0 1px var(--green-border)}
    .status-orb.offline{background:var(--red-bg);color:var(--red);box-shadow:0 0 0 1px var(--red-border)}
    .status-orb.stopped{background:var(--yellow-bg);color:var(--yellow);box-shadow:0 0 0 1px var(--yellow-border)}

    .status-orb.online::after{
      content:'';position:absolute;inset:-4px;border-radius:50%;
      border:2px solid var(--green);opacity:.2;
      animation:ring 2s ease-in-out infinite;
    }
    @keyframes ring{0%,100%{transform:scale(1);opacity:.2}50%{transform:scale(1.12);opacity:.05}}

    .status-info{}
    .status-label{font-size:22px;font-weight:800;letter-spacing:-.5px;line-height:1.1;transition:color .3s}
    .status-label.online {color:var(--green)}
    .status-label.offline{color:var(--red)}
    .status-label.stopped{color:var(--yellow)}
    .status-sub{font-size:13px;color:var(--muted);margin-top:5px}

    /* ── Stats row ── */
    .stats-row{display:grid;grid-template-columns:repeat(3,1fr);gap:1px;background:var(--border)}
    .stat-cell{background:var(--surface);padding:16px 18px}
    .stat-label{font-size:11px;font-weight:600;color:var(--muted);text-transform:uppercase;letter-spacing:.5px;margin-bottom:6px}
    .stat-value{font-size:15px;font-weight:700;color:var(--text);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
    .stat-value.mono{font-family:'SF Mono','Fira Code',monospace;font-size:13px}

    /* ── Buttons ── */
    .btn{
      display:flex;align-items:center;justify-content:center;gap:7px;
      font-family:inherit;font-size:14px;font-weight:700;
      border-radius:var(--radius-sm);cursor:pointer;
      transition:all .18s;border:none;outline:none;
      padding:0 20px;height:44px;
      letter-spacing:-.1px;
      white-space:nowrap;
    }
    .btn:active{transform:scale(.97)}

    .btn-green{background:var(--green);color:#000}
    .btn-green:hover{background:#16a34a}
    .btn-green:disabled{background:var(--surface2);color:var(--muted);cursor:default}

    .btn-red{background:var(--red);color:#fff}
    .btn-red:hover{background:#dc2626}
    .btn-red:disabled{background:var(--surface2);color:var(--muted);cursor:default}

    .btn-ghost{background:var(--surface2);color:var(--text);border:1px solid var(--border2)}
    .btn-ghost:hover{background:var(--border2);border-color:var(--border2)}

    .btn-outline-green{background:transparent;color:var(--green);border:1px solid var(--green-border)}
    .btn-outline-green:hover{background:var(--green-bg)}
    .btn-outline-red{background:transparent;color:var(--red);border:1px solid var(--red-border)}
    .btn-outline-red:hover{background:var(--red-bg)}

    .btn.full{width:100%}
    .btn.sm{height:36px;font-size:13px;padding:0 14px}

    .btn-row{display:grid;grid-template-columns:1fr 1fr;gap:10px}

    /* ── Dim inactive control ── */
    .btn.dimmed{opacity:.35;pointer-events:none}

    /* ── Section inside left col ── */
    .left-col{display:flex;flex-direction:column;gap:16px}
    .right-col{display:flex;flex-direction:column;gap:16px}

    /* ── Players ── */
    .player-list{display:flex;flex-direction:column;gap:8px;min-height:32px}
    .player-row{
      display:flex;align-items:center;gap:8px;
      padding:8px 12px;border-radius:var(--radius-sm);
      background:var(--surface2);border:1px solid var(--border);
    }
    .player-avatar{
      width:28px;height:28px;border-radius:6px;
      display:flex;align-items:center;justify-content:center;font-size:14px;flex-shrink:0;
    }
    .player-name{flex:1;font-size:13px;font-weight:600;color:var(--text)}
    .player-tag{font-size:10px;font-weight:700;padding:2px 6px;border-radius:4px}
    .player-tag.bot{background:var(--green-bg);color:var(--green);border:1px solid var(--green-border)}
    .player-actions{display:flex;gap:5px}

    .empty-state{
      text-align:center;padding:24px 16px;
      font-size:13px;color:var(--muted2);
    }

    /* ── Chat ── */
    .chat-log{
      max-height:240px;overflow-y:auto;
      display:flex;flex-direction:column;gap:2px;
      padding:14px 18px;
      font-size:13px;font-family:'SF Mono','Fira Code',monospace;
    }
    .chat-log::-webkit-scrollbar{width:4px}
    .chat-log::-webkit-scrollbar-thumb{background:var(--border2);border-radius:4px}
    .chat-time{color:var(--muted2)}
    .chat-name{font-weight:700}
    .chat-input-row{
      display:flex;gap:8px;padding:12px 14px;
      border-top:1px solid var(--border);background:var(--bg);
    }
    .chat-input{
      flex:1;background:var(--surface2);border:1px solid var(--border2);
      border-radius:var(--radius-sm);padding:9px 14px;
      color:var(--text);font-size:13px;font-family:inherit;outline:none;
      transition:border-color .18s;
    }
    .chat-input:focus{border-color:var(--blue)}

    /* ── Logs link row ── */
    .link-row{display:flex;gap:8px}
    .link-row a{flex:1}

    /* ── Aternos status msg ── */
    #aternos-msg{font-size:12px;color:var(--muted);min-height:16px;text-align:center;padding-top:6px}

    /* ── Footer ── */
    .topbar-uptime{font-size:12px;color:var(--muted);font-variant-numeric:tabular-nums}
  </style>
</head>
<body>
<div class="shell">

  <!-- Top bar -->
  <nav class="topbar">
    <div class="topbar-left">
      <div class="topbar-icon">⛏</div>
      <div>
        <div class="topbar-name">${config.name}</div>
        <div class="topbar-sub">${config.server.ip}</div>
      </div>
    </div>
    <div class="topbar-right">
      <span class="topbar-uptime" id="nav-uptime"></span>
      <span id="nav-pill" class="live-pill offline">
        <span class="pill-dot pulse"></span>
        <span id="nav-pill-text">Connecting</span>
      </span>
    </div>
  </nav>

  <!-- Page grid -->
  <div class="page">

    <!-- LEFT column -->
    <div class="left-col">

      <!-- Status hero card -->
      <div class="card">
        <div class="status-hero offline" id="status-hero">
          <div class="status-orb offline" id="status-orb">✗</div>
          <div class="status-info">
            <div class="status-label offline" id="status-label">Connecting…</div>
            <div class="status-sub" id="status-sub">Establishing connection</div>
          </div>
        </div>
        <!-- Stats row -->
        <div class="stats-row">
          <div class="stat-cell">
            <div class="stat-label">Uptime</div>
            <div class="stat-value" id="uptime-val">—</div>
          </div>
          <div class="stat-cell">
            <div class="stat-label">Reconnects</div>
            <div class="stat-value" id="reconnects-val">0</div>
          </div>
          <div class="stat-cell">
            <div class="stat-label">Position</div>
            <div class="stat-value mono" id="coords-val">—</div>
          </div>
        </div>
      </div>

      <!-- Bot controls -->
      <div class="card">
        <div class="card-header"><span class="card-title">Bot Controls</span></div>
        <div class="card-body" style="display:flex;flex-direction:column;gap:10px">
          <div class="btn-row">
            <button id="start-btn" class="btn btn-green" onclick="startBot()">▶ Start Bot</button>
            <button id="stop-btn"  class="btn btn-red"   onclick="stopBot()">⏹ Stop Bot</button>
          </div>
          <div id="bot-ctrl-msg" style="font-size:12px;color:var(--muted);text-align:center;min-height:16px"></div>
        </div>
      </div>

      <!-- Aternos controls -->
      <div class="card">
        <div class="card-header"><span class="card-title">Aternos Server</span></div>
        <div class="card-body" style="display:flex;flex-direction:column;gap:10px">
          <div class="btn-row">
            <button class="btn btn-outline-green" onclick="aternosStart()">▶ Start Server</button>
            <button class="btn btn-outline-red"   onclick="aternosStop()">⏹ Stop Server</button>
          </div>
          <div id="aternos-msg"></div>
        </div>
      </div>

      <!-- Links -->
      <div class="link-row">
        <a href="/logs"     class="btn btn-ghost sm full">📋 Logs</a>
        <a href="/tutorial" class="btn btn-ghost sm full">📖 Setup Guide</a>
      </div>

    </div><!-- /left -->

    <!-- RIGHT column -->
    <div class="right-col">

      <!-- Players -->
      <div class="card">
        <div class="card-header">
          <span class="card-title">Players Online</span>
          <span class="card-badge" id="player-badge">0 online</span>
        </div>
        <div class="card-body">
          <div class="player-list" id="player-list">
            <div class="empty-state">No players online right now</div>
          </div>
        </div>
      </div>

      <!-- Chat -->
      <div class="card">
        <div class="card-header">
          <span class="card-title">Live Chat</span>
          <span class="card-badge">auto-refresh</span>
        </div>
        <div class="chat-log" id="chat-log">
          <span style="color:var(--muted2)">No messages yet</span>
        </div>
        <div class="chat-input-row">
          <input class="chat-input" id="chat-input" type="text" placeholder="Send a message in-game…" maxlength="256"
            onkeydown="if(event.key==='Enter')sendChat()">
          <button class="btn btn-green sm" onclick="sendChat()">Send</button>
        </div>
      </div>

    </div><!-- /right -->
  </div><!-- /page -->
</div>

<script>
  var lastStatus = null;

  function fmt(s){
    const h=Math.floor(s/3600),m=Math.floor((s%3600)/60),sec=s%60;
    if(h>0) return h+'h '+m+'m '+sec+'s';
    if(m>0) return m+'m '+sec+'s';
    return sec+'s';
  }
  function fmtTime(ts){
    return new Date(ts).toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'});
  }
  function esc(s){
    return String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  }

  async function update(){
    try{
      const data = await fetch('/health').then(r=>r.json());
      const online  = data.status==='connected';
      const stopped = !data.botRunning;
      const state   = online?'online':stopped?'stopped':'offline';

      const labels = {
        online:  ['✓','Connected',    'Bot is active on the server'],
        offline: ['↺','Reconnecting…','Will rejoin automatically'],
        stopped: ['⏸','Stopped',      'Press Start to reconnect'],
      };
      const [icon,label,sub] = labels[state];

      document.getElementById('status-hero').className  = 'status-hero '+state;
      document.getElementById('status-orb').className   = 'status-orb ' +state;
      document.getElementById('status-orb').textContent = icon;
      const lbl = document.getElementById('status-label');
      lbl.className   = 'status-label '+state;
      lbl.textContent = label;
      document.getElementById('status-sub').textContent  = sub;

      // Pill
      const pill = document.getElementById('nav-pill');
      const dot  = pill.querySelector('.pill-dot');
      pill.className = 'live-pill '+state;
      document.getElementById('nav-pill-text').textContent = label;
      dot.className  = 'pill-dot'+(online?' pulse':'');

      // Stats
      document.getElementById('uptime-val').textContent      = fmt(data.uptime||0);
      document.getElementById('nav-uptime').textContent      = fmt(data.uptime||0);
      document.getElementById('reconnects-val').textContent  = data.reconnectAttempts||0;
      if(data.coords){
        const x=Math.floor(data.coords.x),y=Math.floor(data.coords.y),z=Math.floor(data.coords.z);
        document.getElementById('coords-val').textContent = x+' '+y+' '+z;
      } else {
        document.getElementById('coords-val').textContent = stopped?'—':'…';
      }

      // Button states
      const startBtn=document.getElementById('start-btn');
      const stopBtn =document.getElementById('stop-btn');
      if(stopped){ startBtn.classList.remove('dimmed'); stopBtn.classList.add('dimmed'); }
      else       { stopBtn.classList.remove('dimmed');  startBtn.classList.add('dimmed'); }

      // Disconnect notification
      if(lastStatus==='connected'&&!online&&!stopped&&Notification.permission==='granted'){
        new Notification('Bot Disconnected',{body:'Rejoining automatically…'});
      }
      lastStatus=state;
    }catch(e){
      document.getElementById('status-label').textContent='Unreachable';
    }
  }

  async function updatePlayers(){
    try{
      const players=await fetch('/api/players').then(r=>r.json());
      const el=document.getElementById('player-list');
      const badge=document.getElementById('player-badge');
      badge.textContent=players.length+' online';
      if(!players.length){
        el.innerHTML='<div class="empty-state">No players online right now</div>';
        return;
      }
      el.innerHTML=players.map(p=>{
        if(p.isBot) return \`
          <div class="player-row">
            <div class="player-avatar" style="background:rgba(34,197,94,.1)">🤖</div>
            <span class="player-name">\${esc(p.name)}</span>
            <span class="player-tag bot">BOT</span>
          </div>\`;
        return \`
          <div class="player-row">
            <div class="player-avatar" style="background:var(--surface)">🧑</div>
            <span class="player-name">\${esc(p.name)}</span>
            <div class="player-actions">
              <button class="btn btn-ghost sm" onclick="kickPlayer('\${esc(p.name)}')">Kick</button>
              <button class="btn btn-outline-red sm" onclick="banPlayer('\${esc(p.name)}')">Ban</button>
            </div>
          </div>\`;
      }).join('');
    }catch(e){}
  }

  async function kickPlayer(name){
    if(!confirm('Kick '+name+'?')) return;
    const d=await fetch('/api/players/kick',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name})}).then(r=>r.json());
    if(!d.success) alert(d.msg); else updatePlayers();
  }
  async function banPlayer(name){
    if(!confirm('Ban '+name+'? This is permanent.')) return;
    const d=await fetch('/api/players/ban',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name})}).then(r=>r.json());
    if(!d.success) alert(d.msg); else updatePlayers();
  }

  async function updateChat(){
    try{
      const msgs=await fetch('/api/chat').then(r=>r.json());
      const el=document.getElementById('chat-log');
      if(!msgs.length){ el.innerHTML='<span style="color:var(--muted2)">No messages yet</span>'; return; }
      const atBottom=el.scrollTop+el.clientHeight>=el.scrollHeight-10;
      el.innerHTML=msgs.map(m=>
        \`<div><span class="chat-time">[\${fmtTime(m.time)}]</span> <span class="chat-name" style="color:var(--green)">\${esc(m.username)}</span><span style="color:var(--muted)">: </span><span>\${esc(m.message)}</span></div>\`
      ).join('');
      if(atBottom) el.scrollTop=el.scrollHeight;
    }catch(e){}
  }

  async function sendChat(){
    const inp=document.getElementById('chat-input');
    const msg=inp.value.trim(); if(!msg) return; inp.value='';
    const d=await fetch('/api/chat',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({message:msg})}).then(r=>r.json());
    if(!d.success) alert(d.msg); else updateChat();
  }

  async function startBot(){
    const msg=document.getElementById('bot-ctrl-msg');
    msg.textContent='Starting…';msg.style.color='var(--muted)';
    const d=await fetch('/start',{method:'POST'}).then(r=>r.json());
    msg.textContent=d.success?'Bot started!':d.msg;
    msg.style.color=d.success?'var(--green)':'var(--red)';
    setTimeout(()=>msg.textContent='',3000);
    update();
  }

  async function stopBot(){
    const msg=document.getElementById('bot-ctrl-msg');
    msg.textContent='Stopping…';msg.style.color='var(--muted)';
    const d=await fetch('/stop',{method:'POST'}).then(r=>r.json());
    msg.textContent=d.success?'Bot stopped.':d.msg;
    msg.style.color=d.success?'var(--yellow)':'var(--red)';
    setTimeout(()=>msg.textContent='',3000);
    update();
  }

  async function aternosStart(){
    const msg=document.getElementById('aternos-msg');
    msg.textContent='Sending start command…';msg.style.color='var(--muted)';
    const d=await fetch('/aternos/start',{method:'POST'}).then(r=>r.json());
    msg.textContent=d.msg;msg.style.color=d.success?'var(--green)':'var(--red)';
  }
  async function aternosStop(){
    const msg=document.getElementById('aternos-msg');
    msg.textContent='Sending stop command…';msg.style.color='var(--muted)';
    const d=await fetch('/aternos/stop',{method:'POST'}).then(r=>r.json());
    msg.textContent=d.msg;msg.style.color=d.success?'var(--yellow)':'var(--red)';
  }

  setInterval(update,4000);
  setInterval(updatePlayers,5000);
  setInterval(updateChat,3000);
  update();updatePlayers();updateChat();
</script>
</body>
</html>`);
});
app.get("/tutorial", (req, res) => {
  res.send(`
    <!DOCTYPE html>
    <html lang="en">
      <head>
        <title>${config.name} - Setup Guide</title>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1">
        <link rel="stylesheet" media="print" onload="this.media='all'"
              href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap">
        <style>
          *, *::before, *::after { box-sizing: border-box; }

          body {
            font-family: 'Inter', -apple-system, sans-serif;
            background: #0d1117;
            color: #e6edf3;
            margin: 0;
            padding: 40px 24px;
          }

          main {
            width: 100%;
            max-width: 560px;
            margin: 0 auto;
          }

          .back-btn {
            display: inline-flex;
            align-items: center;
            gap: 6px;
            font-size: 13px;
            font-weight: 500;
            color: #8b949e;
            text-decoration: none;
            background: #161b22;
            border: 1px solid #21262d;
            border-radius: 8px;
            padding: 7px 14px;
            margin-bottom: 32px;
            transition: color 0.2s, background 0.2s;
          }
          .back-btn:hover { background: #21262d; color: #c9d1d9; }

          header { margin-bottom: 32px; }
          header h1 {
            font-size: 26px;
            font-weight: 700;
            color: #f0f6fc;
            margin: 0;
            line-height: 1.2;
          }
          header p {
            font-size: 14px;
            color: #8b949e;
            margin: 6px 0 0;
            line-height: 1.5;
          }

          .step-card {
            background: #161b22;
            border: 1px solid #21262d;
            border-radius: 12px;
            padding: 24px;
            margin-bottom: 16px;
          }

          .step-header {
            display: flex;
            align-items: center;
            gap: 14px;
            margin-bottom: 18px;
          }

          .step-number {
            width: 32px;
            height: 32px;
            border-radius: 50%;
            background: #0d2218;
            border: 2px solid #238636;
            color: #3fb950;
            font-size: 14px;
            font-weight: 700;
            display: flex;
            align-items: center;
            justify-content: center;
            flex-shrink: 0;
          }

          .step-title {
            font-size: 16px;
            font-weight: 700;
            color: #f0f6fc;
            margin: 0;
          }

          ol {
            margin: 0;
            padding: 0;
            list-style: none;
            display: flex;
            flex-direction: column;
            gap: 10px;
          }

          li {
            font-size: 14px;
            color: #8b949e;
            line-height: 1.6;
            padding-left: 20px;
            position: relative;
          }

          li::before {
            content: "·";
            position: absolute;
            left: 6px;
            color: #3fb950;
            font-weight: 700;
          }

          li strong { color: #e6edf3; font-weight: 600; }

          code {
            background: #21262d;
            border: 1px solid #30363d;
            padding: 2px 7px;
            border-radius: 5px;
            font-family: 'SF Mono', 'Fira Code', monospace;
            font-size: 12px;
            color: #e6edf3;
          }

          a { color: #58a6ff; text-decoration: none; }
          a:hover { text-decoration: underline; }

          footer {
            margin-top: 32px;
            text-align: center;
          }
          footer p { font-size: 12px; color: #484f58; margin: 0; }
        </style>
      </head>
      <body>
        <main>
          <a href="/" class="back-btn">&#8592; Back to Dashboard</a>

          <header>
            <h1>Setup Guide</h1>
            <p>Get your AFK bot running in under 15 minutes</p>
          </header>

          <div class="step-card">
            <div class="step-header">
              <div class="step-number">1</div>
              <h2 class="step-title">Configure Aternos</h2>
            </div>
            <ol>
              <li>Go to <strong>Aternos</strong> and open your server.</li>
              <li>Install <strong>Paper/Bukkit</strong> as your server software.</li>
              <li>Enable <strong>Cracked</strong> mode using the green switch.</li>
              <li>Install these plugins: <code>ViaVersion</code>, <code>ViaBackwards</code>, <code>ViaRewind</code></li>
            </ol>
          </div>

          <div class="step-card">
            <div class="step-header">
              <div class="step-number">2</div>
              <h2 class="step-title">GitHub Setup</h2>
            </div>
            <ol>
              <li>Download this project as a ZIP and extract it.</li>
              <li>Edit <code>settings.json</code> with your server IP and port.</li>
              <li>Upload all files to a new <strong>GitHub Repository</strong>.</li>
            </ol>
          </div>

          <div class="step-card">
            <div class="step-header">
              <div class="step-number">3</div>
              <h2 class="step-title">Deploy on Replit (Free 24/7)</h2>
            </div>
            <ol>
              <li>Import your GitHub repo into <strong>Replit</strong>.</li>
              <li>Set the run command to <code>npm start</code>.</li>
              <li>Hit <strong>Run</strong> — the bot connects automatically.</li>
              <li>The bot pings itself every 10 minutes to stay alive.</li>
            </ol>
          </div>

          <footer>
            <p>AFK Bot Dashboard &middot; ${config.name}</p>
          </footer>
        </main>
      </body>
    </html>
  `);
});

app.get("/health", (req, res) => {
  res.json({
    status: botState.connected ? "connected" : "disconnected",
    botRunning,
    uptime: Math.floor((Date.now() - botState.startTime) / 1000),
    coords: bot && bot.entity ? bot.entity.position : null,
    lastActivity: botState.lastActivity,
    reconnectAttempts: botState.reconnectAttempts,
    memoryUsage: process.memoryUsage().heapUsed / 1024 / 1024,
  });
});

app.get("/ping", (req, res) => res.send("pong"));

app.get("/download", (req, res) => {
  const { execSync } = require("child_process");
  const path = require("path");
  const zipPath = "/tmp/cchs-afk-bot.zip";
  try {
    execSync(`cd /home/runner/workspace && zip -r ${zipPath} . -x "node_modules/*" -x ".git/*" -x ".cache/*" -x "*.log"`);
    res.download(zipPath, "cchs-afk-bot.zip", () => {
      try { require("fs").unlinkSync(zipPath); } catch(_) {}
    });
  } catch(e) {
    res.status(500).send("Failed to create zip: " + e.message);
  }
});

// Chat history API
app.get("/api/chat", (req, res) => {
  res.json(chatHistory);
});

app.post("/api/chat", (req, res) => {
  const { message } = req.body;
  if (!message || typeof message !== "string" || !message.trim()) {
    return res.json({ success: false, msg: "Empty message" });
  }
  if (!bot || !botState.connected) {
    return res.json({ success: false, msg: "Bot not connected" });
  }
  try {
    bot.chat(message.trim());
    addLog(`[Chat] Sent from dashboard: ${message.trim()}`);
    res.json({ success: true });
  } catch (e) {
    res.json({ success: false, msg: e.message });
  }
});

// Player list API
app.get("/api/players", (req, res) => {
  if (!bot || !botState.connected) return res.json([]);
  try {
    const allPlayers = Object.keys(bot.players || {});
    // Put the bot first with a flag so the dashboard can style it differently
    const result = allPlayers.map(name => ({
      name,
      isBot: name === bot.username
    })).sort((a, b) => b.isBot - a.isBot);
    res.json(result);
  } catch (e) {
    res.json([]);
  }
});

app.post("/api/players/kick", (req, res) => {
  const { name } = req.body;
  if (!name || typeof name !== "string") return res.json({ success: false, msg: "Invalid name" });
  if (!bot || !botState.connected) return res.json({ success: false, msg: "Bot not connected" });
  try {
    bot.chat(`/kick ${name.trim()}`);
    addLog(`[Moderation] Kicked ${name.trim()} via dashboard`);
    res.json({ success: true });
  } catch (e) {
    res.json({ success: false, msg: e.message });
  }
});

app.post("/api/players/ban", (req, res) => {
  const { name } = req.body;
  if (!name || typeof name !== "string") return res.json({ success: false, msg: "Invalid name" });
  if (!bot || !botState.connected) return res.json({ success: false, msg: "Bot not connected" });
  try {
    bot.chat(`/ban ${name.trim()}`);
    addLog(`[Moderation] Banned ${name.trim()} via dashboard`);
    res.json({ success: true });
  } catch (e) {
    res.json({ success: false, msg: e.message });
  }
});

app.get("/logs", (req, res) => {
  const logs = getLogs();

  const escapeHTML = (str) =>
    str.replace(
      /[&<>"']/g,
      (m) =>
        ({
          "&": "&amp;",
          "<": "&lt;",
          ">": "&gt;",
          '"': "&quot;",
          "'": "&#39;",
        })[m],
    );

  const logCount = logs.length;

  res.send(`
    <!DOCTYPE html>
    <html lang="en">
      <head>
        <title>${config.name} - Logs</title>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1">
        <link rel="stylesheet" media="print" onload="this.media='all'"
              href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap">
        <style>
          *, *::before, *::after { box-sizing: border-box; }

          body {
            font-family: 'Inter', -apple-system, sans-serif;
            background: #0d1117;
            color: #e6edf3;
            margin: 0;
            padding: 40px 24px;
          }

          main {
            width: 100%;
            max-width: 760px;
            margin: 0 auto;
          }

          .back-btn {
            display: inline-flex;
            align-items: center;
            gap: 6px;
            font-size: 13px;
            font-weight: 500;
            color: #8b949e;
            text-decoration: none;
            background: #161b22;
            border: 1px solid #21262d;
            border-radius: 8px;
            padding: 7px 14px;
            margin-bottom: 32px;
            transition: color 0.2s, background 0.2s;
          }
          .back-btn:hover { background: #21262d; color: #c9d1d9; }

          .page-header {
            display: flex;
            align-items: flex-end;
            justify-content: space-between;
            margin-bottom: 20px;
            gap: 12px;
            flex-wrap: wrap;
          }

          .page-header-left h1 {
            font-size: 26px;
            font-weight: 700;
            color: #f0f6fc;
            margin: 0;
            line-height: 1.2;
          }
          .page-header-left p {
            font-size: 14px;
            color: #8b949e;
            margin: 6px 0 0;
          }

          .badge {
            font-size: 12px;
            font-weight: 600;
            color: #8b949e;
            background: #161b22;
            border: 1px solid #21262d;
            border-radius: 20px;
            padding: 4px 12px;
            white-space: nowrap;
          }

          .log-card {
            background: #0d1117;
            border: 1px solid #21262d;
            border-radius: 12px;
            overflow: hidden;
          }

          .log-card-header {
            background: #161b22;
            border-bottom: 1px solid #21262d;
            padding: 12px 18px;
            display: flex;
            align-items: center;
            gap: 8px;
          }

          .dot { width: 10px; height: 10px; border-radius: 50%; }
          .dot-red   { background: #ff5f57; }
          .dot-yellow{ background: #ffbd2e; }
          .dot-green { background: #28c840; }

          .log-card-title {
            font-size: 12px;
            font-weight: 500;
            color: #484f58;
            margin-left: 4px;
          }

          .log-body {
            padding: 16px 18px;
            max-height: 560px;
            overflow-y: auto;
            font-family: 'SF Mono', 'Fira Code', 'Consolas', monospace;
            font-size: 12.5px;
            line-height: 1.7;
          }

          .log-entry { display: block; padding: 1px 0; white-space: pre-wrap; word-break: break-all; }
          .log-entry.error   { color: #ff7b72; }
          .log-entry.warn    { color: #e3b341; }
          .log-entry.success { color: #3fb950; }
          .log-entry.control { color: #58a6ff; }
          .log-entry.default { color: #8b949e; }

          .empty-state {
            text-align: center;
            padding: 40px 20px;
            color: #484f58;
            font-size: 13px;
          }

          .refresh-bar {
            display: flex;
            align-items: center;
            justify-content: flex-end;
            gap: 6px;
            margin-top: 12px;
            font-size: 12px;
            color: #484f58;
          }
          .refresh-dot {
            width: 7px; height: 7px;
            border-radius: 50%;
            background: #3fb950;
            animation: pulse 2s infinite;
          }
          @keyframes pulse {
            0%, 100% { opacity: 1; }
            50% { opacity: 0.3; }
          }

          .console-row {
            display: flex;
            align-items: center;
            border-top: 1px solid #21262d;
            background: #0d1117;
            padding: 10px 18px;
            gap: 10px;
          }

          .console-prompt {
            font-family: 'SF Mono', 'Fira Code', 'Consolas', monospace;
            font-size: 13px;
            color: #3fb950;
            font-weight: 700;
            flex-shrink: 0;
            user-select: none;
          }

          .console-input {
            flex: 1;
            background: transparent;
            border: none;
            outline: none;
            font-family: 'SF Mono', 'Fira Code', 'Consolas', monospace;
            font-size: 12.5px;
            color: #e6edf3;
            caret-color: #3fb950;
          }

          .console-input::placeholder { color: #484f58; }

          .console-send {
            background: #0d2218;
            border: 1px solid #238636;
            color: #3fb950;
            font-size: 12px;
            font-weight: 600;
            padding: 5px 14px;
            border-radius: 6px;
            cursor: pointer;
            font-family: inherit;
            transition: background 0.2s;
            flex-shrink: 0;
          }
          .console-send:hover { background: #122d1a; }
          .console-send:disabled { opacity: 0.5; cursor: default; }

          .console-wrap {
            position: relative;
          }

          .cmd-suggestions {
            display: none;
            position: absolute;
            bottom: calc(100% + 6px);
            left: 0; right: 0;
            background: #161b22;
            border: 1px solid #30363d;
            border-radius: 10px;
            overflow: hidden;
            box-shadow: 0 8px 24px rgba(0,0,0,0.5);
            z-index: 10;
          }

          .cmd-suggestions.visible { display: block; }

          .cmd-item {
            display: flex;
            align-items: baseline;
            gap: 12px;
            padding: 9px 16px;
            cursor: pointer;
            transition: background 0.12s;
            border-bottom: 1px solid #21262d;
          }
          .cmd-item:last-child { border-bottom: none; }
          .cmd-item:hover, .cmd-item.active {
            background: #21262d;
          }

          .cmd-name {
            font-family: 'SF Mono', 'Fira Code', 'Consolas', monospace;
            font-size: 12.5px;
            font-weight: 700;
            color: #3fb950;
            flex-shrink: 0;
            min-width: 90px;
          }

          .cmd-desc {
            font-size: 12px;
            color: #6e7681;
          }

          footer { margin-top: 32px; text-align: center; }
          footer p { font-size: 12px; color: #484f58; margin: 0; }
        </style>
      </head>
      <body>
        <main>
          <a href="/" class="back-btn">&#8592; Back to Dashboard</a>

          <div class="page-header">
            <div class="page-header-left">
              <h1>Bot Logs</h1>
              <p>Live output from the AFK bot</p>
            </div>
            <span class="badge">${logCount} ${logCount === 1 ? "entry" : "entries"}</span>
          </div>

          <div class="log-card">
            <div class="log-card-header">
              <span class="dot dot-red"></span>
              <span class="dot dot-yellow"></span>
              <span class="dot dot-green"></span>
              <span class="log-card-title">bot.log</span>
            </div>
            <div class="log-body" id="log-body">
              ${logCount === 0
                ? `<div class="empty-state">No log entries yet. Start the bot to see output.</div>`
                : logs.map((l) => {
                    const escaped = escapeHTML(l);
                    const lower = l.toLowerCase();
                    let cls = "default";
                    if (lower.includes("error") || lower.includes("fail")) cls = "error";
                    else if (lower.includes("warn")) cls = "warn";
                    else if (lower.includes("[control]")) cls = "control";
                    else if (lower.includes("connect") || lower.includes("join") || lower.includes("spawn")) cls = "success";
                    return `<span class="log-entry ${cls}">${escaped}</span>`;
                  }).join("")
              }
            </div>
            <div class="console-wrap">
              <div class="cmd-suggestions" id="cmd-suggestions"></div>
              <div class="console-row">
                <span class="console-prompt">&gt;</span>
                <input
                  id="console-input"
                  class="console-input"
                  type="text"
                  placeholder="Type / for commands, or any message…"
                  autocomplete="off"
                  spellcheck="false"
                >
                <button id="console-send" class="console-send">Send</button>
              </div>
            </div>
          </div>

          <div class="refresh-bar">
            <span class="refresh-dot"></span>
            <span id="refresh-label">Auto-refreshing every 5 seconds</span>
          </div>

          <footer>
            <p>AFK Bot Dashboard &middot; ${config.name}</p>
          </footer>
        </main>

        <script>
          (function() {
            var logBody  = document.getElementById('log-body');
            var input    = document.getElementById('console-input');
            var sendBtn  = document.getElementById('console-send');
            var label    = document.getElementById('refresh-label');
            var sugBox   = document.getElementById('cmd-suggestions');
            var refreshTimer = null;
            var typing = false;
            var activeIdx = -1;

            var COMMANDS = [
              { name: '/help',   desc: 'Show all available commands' },
              { name: '/pos',    desc: "Show bot's current coordinates" },
              { name: '/status', desc: 'Show connection status & uptime' },
              { name: '/list',   desc: 'List players on the server' },
              { name: '/say',    desc: 'Send a chat message in-game' },
            ];

            function scrollBottom() {
              if (logBody) logBody.scrollTop = logBody.scrollHeight;
            }

            function scheduleRefresh() {
              clearTimeout(refreshTimer);
              if (!typing) {
                refreshTimer = setTimeout(function() { location.reload(); }, 5000);
              }
            }

            function appendLocalEntry(text, cls) {
              var span = document.createElement('span');
              span.className = 'log-entry ' + (cls || 'control');
              span.textContent = text;
              logBody.appendChild(span);
              scrollBottom();
            }

            function hideSuggestions() {
              sugBox.classList.remove('visible');
              sugBox.innerHTML = '';
              activeIdx = -1;
            }

            function setActive(idx) {
              var items = sugBox.querySelectorAll('.cmd-item');
              items.forEach(function(el, i) {
                el.classList.toggle('active', i === idx);
              });
              activeIdx = idx;
            }

            function showSuggestions(val) {
              var query = val.toLowerCase();
              var matches = COMMANDS.filter(function(c) {
                return c.name.startsWith(query);
              });

              if (!matches.length) { hideSuggestions(); return; }

              sugBox.innerHTML = matches.map(function(c, i) {
                return '<div class="cmd-item" data-cmd="' + c.name + '">' +
                  '<span class="cmd-name">' + c.name + '</span>' +
                  '<span class="cmd-desc">' + c.desc + '</span>' +
                '</div>';
              }).join('');

              sugBox.querySelectorAll('.cmd-item').forEach(function(el) {
                el.addEventListener('mousedown', function(e) {
                  e.preventDefault();
                  input.value = el.dataset.cmd + ' ';
                  hideSuggestions();
                  input.focus();
                });
              });

              activeIdx = -1;
              sugBox.classList.add('visible');
            }

            input.addEventListener('input', function() {
              var val = input.value;
              if (val.startsWith('/')) {
                showSuggestions(val);
              } else {
                hideSuggestions();
              }
            });

            input.addEventListener('keydown', function(e) {
              var items = sugBox.querySelectorAll('.cmd-item');
              if (sugBox.classList.contains('visible') && items.length) {
                if (e.key === 'ArrowDown') {
                  e.preventDefault();
                  setActive(Math.min(activeIdx + 1, items.length - 1));
                  return;
                }
                if (e.key === 'ArrowUp') {
                  e.preventDefault();
                  setActive(Math.max(activeIdx - 1, 0));
                  return;
                }
                if (e.key === 'Tab' || (e.key === 'Enter' && activeIdx >= 0)) {
                  e.preventDefault();
                  var chosen = items[activeIdx >= 0 ? activeIdx : 0];
                  input.value = chosen.dataset.cmd + ' ';
                  hideSuggestions();
                  return;
                }
                if (e.key === 'Escape') {
                  hideSuggestions();
                  return;
                }
              }
              if (e.key === 'Enter') sendCommand();
            });

            function sendCommand() {
              var cmd = input.value.trim();
              if (!cmd) return;
              hideSuggestions();
              input.value = '';
              sendBtn.disabled = true;
              appendLocalEntry('> ' + cmd, 'control');

              fetch('/command', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ command: cmd })
              })
              .then(function(r) { return r.json(); })
              .then(function(data) {
                if (data.msg) {
                  data.msg.split('\\n').forEach(function(line) {
                    appendLocalEntry(line, data.success ? 'default' : 'error');
                  });
                }
              })
              .catch(function() {
                appendLocalEntry('Failed to send command.', 'error');
              })
              .finally(function() {
                sendBtn.disabled = false;
                input.focus();
                scheduleRefresh();
              });
            }

            sendBtn.addEventListener('click', sendCommand);

            input.addEventListener('focus', function() {
              typing = true;
              clearTimeout(refreshTimer);
              label.textContent = 'Auto-refresh paused while typing';
            });
            input.addEventListener('blur', function() {
              setTimeout(function() {
                hideSuggestions();
                typing = false;
                label.textContent = 'Auto-refreshing every 5 seconds';
                scheduleRefresh();
              }, 150);
            });

            scrollBottom();
            scheduleRefresh();
          })();
        </script>
      </body>
    </html>
  `);
});

let botRunning = true;

app.post("/start", (req, res) => {
  if (botRunning) return res.json({ success: false, msg: "Already running" });

  botRunning = true;
  createBot();
  addLog("[Control] Bot started");

  res.json({ success: true });
});

app.post("/stop", (req, res) => {
  if (!botRunning) return res.json({ success: false, msg: "Already stopped" });

  botRunning = false;
  isReconnecting = false;
  clearBotTimeouts();   // cancel any pending reconnect timer
  clearAllIntervals();

  if (bot) {
    try { bot.end(); } catch (e) {}
    bot = null;
  }

  addLog("[Control] Bot stopped — auto-reconnect disabled until Start is pressed.");
  res.json({ success: true });
});

app.post("/aternos/start", async (req, res) => {
  const result = await aternosAuto.startServer();
  res.json(result);
});

app.post("/aternos/stop", async (req, res) => {
  const result = await aternosAuto.stopServer();
  res.json(result);
});

app.post("/command", express.json(), (req, res) => {
  const cmd = (req.body.command || "").trim();
  if (!cmd) return res.json({ success: false, msg: "Empty command." });

  addLog(`[Console] > ${cmd}`);

  if (cmd === "/help") {
    const lines = [
      "Available commands:",
      "  /help          - Show this help message",
      "  /pos           - Show bot's current coordinates",
      "  /status        - Show bot connection status",
      "  /list          - Ask server for player list",
      "  /say <message> - Send a chat message in-game",
      "  /<anything>    - Send any Minecraft command directly",
      "  <text>         - Send plain chat (no slash needed)",
    ];
    lines.forEach((l) => addLog(`[Console] ${l}`));
    return res.json({ success: true, msg: lines.join("\n") });
  }

  if (cmd === "/pos" || cmd === "/coords") {
    const pos = bot && bot.entity ? bot.entity.position : null;
    const msg = pos
      ? `Position: X=${Math.floor(pos.x)}  Y=${Math.floor(pos.y)}  Z=${Math.floor(pos.z)}`
      : "Position unavailable (bot not spawned).";
    addLog(`[Console] ${msg}`);
    return res.json({ success: true, msg });
  }

  if (cmd === "/status") {
    const status = botState.connected ? "Connected" : "Disconnected";
    const uptime = Math.floor((Date.now() - botState.startTime) / 1000);
    const msg = `Status: ${status} | Uptime: ${uptime}s | Reconnects: ${botState.reconnectAttempts}`;
    addLog(`[Console] ${msg}`);
    return res.json({ success: true, msg });
  }

  if (!bot || typeof bot.chat !== "function") {
    const msg = bot
      ? "Bot is still connecting — try again in a moment."
      : "Bot is not running.";
    addLog(`[Console] ${msg}`);
    return res.json({ success: false, msg });
  }

  try {
    bot.chat(cmd);
    addLog(`[Console] Sent to server: ${cmd}`);
    return res.json({ success: true, msg: `Sent: ${cmd}` });
  } catch (err) {
    addLog(`[Console] Error: ${err.message}`);
    return res.json({ success: false, msg: err.message });
  }
});

// ============================================================
//                    END OF WEB TOOLS
//============================================================

// ─── Helpers exposed to the Discord bot ──────────────────────────────────────
function getBotPlayers() {
  if (!bot || !botState.connected) return [];
  try {
    return Object.keys(bot.players || {}).map((name) => ({
      name,
      isBot: name === bot.username,
    })).sort((a, b) => b.isBot - a.isBot);
  } catch { return []; }
}

function startBotFromDiscord() {
  if (botRunning) return;
  botRunning = true;
  createBot();
  addLog("[Control] Bot started via Discord");
}

function stopBotFromDiscord() {
  if (!botRunning) return;
  botRunning = false;
  isReconnecting = false;
  clearBotTimeouts();
  clearAllIntervals();
  if (bot) { try { bot.end(); } catch (_) {} bot = null; }
  addLog("[Control] Bot stopped via Discord — auto-reconnect disabled until Start is pressed.");
}

// FIX: handle port conflict gracefully - try next port if taken
const server = app.listen(PORT, "0.0.0.0", () => {
  addLog(`[Server] HTTP server started on port ${server.address().port} `);

  // Start Discord bot if token is configured
  discordBot.init({
    botState,
    config,
    start: startBotFromDiscord,
    stop: stopBotFromDiscord,
    addLog,
    getPlayers: getBotPlayers,
  }).catch((e) => addLog(`[Discord Bot] Init error: ${e.message}`));

  // Initialize Aternos auto-start module
  aternosAuto.init({
    addLog,
    notifyDiscord: (msg) => sendDiscordWebhook(msg, 0xffa500),
  });
});
server.on("error", (err) => {
  if (err.code === "EADDRINUSE") {
    const fallbackPort = PORT + 1;
    addLog(`[Server] Port ${PORT} in use - trying port ${fallbackPort} `);
    server.listen(fallbackPort, "0.0.0.0");
  } else {
    addLog(`[Server] HTTP server error: ${err.message} `);
  }
});

// FIX: only one definition of formatUptime
function formatUptime(seconds) {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  return `${h}h ${m}m ${s} s`;
}

// ============================================================
// ============================================================
// SELF-PING - Keep Replit awake forever
// Uses REPLIT_DEV_DOMAIN (always set on Replit) to ping /ping
// every 4 minutes — well under Replit's ~5-min sleep threshold.
// ============================================================
const SELF_PING_INTERVAL = 4 * 60 * 1000; // 4 minutes

function startSelfPing() {
  // Replit exposes REPLIT_DEV_DOMAIN; fall back to RENDER_EXTERNAL_URL for legacy
  const devDomain = process.env.REPLIT_DEV_DOMAIN || process.env.RENDER_EXTERNAL_URL;
  if (!devDomain) {
    addLog("[KeepAlive] No domain env var found — self-ping disabled");
    return;
  }
  const pingUrl = devDomain.startsWith("http") ? devDomain : `https://${devDomain}`;
  const doPing = () => {
    const protocol = pingUrl.startsWith("https") ? https : http;
    protocol
      .get(`${pingUrl}/ping`, (res) => {
        // silent success — just keeping the dyno/repl alive
      })
      .on("error", (err) => {
        addLog(`[KeepAlive] Self-ping failed: ${err.message}`);
      });
  };
  setInterval(doPing, SELF_PING_INTERVAL);
  doPing(); // immediate first ping on startup
  addLog(`[KeepAlive] Self-ping active every ${SELF_PING_INTERVAL / 60000} min → ${pingUrl}/ping`);
}

startSelfPing();

// ============================================================
// ATERNOS WATCHDOG - Check server status every 5 min even
// while the bot is connected. If the Minecraft server goes
// offline (rare forced stop by Aternos), trigger a restart
// and reconnect automatically.
// ============================================================
const ATERNOS_WATCHDOG_INTERVAL = 5 * 60 * 1000; // 5 minutes
// Only start watchdog after the bot has been up a bit so it
// doesn't race with the initial Aternos check in createBot().
setTimeout(() => {
  setInterval(async () => {
    try {
      const Aternos = require("aternos-unofficial-api");
      const username = process.env.ATERNOS_USERNAME;
      const password = process.env.ATERNOS_PASSWORD;
      if (!username || !password) return;

      const cookies = await Aternos.loginToAternos(username, password);
      const { servers } = await Aternos.getServerList(cookies);
      if (!servers || servers.length === 0) return;

      const server = servers[0];
      addLog(`[Watchdog] Aternos status: ${server.status}`);

      if (server.status !== "online" && server.status !== "starting") {
        addLog(`[Watchdog] ⚠️ Server went ${server.status} — restarting it now...`);
        try {
          await Aternos.manageServer(cookies, server.id, "start");
          addLog("[Watchdog] ✅ Start command sent. Server coming back online...");
        } catch (startErr) {
          addLog(`[Watchdog] Start failed: ${startErr.message}`);
        }
        // Kick the bot off so it will reconnect once Aternos is ready
        if (bot && botState.connected) {
          addLog("[Watchdog] Disconnecting bot so it reconnects after server starts...");
          try { bot.end("watchdog-restart"); } catch (_) {}
        }
      }
    } catch (e) {
      addLog(`[Watchdog] Aternos check error: ${e.message}`);
    }
  }, ATERNOS_WATCHDOG_INTERVAL);
  addLog("[Watchdog] Aternos watchdog started (checks every 5 min)");
}, 60 * 1000); // start 60s after boot

// ============================================================
// BOT WATCHDOG - If the bot has been disconnected for more than
// 3 minutes (stuck reconnect, crash, etc.) force a new attempt.
// ============================================================
const BOT_WATCHDOG_INTERVAL = 3 * 60 * 1000; // check every 3 min
let lastConnectedAt = Date.now();

setInterval(() => {
  if (botState.connected) {
    lastConnectedAt = Date.now();
    return;
  }
  const offlineMs = Date.now() - lastConnectedAt;
  if (offlineMs > BOT_WATCHDOG_INTERVAL && botRunning && !isReconnecting) {
    addLog(`[BotWatchdog] Bot has been offline ${Math.round(offlineMs / 1000)}s — forcing reconnect`);
    isReconnecting = false; // clear any stuck state
    if (reconnectTimeoutId) { clearTimeout(reconnectTimeoutId); reconnectTimeoutId = null; }
    createBot();
  }
}, BOT_WATCHDOG_INTERVAL);

// ============================================================
// MEMORY MONITORING
// ============================================================
setInterval(
  () => {
    const mem = process.memoryUsage();
    const heapMB = (mem.heapUsed / 1024 / 1024).toFixed(2);
    addLog(`[Memory] Heap: ${heapMB} MB`);
  },
  5 * 60 * 1000,
);

// ============================================================
// BOT CREATION WITH RECONNECTION LOGIC
// ============================================================
// ============================================================
// RECONNECTION & TIMEOUT MANAGEMENT
// ============================================================
let bot = null;
let activeIntervals = [];
let reconnectTimeoutId = null;
let connectionTimeoutId = null;
let isReconnecting = false;
let lastSpawnedAt = 0;       // timestamp of last successful spawn
let serverClosedByHost = false; // true when server explicitly shut down (not a kick/ban)

function clearBotTimeouts() {
  if (reconnectTimeoutId) {
    clearTimeout(reconnectTimeoutId);
    reconnectTimeoutId = null;
  }
  if (connectionTimeoutId) {
    clearTimeout(connectionTimeoutId);
    connectionTimeoutId = null;
  }
}

// FIX: Discord rate limiting - track last send time
let lastDiscordSend = 0;
const DISCORD_RATE_LIMIT_MS = 5000; // min 5s between webhook calls

function clearAllIntervals() {
  addLog(`[Cleanup] Clearing ${activeIntervals.length} intervals`);
  activeIntervals.forEach((id) => clearInterval(id));
  activeIntervals = [];
}

function addInterval(callback, delay) {
  const id = setInterval(callback, delay);
  activeIntervals.push(id);
  return id;
}

function getReconnectDelay() {
  if (botState.wasDuplicateLogin) {
    botState.wasDuplicateLogin = false;
    const dupDelay = 90000 + Math.floor(Math.random() * 15000); // 90–105s
    addLog(
      `[Bot] Duplicate login — waiting ${Math.round(dupDelay / 1000)}s for old session to expire`,
    );
    return dupDelay;
  }

  if (botState.wasThrottled) {
    botState.wasThrottled = false;
    const throttleDelay = 60000 + Math.floor(Math.random() * 60000);
    addLog(
      `[Bot] Throttle detected - using extended delay: ${throttleDelay / 1000}s`,
    );
    return throttleDelay;
  }

  // FIX: read auto-reconnect-delay from settings as base delay
  const baseDelay = config.utils["auto-reconnect-delay"] || 3000;
  const maxDelay = config.utils["max-reconnect-delay"] || 30000;
  const delay = Math.min(
    baseDelay * Math.pow(2, botState.reconnectAttempts),
    maxDelay,
  );
  const jitter = Math.floor(Math.random() * 2000);
  return delay + jitter;
}

async function createBot() {
  if (isReconnecting) {
    addLog("[Bot] Already reconnecting, skipping...");
    return;
  }

  // Cleanup previous bot properly to avoid ghost bots
  if (bot) {
    clearAllIntervals();
    try {
      bot.removeAllListeners();
      bot.end();
    } catch (e) {
      addLog("[Cleanup] Error ending previous bot:", e.message);
    }
    bot = null;
  }

  // Check Aternos if:
  // - First run (never connected before)
  // - Last connection lasted under 20s (server likely rejected us / still starting)
  // - Server explicitly closed the connection ("Server closed" kick or ECONNRESET)
  const connectedDuration = lastSpawnedAt ? (Date.now() - lastSpawnedAt) : 0;
  const serverLikelyOffline = lastSpawnedAt === 0 || connectedDuration < 20000 || serverClosedByHost;
  if (serverLikelyOffline) {
    if (serverClosedByHost) addLog("[Aternos] Server was closed by host — checking Aternos status...");
    serverClosedByHost = false; // reset after consuming
    await aternosAuto.checkAndEnsureOnline();
  } else {
    addLog("[Aternos] Connection was stable — skipping status check.");
  }

  addLog(`[Bot] Creating bot instance...`);
  addLog(`[Bot] Connecting to ${config.server.ip}:${config.server.port}`);

  try {
    // FIX: use version:false to auto-detect server version so the bot can join any server.
    // If the user explicitly sets a version in settings.json it is still respected.
    const botVersion =
      config.server.version && config.server.version.trim() !== ""
        ? config.server.version
        : false;
    let botBanned = false; // set true on ban kick — stops the reconnect loop
    let duplicateLoginDetected = false; // set true on duplicate_login kick — use long delay

    // BOT_USERNAME env var lets each forked Replit use a different name without editing settings.json
    const botUsername = process.env.BOT_USERNAME || config["bot-account"].username;

    bot = mineflayer.createBot({
      username: botUsername,
      password: config["bot-account"].password || undefined,
      auth: config["bot-account"].type,
      host: config.server.ip,
      port: config.server.port,
      version: botVersion,
      hideErrors: false,
      checkTimeoutInterval: 600000,
    });

    bot.loadPlugin(pathfinder);

    // FIX: connection timeout - end the old bot before reconnecting to avoid ghost bots
    clearBotTimeouts();
    connectionTimeoutId = setTimeout(() => {
      if (!botState.connected) {
        addLog("[Bot] Connection timeout - no spawn received");
        try {
          bot.removeAllListeners();
          bot.end();
        } catch (e) {
          /* ignore */
        }
        bot = null;
        scheduleReconnect();
      }
    }, 150000); // 150s - Aternos servers can take 90-120s to finish spawning a player

    // FIX: guard against spawn firing twice (can happen on some servers)
    let spawnHandled = false;

    bot.once("spawn", () => {
      if (spawnHandled) return;
      spawnHandled = true;

      clearBotTimeouts();
      botState.connected = true;
      botState.lastActivity = Date.now();
      botState.reconnectAttempts = 0;
      isReconnecting = false;
      lastSpawnedAt = Date.now();

      addLog(
        `[Bot] [+] Successfully spawned on server! (Version: ${bot.version})`,
      );

      if (
        config.discord &&
        config.discord.events &&
        config.discord.events.connect
      ) {
        sendDiscordWebhook(
          `[+] **Connected** to \`${config.server.ip}\``,
          0x4ade80,
        );
      }
      discordBot.notifyBotConnect();

      // FIX: use bot.version (auto-detected) instead of config value so minecraft-data always matches
      const mcData = require("minecraft-data")(bot.version);
      const defaultMove = new Movements(bot, mcData);
      defaultMove.allowFreeMotion = false;
      defaultMove.canDig = false;
      defaultMove.liquidCost = 1000;
      defaultMove.fallDamageCost = 1000;

      initializeModules(bot, mcData, defaultMove);

      // Attempt creative mode (only works if bot has OP and enabled in settings)
      setTimeout(() => {
        if (bot && botState.connected && config.server["try-creative"]) {
          bot.chat("/gamemode creative");
          addLog("[INFO] Attempted to set creative mode (requires OP)");
        }
      }, 3000);

      bot.on("messagestr", (message) => {
        if (
          message.includes("commands.gamemode.success.self") ||
          message.includes("Set own game mode to Creative Mode")
        ) {
          addLog("[INFO] Bot is now in Creative Mode.");
        }
      });
    });

    // Player join / leave → notify Discord bot
    bot.on("playerJoined", (player) => {
      if (player.username === bot.username) return; // ignore self
      addLog(`[Server] ${player.username} joined`);
      discordBot.notifyPlayerJoin(player.username);
    });

    bot.on("playerLeft", (player) => {
      if (player.username === bot.username) return; // ignore self
      addLog(`[Server] ${player.username} left`);
      discordBot.notifyPlayerLeave(player.username);
    });

    // FIX: 'kicked' fires before 'end'. Remove the scheduleReconnect from 'kicked'
    // so that 'end' is the single source of reconnect truth, preventing double-trigger.
    bot.on("kicked", (reason) => {
      // FIX: stringify reason if it's an object to make it readable in logs
      const kickReason =
        typeof reason === "object" ? JSON.stringify(reason) : reason;
      addLog(`[Bot] Kicked: ${kickReason}`);
      botState.connected = false;
      botState.errors.push({
        type: "kicked",
        reason: kickReason,
        time: Date.now(),
      });
      clearAllIntervals();

      const reasonStr = String(kickReason).toLowerCase();
      if (
        reasonStr.includes("throttl") ||
        reasonStr.includes("wait before reconnect") ||
        reasonStr.includes("too fast")
      ) {
        addLog(
          "[Bot] Throttle kick detected - will use extended reconnect delay",
        );
        botState.wasThrottled = true;
      }

      // If the bot is banned, stop reconnecting — hammering a server that won't let us in is pointless
      if (
        reasonStr.includes("banned") ||
        reasonStr.includes("you are banned") ||
        reasonStr.includes("blacklisted")
      ) {
        botBanned = true;
        addLog("[Bot] ⛔ Bot is BANNED from this server — stopping auto-reconnect. Fix the ban and restart the bot manually.");
      }

      // "Server closed" / Aternos startup error = host shut down or is starting — force Aternos check
      if (
        reasonStr.includes("server closed") ||
        reasonStr.includes("server is restarting") ||
        reasonStr.includes("server is stopping") ||
        reasonStr.includes("an error occurred") ||
        reasonStr.includes("please try again") ||
        reasonStr.includes("connection lost") ||
        reasonStr.includes("timed out")
      ) {
        serverClosedByHost = true;
        addLog("[Bot] ⚠️ Server appears offline/starting — will check Aternos before next connect attempt.");
      }

      // duplicate_login = old session still alive on server; wait longer so it expires
      if (reasonStr.includes("duplicate_login") || reasonStr.includes("duplicate login")) {
        duplicateLoginDetected = true;
        botState.wasDuplicateLogin = true;
        addLog("[Bot] ⚠️ Duplicate login detected — old session still alive. Waiting 90s for it to expire...");
      }

      if (
        config.discord &&
        config.discord.events &&
        config.discord.events.disconnect
      ) {
        sendDiscordWebhook(`[!] **Kicked**: ${kickReason}`, 0xff0000);
      }
      // NOTE: do NOT call scheduleReconnect() here - 'end' will fire right after 'kicked' and handle it
    });

    // FIX: 'end' is the single reconnect trigger
    bot.on("end", (reason) => {
      addLog(`[Bot] Disconnected: ${reason || "Unknown reason"}`);
      botState.connected = false;
      clearAllIntervals();
      spawnHandled = false; // reset for next connection

      // Don't reconnect if we're banned — no point
      if (botBanned) {
        addLog("[Bot] Not reconnecting — bot is banned from this server.");
        return;
      }

      if (
        config.discord &&
        config.discord.events &&
        config.discord.events.disconnect
      ) {
        sendDiscordWebhook(
          `[-] **Disconnected**: ${reason || "Unknown"}`,
          0xf87171,
        );
      }
      discordBot.notifyBotDisconnect(reason);

      // ALWAYS reconnect — bot must never leave the server
      scheduleReconnect();
    });

    bot.on("error", (err) => {
      const msg = err.message || "";
      addLog(`[Bot] Error: ${msg}`);
      botState.errors.push({ type: "error", message: msg, time: Date.now() });
      // Don't reconnect on error - let 'end' event handle it
    });
  } catch (err) {
    addLog(`[Bot] Failed to create bot: ${err.message}`);
    scheduleReconnect();
  }
}

function scheduleReconnect() {
  clearBotTimeouts();

  // If the user manually stopped the bot, don't reconnect until they press Start again
  if (!botRunning) {
    addLog("[Bot] Auto-reconnect suppressed — bot was manually stopped.");
    return;
  }

  // FIX: don't stack reconnect if already waiting
  if (isReconnecting) {
    addLog("[Bot] Reconnect already scheduled, skipping duplicate.");
    return;
  }

  isReconnecting = true;
  botState.reconnectAttempts++;

  const delay = getReconnectDelay();
  addLog(
    `[Bot] Reconnecting in ${delay / 1000}s (attempt #${botState.reconnectAttempts})`,
  );

  reconnectTimeoutId = setTimeout(() => {
    reconnectTimeoutId = null;
    isReconnecting = false;
    createBot();
  }, delay);
}

// ============================================================
// MODULE INITIALIZATION
// ============================================================
function initializeModules(bot, mcData, defaultMove) {
  addLog("[Modules] Initializing all modules...");

  // ---------- AUTO AUTH (REACTIVE) ----------
  if (config.utils["auto-auth"] && config.utils["auto-auth"].enabled) {
    const password = config.utils["auto-auth"].password;
    let authHandled = false;

    const tryAuth = (type) => {
      if (authHandled || !bot || !botState.connected) return;
      authHandled = true;
      if (type === "register") {
        bot.chat(`/register ${password} ${password}`);
        addLog("[Auth] Detected register prompt - sent /register");
      } else {
        bot.chat(`/login ${password}`);
        addLog("[Auth] Detected login prompt - sent /login");
      }
    };

    bot.on("messagestr", (message) => {
      if (authHandled) return;
      const msg = message.toLowerCase();
      if (
        msg.includes("/register") ||
        msg.includes("register ") ||
        msg.includes("지정된 비밀번호")
      ) {
        tryAuth("register");
      } else if (
        msg.includes("/login") ||
        msg.includes("login ") ||
        msg.includes("로그인")
      ) {
        tryAuth("login");
      }
    });

    // Failsafe: if no prompt after 15s AND the bot appears frozen (no health/food
    // data means the auth plugin is blocking the spawn), try /login once.
    // If the bot is already authenticated (active session), it will have valid
    // health/food values — skip the failsafe to avoid duplicate_login kicks.
    setTimeout(() => {
      if (!authHandled && bot && botState.connected) {
        // Check if bot has health data — authenticated bots have it, frozen ones don't
        const health = bot.health;
        const food   = bot.food;
        const seemsFrozen = (health === undefined || health === 0) && (food === undefined || food === 0);
        if (seemsFrozen) {
          addLog("[Auth] Bot appears frozen after 15s — sending /login as failsafe");
          bot.chat(`/login ${password}`);
          authHandled = true;
        } else {
          addLog("[Auth] No login prompt detected but bot has health/food — already authenticated, skipping /login failsafe");
          authHandled = true; // mark handled so reactive handler doesn't fire later
        }
      }
    }, 15000);
  }

  // ---------- CHAT MESSAGES ----------
  if (config.utils["chat-messages"] && config.utils["chat-messages"].enabled) {
    const messages = config.utils["chat-messages"].messages;
    if (config.utils["chat-messages"].repeat) {
      let i = 0;
      addInterval(() => {
        if (bot && botState.connected) {
          bot.chat(messages[i]);
          botState.lastActivity = Date.now();
          i = (i + 1) % messages.length;
        }
      }, config.utils["chat-messages"]["repeat-delay"] * 1000);
    } else {
      messages.forEach((msg, idx) => {
        setTimeout(() => {
          if (bot && botState.connected) bot.chat(msg);
        }, idx * 1000);
      });
    }
  }

  // ---------- MOVE TO POSITION ----------
  // FIX: only use position goal if circle-walk is NOT enabled (they fight over pathfinder)
  if (
    config.position &&
    config.position.enabled &&
    !(
      config.movement &&
      config.movement["circle-walk"] &&
      config.movement["circle-walk"].enabled
    )
  ) {
    bot.pathfinder.setMovements(defaultMove);
    bot.pathfinder.setGoal(
      new GoalBlock(config.position.x, config.position.y, config.position.z),
    );
    addLog("[Position] Navigating to configured position...");
  }

  // ---------- ANTI-AFK ----------
  if (config.utils["anti-afk"] && config.utils["anti-afk"].enabled) {
    // Arm swinging
    addInterval(
      () => {
        if (!bot || !botState.connected) return;
        try {
          bot.swingArm();
        } catch (e) {}
      },
      10000 + Math.floor(Math.random() * 50000),
    );

    // Hotbar cycling
    addInterval(
      () => {
        if (!bot || !botState.connected) return;
        try {
          const slot = Math.floor(Math.random() * 9);
          bot.setQuickBarSlot(slot);
        } catch (e) {}
      },
      30000 + Math.floor(Math.random() * 90000),
    );

    // Teabagging
    addInterval(
      () => {
        if (
          !bot ||
          !botState.connected ||
          typeof bot.setControlState !== "function"
        )
          return;
        if (Math.random() > 0.9) {
          let count = 2 + Math.floor(Math.random() * 4);
          const doTeabag = () => {
            if (count <= 0 || !bot || typeof bot.setControlState !== "function")
              return;
            try {
              bot.setControlState("sneak", true);
              setTimeout(() => {
                if (bot && typeof bot.setControlState === "function")
                  bot.setControlState("sneak", false);
                count--;
                setTimeout(doTeabag, 150);
              }, 150);
            } catch (e) {}
          };
          doTeabag();
        }
      },
      120000 + Math.floor(Math.random() * 180000),
    );

    // FIX: micro-walk only when circle-walk is NOT running, to avoid interrupting pathfinder
    if (
      !(
        config.movement &&
        config.movement["circle-walk"] &&
        config.movement["circle-walk"].enabled
      )
    ) {
      addInterval(
        () => {
          if (
            !bot ||
            !botState.connected ||
            typeof bot.setControlState !== "function"
          )
            return;
          try {
            const yaw = Math.random() * Math.PI * 2;
            bot.look(yaw, 0, true);
            bot.setControlState("forward", true);
            setTimeout(
              () => {
                if (bot && typeof bot.setControlState === "function")
                  bot.setControlState("forward", false);
              },
              500 + Math.floor(Math.random() * 1500),
            );
            botState.lastActivity = Date.now();
          } catch (e) {
            addLog("[AntiAFK] Walk error:", e.message);
          }
        },
        120000 + Math.floor(Math.random() * 360000),
      );
    }

    if (config.utils["anti-afk"].sneak) {
      try {
        if (typeof bot.setControlState === "function")
          bot.setControlState("sneak", true);
      } catch (e) {}
    }
  }

  // ---------- MOVEMENT MODULES ----------
  // FIX: check top-level movement.enabled flag
  if (config.movement && config.movement.enabled !== false) {
    // FIX: circle-walk and random-jump both jump - only run one jumping mechanism
    // random-jump is skipped if anti-afk jump is handled elsewhere; we only use random-jump here
    if (
      config.movement["circle-walk"] &&
      config.movement["circle-walk"].enabled
    ) {
      startCircleWalk(bot, defaultMove);
    }
    // FIX: only run random-jump if circle-walk is NOT running (circle-walk also keeps bot moving)
    if (
      config.movement["random-jump"] &&
      config.movement["random-jump"].enabled &&
      !(
        config.movement["circle-walk"] && config.movement["circle-walk"].enabled
      )
    ) {
      startRandomJump(bot);
    }
    if (
      config.movement["look-around"] &&
      config.movement["look-around"].enabled
    ) {
      startLookAround(bot);
    }
  }

  // ---------- CUSTOM MODULES ----------
  // FIX: avoidMobs AND combatModule conflict - if combat is enabled, don't run avoidMobs at the same time
  if (config.modules.avoidMobs && !config.modules.combat) {
    avoidMobs(bot);
  }
  if (config.modules.combat) {
    combatModule(bot, mcData);
  }
  if (config.modules.beds) {
    bedModule(bot, mcData);
  }
  if (config.modules.chat) {
    chatModule(bot);
  }

  addLog("[Modules] All modules initialized!");
}

// ============================================================
// MOVEMENT HELPERS
// ============================================================
function startCircleWalk(bot, defaultMove) {
  const radius = config.movement["circle-walk"].radius;
  let angle = 0;
  let lastPathTime = 0;

  addInterval(() => {
    if (!bot || !botState.connected) return;
    const now = Date.now();
    if (now - lastPathTime < 2000) return;
    lastPathTime = now;
    try {
      const x = bot.entity.position.x + Math.cos(angle) * radius;
      const z = bot.entity.position.z + Math.sin(angle) * radius;
      bot.pathfinder.setMovements(defaultMove);
      bot.pathfinder.setGoal(
        new GoalBlock(
          Math.floor(x),
          Math.floor(bot.entity.position.y),
          Math.floor(z),
        ),
      );
      angle += Math.PI / 4;
      botState.lastActivity = Date.now();
    } catch (e) {
      addLog("[CircleWalk] Error:", e.message);
    }
  }, config.movement["circle-walk"].speed);
}

function startRandomJump(bot) {
  addInterval(() => {
    if (
      !bot ||
      !botState.connected ||
      typeof bot.setControlState !== "function"
    )
      return;
    try {
      bot.setControlState("jump", true);
      setTimeout(() => {
        if (bot && typeof bot.setControlState === "function")
          bot.setControlState("jump", false);
      }, 300);
      botState.lastActivity = Date.now();
    } catch (e) {
      addLog("[RandomJump] Error:", e.message);
    }
  }, config.movement["random-jump"].interval);
}

function startLookAround(bot) {
  addInterval(() => {
    if (!bot || !botState.connected) return;
    try {
      const yaw = Math.random() * Math.PI * 2 - Math.PI;
      const pitch = (Math.random() * Math.PI) / 2 - Math.PI / 4;
      bot.look(yaw, pitch, false);
      botState.lastActivity = Date.now();
    } catch (e) {
      addLog("[LookAround] Error:", e.message);
    }
  }, config.movement["look-around"].interval);
}

// ============================================================
// CUSTOM MODULES
// ============================================================

// Avoid mobs/players
// FIX: e.username only exists on players; use e.name for mobs - now handled properly
function avoidMobs(bot) {
  const safeDistance = 5;
  addInterval(() => {
    if (
      !bot ||
      !botState.connected ||
      typeof bot.setControlState !== "function"
    )
      return;
    try {
      const entities = Object.values(bot.entities).filter(
        (e) =>
          e.type === "mob" ||
          (e.type === "player" && e.username !== bot.username),
      );
      for (const e of entities) {
        if (!e.position) continue;
        const distance = bot.entity.position.distanceTo(e.position);
        if (distance < safeDistance) {
          bot.setControlState("back", true);
          setTimeout(() => {
            if (bot && typeof bot.setControlState === "function")
              bot.setControlState("back", false);
          }, 500);
          break;
        }
      }
    } catch (e) {
      addLog("[AvoidMobs] Error:", e.message);
    }
  }, 2000);
}

// Combat module
// FIX: attack cooldown for 1.9+ (600ms minimum between attacks)
// FIX: lock onto a target for multiple ticks instead of randomly switching every tick
// FIX: autoEat - use i.foodPoints directly (mineflayer item property) instead of broken mcData lookup
function combatModule(bot, mcData) {
  let lastAttackTime = 0;
  let lockedTarget = null;
  let lockedTargetExpiry = 0;

  // FIX: use physicsTick (not the deprecated physicTick)
  bot.on("physicsTick", () => {
    if (!bot || !botState.connected) return;
    if (!config.combat["attack-mobs"]) return;

    const now = Date.now();
    // FIX: 1.9+ attack cooldown - respect at least 600ms between swings
    if (now - lastAttackTime < 620) return;

    try {
      // FIX: only pick a new target if current one is gone or lock expired
      if (
        lockedTarget &&
        now < lockedTargetExpiry &&
        bot.entities[lockedTarget.id] &&
        lockedTarget.position
      ) {
        const dist = bot.entity.position.distanceTo(lockedTarget.position);
        if (dist < 4) {
          bot.attack(lockedTarget);
          lastAttackTime = now;
          return;
        } else {
          lockedTarget = null;
        }
      }

      // Pick a new target
      const mobs = Object.values(bot.entities).filter(
        (e) =>
          e.type === "mob" &&
          e.position &&
          bot.entity.position.distanceTo(e.position) < 4,
      );
      if (mobs.length > 0) {
        lockedTarget = mobs[0];
        lockedTargetExpiry = now + 3000; // stick to same mob for 3 seconds
        bot.attack(lockedTarget);
        lastAttackTime = now;
      }
    } catch (e) {
      addLog("[Combat] Error:", e.message);
    }
  });

  // FIX: autoEat - check foodPoints property on the item directly (works reliably)
  bot.on("health", () => {
    if (!config.combat["auto-eat"]) return;
    try {
      if (bot.food < 14) {
        const food = bot.inventory
          .items()
          .find((i) => i.foodPoints && i.foodPoints > 0);
        if (food) {
          bot
            .equip(food, "hand")
            .then(() => bot.consume())
            .catch((e) => addLog("[AutoEat] Error:", e.message));
        }
      }
    } catch (e) {
      addLog("[AutoEat] Error:", e.message);
    }
  });
}

// Bed module
// FIX: bot.isSleeping can be stale; use a local isTryingToSleep guard to prevent double-sleep errors
// FIX: place-night was false in default settings - documentation note added
function bedModule(bot, mcData) {
  let isTryingToSleep = false;

  addInterval(async () => {
    if (!bot || !botState.connected) return;
    if (!config.beds["place-night"]) return; // FIX: check flag (was always skipping before)

    try {
      const isNight =
        bot.time.timeOfDay >= 12500 && bot.time.timeOfDay <= 23500;

      // FIX: use local guard instead of stale bot.isSleeping
      if (isNight && !isTryingToSleep) {
        const bedBlock = bot.findBlock({
          matching: (block) => block.name.includes("bed"),
          maxDistance: 8,
        });

        if (bedBlock) {
          isTryingToSleep = true;
          try {
            await bot.sleep(bedBlock);
            addLog("[Bed] Sleeping...");
          } catch (e) {
            // Can't sleep - maybe not night enough or monsters nearby
          } finally {
            isTryingToSleep = false;
          }
        }
      }
    } catch (e) {
      isTryingToSleep = false;
      addLog("[Bed] Error:", e.message);
    }
  }, 10000);
}

// Chat module
// FIX: wire up discord.events.chat flag
function chatModule(bot) {
  let lastReply = 0; // cooldown: one reply per 10s max

  bot.on("chat", (username, message) => {
    // ignore our own messages (guard against servers that echo back with modified names too)
    if (!bot) return;
    const botName = (bot.username || "").toLowerCase();
    const senderName = (username || "").toLowerCase();
    if (senderName === botName || senderName.includes(botName)) return;

    // Store in chat history
    chatHistory.push({ username, message, time: Date.now() });
    if (chatHistory.length > 50) chatHistory.shift();

    try {
      // FIX: send chat events to Discord if enabled
      if (
        config.discord &&
        config.discord.enabled &&
        config.discord.events &&
        config.discord.events.chat
      ) {
        sendDiscordWebhook(`💬 **${username}**: ${message}`, 0x7289da);
      }

      if (config.chat && config.chat.respond) {
        const now = Date.now();
        if (now - lastReply < 10000) return; // 10s cooldown between replies
        const lowerMsg = message.toLowerCase();
        if (lowerMsg.includes("hello") || lowerMsg.includes("hi")) {
          bot.chat(`Hello, ${username}!`);
          lastReply = now;
        }
        if (message.startsWith("!tp ")) {
          const target = message.split(" ")[1];
          if (target) bot.chat(`/tp ${target}`);
        }
      }
    } catch (e) {
      addLog("[Chat] Error:", e.message);
    }
  });

  // ─── Death message detection ──────────────────────────────────────────────
  // Vanilla Minecraft death messages are system messages (not player chat).
  // They always start with the player's username followed by a death phrase.
  const DEATH_PATTERN = /\b(was slain|was killed|drowned|fell|burned to death|was burnt|suffocated|blew up|was blown up|was shot|starved to death|was pricked|walked into|was fireballed|fell out of|was squished|was impaled|was stung|froze|was frozen|hit the ground too hard|experienced kinetic energy|went up in flames|walked into fire|withered away|was struck by lightning|was pummeled|was squashed|tried to swim in lava|was skewered|died)\b/i;

  bot.on("messagestr", (rawMsg) => {
    // Skip player chat (starts with <username>), server messages with brackets, etc.
    if (!rawMsg || rawMsg.startsWith("<") || rawMsg.startsWith("[")) return;
    if (!DEATH_PATTERN.test(rawMsg)) return;

    // Extract player name — must be a valid MC username at the start
    const nameMatch = rawMsg.match(/^([A-Za-z0-9_]{1,16})\s/);
    if (!nameMatch) return;
    const username = nameMatch[1];

    // Ignore deaths attributed to the AFK bot itself
    if (bot && username.toLowerCase() === (bot.username || "").toLowerCase()) return;

    addLog(`[Deaths] ${rawMsg}`);
    recordDeath(username, rawMsg);
  });
}

// ============================================================
// CONSOLE COMMANDS
// ============================================================
const readline = require("readline");
const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
  terminal: false,
});

rl.on("line", (line) => {
  if (!bot || !botState.connected) {
    addLog("[Console] Bot not connected");
    return;
  }

  const trimmed = line.trim();
  if (trimmed.startsWith("say ")) {
    bot.chat(trimmed.slice(4));
  } else if (trimmed.startsWith("cmd ")) {
    bot.chat("/" + trimmed.slice(4));
  } else if (trimmed === "status") {
    addLog(
      `Connected: ${botState.connected}, Uptime: ${formatUptime(Math.floor((Date.now() - botState.startTime) / 1000))}`,
    );
  } else {
    bot.chat(trimmed);
  }
});

// ============================================================
// DISCORD WEBHOOK INTEGRATION
// FIX: use Buffer.byteLength for Content-Length (handles non-ASCII usernames correctly)
// FIX: rate limiting to avoid spam when bot is flapping
// ============================================================
function sendDiscordWebhook(content, color = 0x0099ff) {
  const webhookUrl = process.env.DISCORD_WEBHOOK_URL || config.discord.webhookUrl;
  if (
    !webhookUrl ||
    webhookUrl.includes("YOUR_DISCORD")
  )
    return;

  // FIX: Discord rate limiting - skip if sent too recently
  const now = Date.now();
  if (now - lastDiscordSend < DISCORD_RATE_LIMIT_MS) {
    addLog("[Discord] Rate limited - skipping webhook");
    return;
  }
  lastDiscordSend = now;

  const protocol = webhookUrl.startsWith("https") ? https : http;
  const urlParts = new URL(webhookUrl);

  const payload = JSON.stringify({
    username: config.name,
    embeds: [
      {
        description: content,
        color: color,
        timestamp: new Date().toISOString(),
        footer: { text: "Slobos AFK Bot" },
      },
    ],
  });

  const options = {
    hostname: urlParts.hostname,
    port: 443,
    path: urlParts.pathname + urlParts.search,
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      // FIX: use Buffer.byteLength instead of payload.length - handles non-ASCII (e.g. usernames with accents/emoji)
      "Content-Length": Buffer.byteLength(payload, "utf8"),
    },
  };

  addLog(`[Discord] Sending webhook...`);
  const req = protocol.request(options, (res) => {
    addLog(`[Discord] Webhook sent (HTTP ${res.statusCode})`);
  });

  req.on("error", (e) => {
    addLog(`[Discord] Error sending webhook: ${e.message}`);
  });

  req.write(payload);
  req.end();
}

// ============================================================
// CRASH RECOVERY - IMMORTAL MODE
// FIX: guard against uncaughtException stacking reconnects when isReconnecting is already true
// ============================================================
process.on("uncaughtException", (err) => {
  const msg = err.message || "Unknown";
  addLog(`[FATAL] Uncaught Exception: ${msg}`);
  botState.errors.push({ type: "uncaught", message: msg, time: Date.now() });

  // Cap errors array to prevent memory leak over long uptimes
  if (botState.errors.length > 100) {
    botState.errors = botState.errors.slice(-50);
  }

  const isNetworkError =
    msg.includes("PartialReadError") ||
    msg.includes("ECONNRESET") ||
    msg.includes("EPIPE") ||
    msg.includes("ETIMEDOUT") ||
    msg.includes("timed out") ||
    msg.includes("write after end") ||
    msg.includes("This socket has been ended");

  if (isNetworkError) {
    addLog("[FATAL] Known network/protocol error - recovering gracefully...");
  }

  // ALWAYS recover — bot must never stay disconnected
  clearAllIntervals();
  botState.connected = false;

  // FIX: reset isReconnecting if it was stuck, then schedule reconnect
  if (isReconnecting) {
    addLog(
      "[FATAL] isReconnecting was stuck - resetting before crash recovery",
    );
    isReconnecting = false;
    // BUG FIX: was referencing non-existent 'reconnectTimeout' — correct name is 'reconnectTimeoutId'
    if (reconnectTimeoutId) {
      clearTimeout(reconnectTimeoutId);
      reconnectTimeoutId = null;
    }
  }

  setTimeout(
    () => {
      scheduleReconnect();
    },
    isNetworkError ? 5000 : 10000,
  );
});

process.on("unhandledRejection", (reason) => {
  const msg = String(reason);
  addLog(`[FATAL] Unhandled Rejection: ${reason}`);
  botState.errors.push({ type: "rejection", message: msg, time: Date.now() });
  if (botState.errors.length > 100) {
    botState.errors = botState.errors.slice(-50);
  }

  const isNetworkError =
    msg.includes("ETIMEDOUT") ||
    msg.includes("ECONNRESET") ||
    msg.includes("EPIPE") ||
    msg.includes("ENOTFOUND") ||
    msg.includes("timed out") ||
    msg.includes("PartialReadError");

  if (isNetworkError && !isReconnecting) {
    addLog("[FATAL] Network rejection — triggering reconnect...");
    clearAllIntervals();
    botState.connected = false;
    if (bot) {
      try { bot.end(); } catch (_) {}
      bot = null;
    }
    scheduleReconnect();
  }
});

process.on("SIGTERM", () => {
  addLog("[System] SIGTERM received — exiting cleanly so workflow can restart.");
  process.exit(0);
});

process.on("SIGINT", () => {
  addLog("[System] SIGINT received — exiting cleanly so workflow can restart.");
  process.exit(0);
});

// =============================
//===============================
// START THE BOT
// ============================================================
addLog("=".repeat(50));
addLog("  Minecraft AFK Bot v2.5 - Bug-Fixed Edition");
addLog("=".repeat(50));
addLog(`Server: ${config.server.ip}:${config.server.port}`);
addLog(`Version: ${config.server.version}`);
addLog(
  `Auto-Reconnect: ${config.utils["auto-reconnect"] ? "Enabled" : "Disabled"}`,
);
addLog("=".repeat(50));

createBot();
