// ============================================================
// Aternos Auto-Start Module
// Strategy: fire start command (ignore Puppeteer timeout),
// then poll getServerList every 15s until online (up to 6 min).
// ============================================================
const Aternos = require("aternos-unofficial-api");
const { addLog } = require("./logger");

const POLL_INTERVAL_MS  = 15 * 1000;      // poll status every 15s
const MAX_WAIT_MS       = 6 * 60 * 1000;  // wait up to 6 min for server to come up
const COOLDOWN_MS       = 30 * 1000;       // min gap between start attempts
const LOGIN_TIMEOUT_MS  = 30 * 1000;      // bail on login if it hangs >30s

let isStarting    = false;
let lastAttemptAt = 0;
let notifyDiscord = null;

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

// Race a promise against a timeout
function withTimeout(promise, ms, label) {
  return Promise.race([
    promise,
    new Promise((_, rej) => setTimeout(() => rej(new Error(`${label} timed out after ${ms}ms`)), ms)),
  ]);
}

// ── Login helper (with timeout) ───────────────────────────────────────────────
async function login(username, password) {
  return withTimeout(Aternos.loginToAternos(username, password), LOGIN_TIMEOUT_MS, "Aternos login");
}

// ── Get first server (with timeout) ──────────────────────────────────────────
async function getServer(cookies) {
  const { servers } = await withTimeout(
    Aternos.getServerList(cookies),
    LOGIN_TIMEOUT_MS,
    "Aternos getServerList"
  );
  return servers && servers.length ? servers[0] : null;
}

// ── Poll until status matches or timeout ─────────────────────────────────────
async function pollUntilOnline(username, password, maxWaitMs) {
  const deadline = Date.now() + maxWaitMs;
  while (Date.now() < deadline) {
    await sleep(POLL_INTERVAL_MS);
    try {
      const cookies = await login(username, password);
      const server  = await getServer(cookies);
      if (!server) continue;
      addLog(`[Aternos] Polling — status: ${server.status}`);
      if (server.status === "online") return true;
      if (server.status === "offline") {
        // Start was not received or failed; try again once
        addLog("[Aternos] Server still offline during poll — retrying start...");
        try {
          await withTimeout(
            Aternos.manageServer(cookies, server.id, "start"),
            20 * 1000,
            "retry start"
          );
        } catch (_) { /* ignore timeout on the puppeteer wait */ }
      }
    } catch (e) {
      addLog(`[Aternos] Poll error: ${e.message}`);
    }
  }
  return false;
}

// ── Main: check status and ensure server is online before connecting ──────────
async function checkAndEnsureOnline() {
  const username = process.env.ATERNOS_USERNAME;
  const password = process.env.ATERNOS_PASSWORD;

  if (!username || !password) {
    addLog("[Aternos] No credentials set — skipping status check.");
    return true;
  }

  // If a start is already in progress, wait for it to finish
  if (isStarting) {
    addLog("[Aternos] Start already in progress — waiting...");
    const deadline = Date.now() + MAX_WAIT_MS;
    while (isStarting && Date.now() < deadline) await sleep(5000);
    return true;
  }

  try {
    addLog("[Aternos] Checking server status...");
    const cookies = await login(username, password);
    const server  = await getServer(cookies);

    if (!server) {
      addLog("[Aternos] No servers found — connecting anyway.");
      return true;
    }

    addLog(`[Aternos] Found server: ${server.name} — status: ${server.status}`);

    if (server.status === "online") {
      addLog("[Aternos] Server is online — proceeding.");
      return true;
    }

    if (server.status === "starting") {
      addLog("[Aternos] Server is already starting — polling until online...");
      isStarting = true;
      const ok = await pollUntilOnline(username, password, MAX_WAIT_MS);
      isStarting = false;
      addLog(ok ? "[Aternos] ✅ Server is online!" : "[Aternos] ⚠️ Server did not come online in time — connecting anyway.");
      return true;
    }

    // Cooldown guard
    if (Date.now() - lastAttemptAt < COOLDOWN_MS) {
      addLog("[Aternos] Start cooldown active — connecting anyway (server may be starting).");
      return true;
    }

    // Server is offline — fire start command then poll
    isStarting    = true;
    lastAttemptAt = Date.now();

    addLog(`[Aternos] Server is ${server.status} — sending start command...`);
    if (notifyDiscord) notifyDiscord(`🔄 **Aternos server is ${server.status}** — starting it now...`);

    // Fire start — we intentionally ignore Puppeteer's internal wait (it times out).
    // We poll ourselves below so it doesn't matter if this call completes.
    withTimeout(
      Aternos.manageServer(cookies, server.id, "start"),
      20 * 1000,
      "start command"
    ).catch(() => {}); // fire-and-forget

    addLog(`[Aternos] Start command fired — polling every ${POLL_INTERVAL_MS / 1000}s (up to ${MAX_WAIT_MS / 60000} min)...`);
    if (notifyDiscord) notifyDiscord("⏳ **Start command sent** — waiting for server to come online...");

    const online = await pollUntilOnline(username, password, MAX_WAIT_MS);
    isStarting = false;

    if (online) {
      addLog("[Aternos] ✅ Server is online — connecting now!");
      if (notifyDiscord) notifyDiscord("✅ **Aternos server is online!** Bot is connecting...");
    } else {
      addLog("[Aternos] ⚠️ Server did not come online within 6 min — connecting anyway.");
      if (notifyDiscord) notifyDiscord("⚠️ **Server startup timed out** — attempting to connect anyway.");
    }
    return true;

  } catch (e) {
    addLog(`[Aternos] Error: ${e.message} — connecting anyway.`);
    isStarting = false;
    return true;
  }
}

// ── Dashboard: manual start ───────────────────────────────────────────────────
async function startServer() {
  const username = process.env.ATERNOS_USERNAME;
  const password = process.env.ATERNOS_PASSWORD;
  if (!username || !password) return { success: false, msg: "No Aternos credentials set." };
  if (isStarting) return { success: false, msg: "Server is already starting — please wait." };

  try {
    addLog("[Aternos] Manual start requested...");
    const cookies = await login(username, password);
    const server  = await getServer(cookies);
    if (!server) return { success: false, msg: "No servers found on account." };
    if (server.status === "online") return { success: false, msg: "Server is already online." };

    lastAttemptAt = Date.now();
    // Fire-and-forget; let Aternos handle it in the background
    withTimeout(
      Aternos.manageServer(cookies, server.id, "start"),
      20 * 1000,
      "manual start"
    ).catch(() => {});

    addLog("[Aternos] Manual start command fired.");
    if (notifyDiscord) notifyDiscord("▶️ **Aternos server start** triggered from dashboard.");
    return { success: true, msg: "Start command sent! Server should be online in 1–3 minutes." };
  } catch (e) {
    addLog(`[Aternos] Manual start error: ${e.message}`);
    return { success: false, msg: e.message };
  }
}

// ── Dashboard: manual stop ────────────────────────────────────────────────────
async function stopServer() {
  const username = process.env.ATERNOS_USERNAME;
  const password = process.env.ATERNOS_PASSWORD;
  if (!username || !password) return { success: false, msg: "No Aternos credentials set." };

  try {
    addLog("[Aternos] Manual stop requested...");
    const cookies = await login(username, password);
    const server  = await getServer(cookies);
    if (!server) return { success: false, msg: "No servers found on account." };
    if (server.status !== "online") return { success: false, msg: `Server is not online (status: ${server.status}).` };

    withTimeout(
      Aternos.manageServer(cookies, server.id, "stop"),
      20 * 1000,
      "manual stop"
    ).catch(() => {});

    addLog("[Aternos] Manual stop command fired.");
    if (notifyDiscord) notifyDiscord("⏹️ **Aternos server stop** triggered from dashboard.");
    return { success: true, msg: "Stop command sent! Server is shutting down." };
  } catch (e) {
    addLog(`[Aternos] Manual stop error: ${e.message}`);
    return { success: false, msg: e.message };
  }
}

function init(opts) {
  notifyDiscord = opts.notifyDiscord || null;
}

module.exports = { init, checkAndEnsureOnline, startServer, stopServer };
