# Minecraft AFK Bot

A Mineflayer-based Minecraft bot that auto-joins an Aternos server to keep it online 24/7. Includes a web dashboard for status, logs, and controls.

## Stack
- **Runtime**: Node.js 20
- **Bot**: [mineflayer](https://github.com/PrismarineJS/mineflayer) + mineflayer-pathfinder
- **Server**: Express (dashboard on port 5000)

## How to run
```
npm start
```

The bot starts automatically and connects to the server configured in `settings.json`. The dashboard is available at the Replit preview URL.

## Configuration
All settings live in `settings.json`:
- `server.ip` / `server.port` — Minecraft server address
- `bot-account.username` — Bot's in-game name
- `utils.auto-auth.password` — Auth password for cracked servers
- `utils.anti-afk` / `movement` — Anti-AFK and movement options

## Entry points
- `index.js` — Main bot + Express server
- `leaveRejoin.js` — Leave/rejoin logic module
- `logger.js` — In-memory log buffer

## User preferences
- Keep existing project structure and settings.json as-is.
