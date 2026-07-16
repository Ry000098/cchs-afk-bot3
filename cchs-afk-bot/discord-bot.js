// ============================================================
// Discord Bot Module — Full featured with all channels + chat bridge
// ============================================================
const {
  Client,
  GatewayIntentBits,
  REST,
  Routes,
  SlashCommandBuilder,
  EmbedBuilder,
  ChannelType,
  ActivityType,
  PermissionFlagsBits,
} = require("discord.js");
const fs = require("fs");

const STATUS_UPDATE_INTERVAL_MS = 2 * 60 * 1000;
const CHANNELS_FILE = ".discord-channels.json";
const OWNER_ROLE_NAME  = "Owner";
const STAFF_ROLE_NAME  = "Staff";
const MEMBER_ROLE_NAME = "Member";
// Discord usernames to auto-assign the Owner role to (lowercase, both formats)
const OWNER_USERNAMES  = ["noa", "mr.bozo0", "mrbozo0"];

let client        = null;
let statusInterval = null;
let channels = {};
let serverStatusMessageId = null;
let playerStatusMessageId = null;
let botStatusMessageId    = null;
let serverInfoMessageId   = null;
let playtimeMessageId     = null;

// Shared references
let sharedState      = null;
let sharedConfig     = null;
let startBotFn       = null;
let stopBotFn        = null;
let addLog           = null;
let getPlayers       = null;
let sendToMinecraft  = null; // callback: (msg) => bot.chat(msg)
let getPlaytime      = null; // callback: () => playtimeMap

// ─── Channel definitions ──────────────────────────────────────────────────────
// Four separate Discord categories — order: Welcome → Server → Minecraft Server → Bot
const CATEGORIES = {
  welcome:   "🎉 Welcome",
  server:    "💬 Server",
  minecraft: "⛏️ Minecraft Server",
  bot:       "🤖 Bot",
};

// Old names for categories that were renamed — bot will find & rename them automatically
const CATEGORY_OLD_NAMES = {
  server:    ["🎮 Server"],
  minecraft: [],
  bot:       [],
};

// staffCanPost  → Owner + Staff can send
// memberCanPost → Owner + Staff + Member can send
// neither       → bot-only, everyone read-only
const CHANNEL_DEFS = [
  { key: "welcome",      category: "welcome",   name: "👋・welcome",        topic: "Welcome new members!",                    type: ChannelType.GuildText                      },
  { key: "announcements",category: "welcome",   name: "📢・announcements",  topic: "Server announcements — staff only",       type: ChannelType.GuildText, staffCanPost:  true  },
  { key: "rules",        category: "welcome",   name: "📜・rules",          topic: "Read before playing!",                    type: ChannelType.GuildText, staffCanPost:  true  },
  { key: "general",      category: "server",    name: "💬・general",        topic: "General chat",                            type: ChannelType.GuildText, memberCanPost: true  },
  { key: "serverStatus", category: "minecraft", name: "📡・server-status",  topic: "Live server & bot status — auto-updates", type: ChannelType.GuildText                      },
  { key: "playerStatus", category: "minecraft", name: "👥・player-status",  topic: "Who is currently online — auto-updates",  type: ChannelType.GuildText                      },
  { key: "botStatus",    category: "bot",       name: "🤖・bot-status",     topic: "AFK bot connection status — auto-updates", type: ChannelType.GuildText                      },
  { key: "botCommands",  category: "bot",       name: "⌨️・bot-commands",   topic: "Use slash commands here",                 type: ChannelType.GuildText, memberCanPost: true  },
];

// ─── Slash commands ───────────────────────────────────────────────────────────
const commands = [
  new SlashCommandBuilder().setName("status").setDescription("Show server & bot status"),
  new SlashCommandBuilder().setName("players").setDescription("Who is on the Minecraft server"),
  new SlashCommandBuilder().setName("start").setDescription("Start the AFK bot"),
  new SlashCommandBuilder().setName("stop").setDescription("Stop the AFK bot"),
  new SlashCommandBuilder().setName("leaderboard").setDescription("Show playtime leaderboard"),
  new SlashCommandBuilder()
    .setName("say")
    .setDescription("Send a message to in-game chat")
    .addStringOption(o => o.setName("message").setDescription("Message to send").setRequired(true)),
].map(c => c.toJSON());

// ─── Persist channel IDs ──────────────────────────────────────────────────────
function saveAll() {
  try {
    fs.writeFileSync(CHANNELS_FILE, JSON.stringify({ channels, serverStatusMessageId, playerStatusMessageId, botStatusMessageId, playtimeMessageId }, null, 2));
  } catch {}
}

function loadChannels() {
  try {
    if (fs.existsSync(CHANNELS_FILE)) {
      const d = JSON.parse(fs.readFileSync(CHANNELS_FILE, "utf8"));
      channels              = d.channels              || d;
      serverStatusMessageId = d.serverStatusMessageId || null;
      playerStatusMessageId = d.playerStatusMessageId || null;
      botStatusMessageId    = d.botStatusMessageId    || null;
      playtimeMessageId     = d.playtimeMessageId     || null;
    }
  } catch {}
}

// ─── Permission helper ────────────────────────────────────────────────────────
function buildChannelPermissions(def, everyoneRole, ownerRole, staffRole, memberRole) {
  const overwrites = [
    // @everyone: can read but never send
    {
      id:    everyoneRole.id,
      allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.ReadMessageHistory],
      deny:  [PermissionFlagsBits.SendMessages],
    },
    // Owner: full control everywhere
    {
      id:    ownerRole.id,
      allow: [
        PermissionFlagsBits.ViewChannel,
        PermissionFlagsBits.ReadMessageHistory,
        PermissionFlagsBits.SendMessages,
        PermissionFlagsBits.ManageMessages,
        PermissionFlagsBits.ManageChannels,
      ],
    },
  ];

  if (def.staffCanPost) {
    // Staff + Owner can post in announcements / rules
    overwrites.push({
      id:    staffRole.id,
      allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.ReadMessageHistory, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ManageMessages],
    });
  }

  if (def.memberCanPost) {
    // Members (and Staff) can post in general / coordinates
    overwrites.push({
      id:    staffRole.id,
      allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.ReadMessageHistory, PermissionFlagsBits.SendMessages],
    });
    overwrites.push({
      id:    memberRole.id,
      allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.ReadMessageHistory, PermissionFlagsBits.SendMessages],
    });
  }

  return overwrites;
}

// ─── Auto-create categories + channels ───────────────────────────────────────
async function ensureChannels(guild, roles) {
  loadChannels();

  const { ownerRole, staffRole, memberRole } = roles;
  const everyoneRole = guild.roles.everyone;

  // Ensure all four categories exist, auto-rename old names, set positions
  const CATEGORY_POSITIONS = { welcome: 0, server: 1, minecraft: 2, bot: 3 };
  const categoryObjs = {};
  for (const [key, name] of Object.entries(CATEGORIES)) {
    let cat = guild.channels.cache.find(c => c.type === ChannelType.GuildCategory && c.name === name);
    if (!cat) {
      // Check if it exists under an old name and rename it instead of creating a duplicate
      const oldNames = CATEGORY_OLD_NAMES[key] || [];
      const legacy = guild.channels.cache.find(c => c.type === ChannelType.GuildCategory && oldNames.includes(c.name));
      if (legacy) {
        try { await legacy.setName(name); } catch {}
        cat = legacy;
        if (addLog) addLog(`[Discord Bot] Renamed category → ${name}`);
      } else {
        cat = await guild.channels.create({ name, type: ChannelType.GuildCategory });
        if (addLog) addLog(`[Discord Bot] Created category: ${name}`);
      }
    }
    try { await cat.setPosition(CATEGORY_POSITIONS[key]); } catch {}
    categoryObjs[key] = cat;
  }

  for (const def of CHANNEL_DEFS) {
    const cat   = categoryObjs[def.category];
    const perms = buildChannelPermissions(def, everyoneRole, ownerRole, staffRole, memberRole);

    // Resolve existing channel by saved ID, then fall back to name scan (strips emoji for match)
    let ch = null;
    if (channels[def.key]) {
      try { ch = await client.channels.fetch(channels[def.key]); } catch {}
    }
    if (!ch) {
      const baseName = def.name.replace(/^[^\w]+/u, "").replace(/^・/, ""); // strip leading emoji/separator
      const found = guild.channels.cache.find(c =>
        c.type === def.type && (c.name === def.name || c.name === baseName || c.name.endsWith(baseName))
      );
      if (found) { channels[def.key] = found.id; ch = found; }
    }

    if (ch) {
      // Rename (add emoji), move to correct category, sync permissions
      try {
        if (ch.name !== def.name) await ch.setName(def.name);
        if (ch.parentId !== cat.id) await ch.setParent(cat.id, { lockPermissions: false });
        await ch.permissionOverwrites.set(perms);
      } catch {}
      continue;
    }

    // Create brand-new channel
    const created = await guild.channels.create({
      name: def.name,
      type: def.type,
      parent: cat.id,
      topic: def.topic,
      permissionOverwrites: perms,
    });
    channels[def.key] = created.id;
    if (addLog) addLog(`[Discord Bot] Created #${def.name}`);
    if (def.key === "rules") await postDefaultRules(created);
  }

  saveAll();
}

// ─── Default rules message ────────────────────────────────────────────────────
async function postDefaultRules(channel) {
  const embed = new EmbedBuilder()
    .setTitle("📜 Server Rules")
    .setColor(0x5865f2)
    .setDescription(
      "**1.** Be respectful to all players\n" +
      "**2.** No griefing or stealing\n" +
      "**3.** No hacking, cheating, or exploiting\n" +
      "**4.** No spamming in chat\n" +
      "**5.** Listen to staff\n" +
      "**6.** Have fun! 🎮\n\n" +
      "*Breaking rules may result in a kick or ban.*"
    )
    .setFooter({ text: "Last updated" })
    .setTimestamp();
  try { await channel.send({ embeds: [embed] }); } catch {}
}

// ─── Role management ─────────────────────────────────────────────────────────
async function ensureRoles(guild) {
  const create = async (name, opts) => {
    let role = guild.roles.cache.find(r => r.name === name);
    if (!role) {
      role = await guild.roles.create({ name, reason: "Auto-created by AFK bot", ...opts });
      if (addLog) addLog(`[Discord Bot] Created role: ${name}`);
    }
    return role;
  };

  const ownerRole  = await create(OWNER_ROLE_NAME,  { color: 0xffd700, hoist: true  });
  const staffRole  = await create(STAFF_ROLE_NAME,  { color: 0x5865f2, hoist: true  });
  const memberRole = await create(MEMBER_ROLE_NAME, { color: 0x4ade80, hoist: false });
  return { ownerRole, staffRole, memberRole };
}

async function assignOwnerRole(guild, ownerRole) {
  try {
    const members = await guild.members.fetch();
    for (const [, m] of members) {
      const uname = m.user.username.toLowerCase();
      const dname = m.displayName.toLowerCase();
      if (OWNER_USERNAMES.some(n => uname === n || dname === n || uname.includes(n))) {
        if (!m.roles.cache.has(ownerRole.id)) {
          await m.roles.add(ownerRole);
          if (addLog) addLog(`[Discord Bot] Assigned Owner role to ${m.user.username}`);
        }
      }
    }
  } catch (e) {
    if (addLog) addLog(`[Discord Bot] Owner assign error: ${e.message}`);
  }
}

async function onMemberJoin(member) {
  // Assign Member role
  try {
    const { memberRole } = await ensureRoles(member.guild);
    await member.roles.add(memberRole);
  } catch (e) {
    if (addLog) addLog(`[Discord Bot] Role assign error: ${e.message}`);
  }

  // Welcome message
  if (!channels.welcome) return;
  try {
    const ch = await client.channels.fetch(channels.welcome);
    const embed = new EmbedBuilder()
      .setColor(0x4ade80)
      .setTitle(`👋 Welcome ${member.user.username}!`)
      .setDescription(`**${member.user.username}** just joined the server. Say hello! 🎉`)
      .setThumbnail(member.user.displayAvatarURL({ dynamic: true }))
      .setTimestamp();
    await ch.send({ embeds: [embed] });
  } catch (e) {
    if (addLog) addLog(`[Discord Bot] Welcome message error: ${e.message}`);
  }
}

// ─── Embed builders ───────────────────────────────────────────────────────────
function buildServerStatusEmbed() {
  const online = sharedState && sharedState.connected;
  const ip = sharedConfig?.server?.ip || "Unknown";
  return new EmbedBuilder()
    .setTitle("📡 Server Status")
    .setColor(online ? 0x4ade80 : 0xf87171)
    .addFields(
      { name: "Minecraft Server", value: online ? "🟢 **Online**"      : "🔴 **Offline**",      inline: true },
      { name: "AFK Bot",          value: online ? "🤖 **Connected**"   : "⚫ **Disconnected**", inline: true },
      { name: "Address",          value: `\`${ip}\``,                                           inline: true }
    )
    .setFooter({ text: "Last updated" })
    .setTimestamp();
}

function buildPlayerStatusEmbed() {
  const players = getPlayers ? getPlayers() : [];
  const humans  = players.filter(p => !p.isBot);
  const botP    = players.find(p => p.isBot);
  const lines   = [];
  if (botP) lines.push(`🤖 **${botP.name}** *(AFK Bot)*`);
  humans.forEach(p => lines.push(`🧑 ${p.name}`));
  return new EmbedBuilder()
    .setTitle("👥 Players Online")
    .setColor(humans.length ? 0x4ade80 : 0x5865f2)
    .setDescription(lines.length ? lines.join("\n") : "_No one online right now_")
    .addFields({ name: "Player Count", value: `${humans.length}`, inline: true })
    .setFooter({ text: "Last updated" })
    .setTimestamp();
}

function buildBotStatusEmbed() {
  const connected = sharedState && sharedState.connected;
  return new EmbedBuilder()
    .setTitle("🤖 AFK Bot Status")
    .setColor(connected ? 0x4ade80 : 0xf87171)
    .addFields(
      { name: "Bot",      value: connected ? "🟢 **Connected**"    : "🔴 **Disconnected**", inline: true },
      { name: "Commands", value: "Use `/status`, `/players`, `/start`, `/stop`",             inline: false },
    )
    .setFooter({ text: "Last updated" })
    .setTimestamp();
}

function buildLeaderboardEmbed() {
  const pt = getPlaytime ? getPlaytime() : {};
  const entries = Object.entries(pt)
    .map(([name, data]) => ({ name, total: data.total + (data.joinedAt ? Date.now() - data.joinedAt : 0) }))
    .sort((a, b) => b.total - a.total)
    .slice(0, 10);

  const medals = ["🥇", "🥈", "🥉"];
  const lines = entries.length
    ? entries.map((e, i) => `${medals[i] || `**${i + 1}.**`} **${e.name}** — ${formatPlaytime(e.total)}`)
    : ["_No playtime recorded yet_"];

  return new EmbedBuilder()
    .setTitle("🏆 Playtime Leaderboard")
    .setColor(0xf59e0b)
    .setDescription(lines.join("\n"))
    .setFooter({ text: "Time spent on the server" })
    .setTimestamp();
}

function formatPlaytime(ms) {
  const h = Math.floor(ms / 3600000);
  const m = Math.floor((ms % 3600000) / 60000);
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

// ─── Live status updaters ─────────────────────────────────────────────────────
async function editOrPost(channelId, messageIdRef, embedFn, setId) {
  if (!client || !channelId) return;
  try {
    const ch = await client.channels.fetch(channelId);
    const embed = embedFn();
    if (messageIdRef) {
      try {
        const msg = await ch.messages.fetch(messageIdRef);
        await msg.edit({ embeds: [embed] });
        return;
      } catch { setId(null); }
    }
    const msg = await ch.send({ embeds: [embed] });
    setId(msg.id);
    saveAll();
  } catch (e) {
    if (addLog) addLog(`[Discord Bot] Update error: ${e.message}`);
  }
}

async function updateServerStatus() {
  await editOrPost(
    channels.serverStatus,
    serverStatusMessageId,
    buildServerStatusEmbed,
    id => { serverStatusMessageId = id; }
  );
}

async function updatePlayerStatus() {
  await editOrPost(
    channels.playerStatus,
    playerStatusMessageId,
    buildPlayerStatusEmbed,
    id => { playerStatusMessageId = id; }
  );
}

async function updateBotStatus() {
  await editOrPost(
    channels.botStatus,
    botStatusMessageId,
    buildBotStatusEmbed,
    id => { botStatusMessageId = id; }
  );
}

async function updateAllStatus() {
  await Promise.all([updateServerStatus(), updatePlayerStatus(), updateBotStatus()]);
}

// ─── Chat bridge: Discord #general → Minecraft ────────────────────────────────
async function handleGeneralMessage(message) {
  if (message.author.bot) return;
  if (!channels.general || message.channel.id !== channels.general) return;
  if (!sendToMinecraft) return;
  try {
    const text = `[Discord] ${message.author.username}: ${message.content}`.slice(0, 256);
    sendToMinecraft(text);
  } catch (e) {
    if (addLog) addLog(`[Discord Bot] Chat bridge error: ${e.message}`);
  }
}

// ─── Event notifications ──────────────────────────────────────────────────────
async function postToChannel(key, embed) {
  if (!client || !channels[key]) return;
  try {
    const ch = await client.channels.fetch(channels[key]);
    await ch.send({ embeds: [embed] });
  } catch (e) {
    if (addLog) addLog(`[Discord Bot] Post error (${key}): ${e.message}`);
  }
}

async function notifyPlayerJoin(playerName) {
  await updateAllStatus();
}

async function notifyPlayerLeave(playerName) {
  await updateAllStatus();
}

async function notifyBotConnect() {
  await updateAllStatus();
}

async function notifyBotDisconnect(reason) {
  await updateAllStatus();
}

async function notifyPlayerDeath(deathMessage) {
  await postToChannel("deaths", new EmbedBuilder()
    .setColor(0x1f1f1f)
    .setDescription(`💀 ${deathMessage}`)
    .setTimestamp()
  );
}

// ─── Death milestones ─────────────────────────────────────────────────────────
const DEATH_MILESTONES = [
  { count: 1,   title: "First Blood 🩸",              desc: "Their first death. It begins."                    },
  { count: 10,  title: "Serial Dier 💀",              desc: "10 deaths. Dying is becoming a habit."            },
  { count: 25,  title: "Frequent Flyer ✈️",           desc: "25 deaths. At least you keep coming back."       },
  { count: 50,  title: "You Could At Least Try 🤦",  desc: "50 deaths. Incredible. Truly."                    },
  { count: 100, title: "Unstoppable (at dying) 🏆",  desc: "100 deaths. A legend in the worst way possible."  },
];

async function notifyDeathMilestone(username, deathCount) {
  const milestone = DEATH_MILESTONES.find(m => m.count === deathCount);
  if (!milestone) return;
  await postToChannel("achievements", new EmbedBuilder()
    .setColor(0xff4444)
    .setTitle(`🎖️ Achievement Unlocked — ${milestone.title}`)
    .setDescription(`**${username}** has died **${deathCount}** time${deathCount === 1 ? "" : "s"}.\n_${milestone.desc}_`)
    .setTimestamp()
  );
}

async function notifyMinecraftChat(username, message) {
  if (!client || !channels.general) return;
  try {
    const ch = await client.channels.fetch(channels.general);
    await ch.send(`🎮 **${username}**: ${message}`);
  } catch {}
}

// ─── Slash command handler ────────────────────────────────────────────────────
async function handleInteraction(interaction) {
  if (!interaction.isChatInputCommand()) return;
  const { commandName } = interaction;

  if (commandName === "status") {
    await interaction.reply({ embeds: [buildServerStatusEmbed()], ephemeral: false });
  } else if (commandName === "players") {
    await interaction.reply({ embeds: [buildPlayerStatusEmbed()], ephemeral: false });
  } else if (commandName === "leaderboard") {
    await interaction.reply({ embeds: [buildLeaderboardEmbed()], ephemeral: false });
  } else if (commandName === "say") {
    const msg = interaction.options.getString("message");
    if (!sendToMinecraft) {
      await interaction.reply({ content: "⚠️ Bot is not connected.", ephemeral: true });
    } else {
      sendToMinecraft(`[Discord] ${interaction.user.username}: ${msg}`);
      await interaction.reply({ content: `✅ Sent: **${msg}**`, ephemeral: false });
    }
  } else if (commandName === "start") {
    if (sharedState && sharedState.connected) {
      await interaction.reply({ content: "⚠️ Bot is already running!", ephemeral: true });
    } else {
      if (startBotFn) startBotFn();
      await interaction.reply({ content: "✅ Bot started!", ephemeral: false });
    }
  } else if (commandName === "stop") {
    if (sharedState && !sharedState.connected) {
      await interaction.reply({ content: "⚠️ Bot is already stopped!", ephemeral: true });
    } else {
      if (stopBotFn) stopBotFn();
      await interaction.reply({ content: "⏹️ Bot stopped.", ephemeral: false });
    }
  }
}

// ─── Init ─────────────────────────────────────────────────────────────────────
async function init(opts) {
  const token    = process.env.DISCORD_BOT_TOKEN;
  const clientId = process.env.DISCORD_CLIENT_ID;

  if (!token || !clientId) {
    if (opts.addLog) opts.addLog("[Discord Bot] DISCORD_BOT_TOKEN or DISCORD_CLIENT_ID not set — skipping");
    return null;
  }

  sharedState     = opts.botState;
  sharedConfig    = opts.config;
  startBotFn      = opts.start;
  stopBotFn       = opts.stop;
  addLog          = opts.addLog;
  getPlayers      = opts.getPlayers;
  sendToMinecraft = opts.sendToMinecraft || null;
  getPlaytime     = opts.getPlaytime     || null;

  try {
    const rest = new REST({ version: "10" }).setToken(token);
    await rest.put(Routes.applicationCommands(clientId), { body: commands });
    if (addLog) addLog("[Discord Bot] Slash commands registered");
  } catch (e) {
    if (addLog) addLog(`[Discord Bot] Command registration failed: ${e.message}`);
  }

  client = new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMessages,
      GatewayIntentBits.GuildMembers,
      GatewayIntentBits.MessageContent,
    ],
  });

  async function setupGuild(guild) {
    if (addLog) addLog(`[Discord Bot] Setting up server: ${guild.name}`);
    const roles = await ensureRoles(guild);
    await assignOwnerRole(guild, roles.ownerRole);
    await ensureChannels(guild, roles);
    await updateAllStatus();
    if (!statusInterval) {
      statusInterval = setInterval(updateAllStatus, STATUS_UPDATE_INTERVAL_MS);
    }
  }

  client.on("clientReady", async () => {
    if (addLog) addLog(`[Discord Bot] Logged in as ${client.user.tag}`);
    client.user.setActivity("Minecraft AFK Bot", { type: ActivityType.Watching });
    try {
      const guilds = await client.guilds.fetch();
      if (addLog) addLog(`[Discord Bot] Found ${guilds.size} server(s)`);
      for (const [, g] of guilds) {
        const guild = await client.guilds.fetch(g.id);
        await setupGuild(guild);
      }
    } catch (e) {
      if (addLog) addLog(`[Discord Bot] Guild fetch error: ${e.message}`);
    }
  });

  client.on("guildCreate", async (guild) => {
    if (addLog) addLog(`[Discord Bot] Joined server: ${guild.name}`);
    await setupGuild(guild);
  });

  client.on("guildMemberAdd", onMemberJoin);

  client.on("messageCreate", async (message) => {
    // Chat bridge
    await handleGeneralMessage(message);
    // Delete system join messages
    try {
      if ([8, 32, 33].includes(message.type) && message.deletable) await message.delete();
    } catch {}
  });

  client.on("interactionCreate", handleInteraction);
  client.on("error", e => { if (addLog) addLog(`[Discord Bot] Error: ${e.message}`); });

  await client.login(token);
  return client;
}

module.exports = {
  init,
  notifyPlayerJoin,
  notifyPlayerLeave,
  notifyBotConnect,
  notifyBotDisconnect,
  notifyPlayerDeath,
  notifyDeathMilestone,
  notifyMinecraftChat,
};
