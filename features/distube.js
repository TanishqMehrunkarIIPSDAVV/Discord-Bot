const path = require("node:path");
const fs = require("node:fs");
const { execFileSync, spawnSync } = require("node:child_process");
const client = require(`${path.dirname(__dirname)}/index.js`);
const { DisTube } = require("distube");
const { SpotifyPlugin } = require("@distube/spotify");
const { YtDlpPlugin, json: ytDlpJson } = require("@distube/yt-dlp");
const { PermissionFlagsBits, ChannelType } = require("discord.js");
const { getVoiceConnection, VoiceConnectionStatus } = require("@discordjs/voice");
const ffmpegPath = require("ffmpeg-static");

const YOUTUBE_HOSTS = new Set([
  "youtube.com",
  "www.youtube.com",
  "m.youtube.com",
  "music.youtube.com",
  "youtu.be",
  "www.youtu.be",
]);

const YTDLP_COOKIES_PATH = process.env.YTDLP_COOKIES_PATH || "/app/cookies.txt";

// ==================== FFmpeg Path Resolution ====================
// Resolve ffmpeg path for cross-platform compatibility
const getFFmpegPath = () => {
  const canRunFFmpeg = (candidatePath) => {
    try {
      if (!candidatePath || !fs.existsSync(candidatePath)) return false;

      // Hosted Linux can mount files without execute bit even when present.
      if (process.platform !== "win32") {
        try {
          fs.chmodSync(candidatePath, 0o755);
        } catch {}
      }

      const probe = spawnSync(candidatePath, ["-version"], {
        stdio: "pipe",
        windowsHide: true,
      });
      return probe.status === 0;
    } catch {
      return false;
    }
  };

  // 1. Prefer system ffmpeg in hosted Linux environments.
  const commonPaths = [
    "/usr/bin/ffmpeg",
    "/usr/local/bin/ffmpeg",
    "/bin/ffmpeg",
  ];

  for (const checkPath of commonPaths) {
    if (canRunFFmpeg(checkPath)) {
      console.log(`[FFmpeg] Found at: ${checkPath}`);
      return checkPath;
    }
  }

  // 2. Try to find ffmpeg in PATH using which/command
  try {
    let result;
    if (process.platform === "win32") {
      result = execFileSync("where", ["ffmpeg"], { encoding: "utf8" }).trim().split("\n")[0];
    } else {
      result = require("child_process").execSync("which ffmpeg", { encoding: "utf8" }).trim();
    }
    if (result && canRunFFmpeg(result)) {
      console.log(`[FFmpeg] Found in PATH: ${result}`);
      return result;
    }
  } catch {
    console.log(`[FFmpeg] Not found in PATH`);
  }

  // 3. Try to use ffmpeg-static only if executable.
  try {
    if (ffmpegPath) {
      if (canRunFFmpeg(ffmpegPath)) {
        console.log(`[FFmpeg] Found ffmpeg-static at: ${ffmpegPath}`);
        return ffmpegPath;
      }
      console.log(`[FFmpeg] ffmpeg-static found but not executable: ${ffmpegPath}`);
    }
  } catch (e) {
    console.log(`[FFmpeg] Error checking ffmpeg-static: ${e.message}`);
  }

  // 4. Windows: Try to get short path from ffmpeg-static (avoids spaces issue)
  if (process.platform === "win32" && ffmpegPath) {
    try {
      const shortPath = execFileSync(
        "cmd.exe",
        ["/d", "/s", "/c", `for %I in ("${ffmpegPath}") do @echo %~sI`],
        { encoding: "utf8", windowsHide: true }
      ).trim();
      if (shortPath && canRunFFmpeg(shortPath)) return shortPath;
    } catch {}

    // Fallback: copy to path without spaces
    try {
      const noSpaceDir = path.join(path.parse(process.cwd()).root, "ctbot-bin");
      const noSpacePath = path.join(noSpaceDir, "ffmpeg.exe");
      if (!fs.existsSync(noSpaceDir)) fs.mkdirSync(noSpaceDir, { recursive: true });
      if (!fs.existsSync(noSpacePath)) fs.copyFileSync(ffmpegPath, noSpacePath);
      if (canRunFFmpeg(noSpacePath)) return noSpacePath;
    } catch {}
  }

  // 5. Final fallback: return bare "ffmpeg" command and let system find it
  console.log(`[FFmpeg] Warning: Could not resolve ffmpeg path. Falling back to bare 'ffmpeg' command. This may fail on hosted sites without ffmpeg installed.`);
  return "ffmpeg";
};

// ==================== Voice Connection Management ====================
const getVoiceConnections = (guildId) => {
  const defaultConn = getVoiceConnection(guildId);
  const distubeConn = client.user?.id ? getVoiceConnection(guildId, client.user.id) : null;
  return { defaultConn, distubeConn };
};

// Debug voice connection state changes
const setupConnectionDebug = (connection, guildId) => {
  if (!connection) return;
  
  console.log(`[Voice] Creating connection for guild ${guildId}`);
  
  connection.on(VoiceConnectionStatus.Signalling, () => {
    console.log(`[Voice] ${guildId}: Signalling...`);
  });
  
  connection.on(VoiceConnectionStatus.Connecting, () => {
    console.log(`[Voice] ${guildId}: Connecting...`);
  });
  
  connection.on(VoiceConnectionStatus.Ready, () => {
    console.log(`[Voice] ${guildId}: Ready!`);
  });
  
  connection.on(VoiceConnectionStatus.Disconnected, () => {
    console.log(`[Voice] ${guildId}: Disconnected`);
  });
  
  connection.on(VoiceConnectionStatus.Destroyed, () => {
    console.log(`[Voice] ${guildId}: Destroyed`);
  });
};

const clearStaleVoiceConnection = (guildId) => {
  console.log(`[Voice] Clearing stale connections for guild ${guildId}`);
  const { defaultConn, distubeConn } = getVoiceConnections(guildId);

  for (const connection of [defaultConn, distubeConn]) {
    if (!connection) continue;
    
    const status = connection.state?.status;
    console.log(`[Voice] Connection status: ${status}`);
    
    const isStale =
      status === VoiceConnectionStatus.Disconnected ||
      status === VoiceConnectionStatus.Destroyed ||
      status === VoiceConnectionStatus.Signalling ||
      status === VoiceConnectionStatus.Connecting;

    if (isStale) {
      try {
        console.log(`[Voice] Destroying stale connection with status: ${status}`);
        connection.destroy();
      } catch (err) {
        console.error(`[Voice] Error destroying connection:`, err.message);
      }
    }
  }

  // Clean DisTube voice manager state
  try {
    distube.voices.leave(guildId);
  } catch (err) {
    console.error(`[Voice] Error leaving via DisTube:`, err.message);
  }
};

// ==================== Permission & Channel Validation ====================
const checkVoicePermissions = (message, channel) => {
  if (!message.guild || !channel) {
    return "You must be in a server voice channel.";
  }

  const botMember = message.guild.members.me;
  if (!botMember) {
    return "Bot member is not available. Try again in a moment.";
  }

  const perms = channel.permissionsFor(botMember);
  if (!perms) {
    return "Cannot read permissions for that voice channel.";
  }

  const required = [
    PermissionFlagsBits.ViewChannel,
    PermissionFlagsBits.Connect,
    PermissionFlagsBits.Speak,
  ];

  const missing = required.filter((p) => !perms.has(p));
  if (missing.length > 0) {
    return `Missing permissions: ViewChannel, Connect, or Speak`;
  }

  const botChannelId = botMember.voice?.channelId;
  const botAlreadyInTargetChannel = botChannelId === channel.id;

  if (channel.full && !botAlreadyInTargetChannel) {
    return "That voice channel is full.";
  }

  if (channel.type === ChannelType.GuildStageVoice) {
    return "Stage channels are not supported. Join a normal voice channel.";
  }

  return null;
};

// ==================== Initialize DisTube ====================
const distube = new DisTube(client, {
  ffmpeg: {
    path: getFFmpegPath(),
  },
  plugins: [
    new SpotifyPlugin(),
    new YtDlpPlugin({
      update: true,
      args: ["--cookies", YTDLP_COOKIES_PATH],
    }),
  ],
  emitNewSongOnly: false,
  emitAddSongWhenCreatingQueue: true,
  emitAddListWhenCreatingQueue: true,
});

const isUrl = (value) => {
  try {
    new URL(value);
    return true;
  } catch {
    return false;
  }
};

const isYouTubeUrl = (value) => {
  if (!isUrl(value)) return false;
  const { hostname } = new URL(value);
  return YOUTUBE_HOSTS.has(hostname.toLowerCase());
};

const cleanSearchQuery = (value) =>
  value
    .replace(/\s*\[[^\]]*\]\s*/g, " ")
    .replace(/\s*\([^)]*\)\s*/g, " ")
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

const getSpotifyQuery = async (url) => {
  try {
    const response = await fetch(`https://open.spotify.com/oembed?url=${encodeURIComponent(url)}`);
    if (!response.ok) return null;
    const data = await response.json();
    const title = typeof data?.title === "string" ? data.title : "";
    const author = typeof data?.author_name === "string" ? data.author_name : "";
    const combined = `${title} ${author}`.trim();
    return combined || null;
  } catch {
    return null;
  }
};

const deriveQueryFromUrl = (url) => {
  try {
    const parsed = new URL(url);
    const pathParts = parsed.pathname.split("/").filter(Boolean);
    const slug = pathParts[pathParts.length - 1] || "";
    const decoded = decodeURIComponent(slug).replace(/\.[a-z0-9]+$/i, "");
    return cleanSearchQuery(decoded) || null;
  } catch {
    return null;
  }
};

const buildYouTubeSearchCandidates = (query) => {
  const q = cleanSearchQuery(query);
  if (!q) return [];

  return [
    `ytsearch1:${q}`,
    `ytsearch5:${q}`,
    `ytsearch1:${q} official audio`,
    `ytsearch1:${q} lyrics`,
  ];
};

const resolveSearchCandidateToUrl = async (candidate) => {
  if (!candidate || !candidate.startsWith("ytsearch")) {
    return candidate;
  }

  try {
    // Build options for yt-dlp - just get the metadata, let DisTube handle formats
    const ytDlpOptions = {
      dumpSingleJson: true,
      noWarnings: true,
      skipDownload: true,
      ignoreErrors: true,
    };

    // Try to add cookies if file exists
    const cookiesPath = path.join(__dirname, "..", "youtube_cookies.txt");
    if (fs.existsSync(cookiesPath)) {
      console.log(`[DisTube] Using cookies file: ${cookiesPath}`);
      ytDlpOptions.cookies = cookiesPath;
    } else {
      console.log(`[DisTube] Cookies file not found at ${cookiesPath}, proceeding without cookies`);
    }

    const info = await ytDlpJson(candidate, ytDlpOptions);

    // Check if search returned valid results
    if (!info) {
      throw new Error("No response from yt-dlp search.");
    }

    // Find first non-null entry with a valid ID
    let firstEntry = null;
    if (Array.isArray(info?.entries)) {
      firstEntry = info.entries.find((entry) => entry && entry.id);
    }
    
    // If no valid entry found, search had no results
    if (!firstEntry && !info?.id) {
      throw new Error("YouTube search returned no results.");
    }

    // Prefer the found entry, fall back to info object
    const entry = firstEntry || info;
    const videoId = entry?.id;

    if (!videoId) {
      throw new Error("Could not extract video ID from search results.");
    }

    // Construct YouTube watch URL - simple and always works
    const youtubeUrl = `https://www.youtube.com/watch?v=${videoId}`;
    console.log(`[DisTube] Resolved search to: ${youtubeUrl}`);
    return youtubeUrl;
  } catch (err) {
    // Log the detailed error but throw a generic one for candidates to skip
    const errorMsg = err.message || String(err);
    if (errorMsg.includes("Sign in to confirm") || errorMsg.includes("cookies") || errorMsg.includes("authentication")) {
      console.warn(`[DisTube] YouTube auth required for: ${candidate}`);
      console.warn(`[DisTube] Error details: ${errorMsg.substring(0, 200)}`);
      throw new Error("YouTube signature verification required - skipping this candidate.");
    }
    if (errorMsg.includes("no results")) {
      console.warn(`[DisTube] No search results for: ${candidate}`);
      throw new Error("No search results found - skipping this candidate.");
    }
    throw err;
  }
};

const resolveToYouTubeInput = async (input) => {
  const trimmed = String(input || "").trim();
  if (!trimmed) {
    throw new Error("Song name or URL is required.");
  }

  if (isYouTubeUrl(trimmed)) {
    return { url: trimmed, converted: false, source: "youtube-url" };
  }

  if (isUrl(trimmed)) {
    const host = new URL(trimmed).hostname.toLowerCase();
    let query = null;

    if (host.includes("spotify.com")) {
      query = await getSpotifyQuery(trimmed);
    }

    if (!query) {
      query = deriveQueryFromUrl(trimmed);
    }

    if (!query) {
      throw new Error("Couldn't extract a searchable title from that URL.");
    }

    return {
      url: `spsearch:${query}`,
      converted: true,
      source: "spotify-url",
      query,
      title: query,
    };
  }

  // Plain text search is no longer supported
  throw new Error(
    `❌ Search functionality is disabled.\n\n` +
    `✅ **Supported formats:**\n` +
    `• **YouTube URLs:** \`ct play https://youtu.be/dQw4w9WgXcQ\`\n` +
    `• **Spotify URLs:** \`ct play https://open.spotify.com/track/...\`\n\n` +
    `📝 Only direct links work. No text search.`
  );
};

// ==================== Play with Retry Logic ====================
const playWithRetry = async (channel, input, message) => {
  // No more search candidates - just use the direct URL
  const playUrl = input?.url || String(input);
  const existingQueue = distube.getQueue(message.guild.id);

  console.log(`[DisTube] Play request: ${playUrl.substring(0, 50)}...`);
  console.log(`[DisTube] Existing queue: ${existingQueue ? 'yes' : 'no'}`);
  
  // Only clear stale connections when starting fresh
  if (!existingQueue) {
    clearStaleVoiceConnection(message.guild.id);
    // Give a moment for cleanup
    await new Promise((resolve) => setTimeout(resolve, 500));
  }

  const maxRetries = 2;
  let lastError = null;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      console.log(`[DisTube] Play attempt ${attempt}/${maxRetries}`);

      const voice = distube.voices.get(message.guild.id);
      if (voice) {
        setupConnectionDebug(voice.connection, message.guild.id);
      }

      await distube.play(channel, playUrl, {
        message,
        textChannel: message.channel,
        member: message.member,
      });

      console.log(`[DisTube] Play successful on attempt ${attempt}`);
      return;
    } catch (err) {
      lastError = err;
      console.error(`[DisTube] Attempt ${attempt} failed:`, err.message);

      if (err?.name === "DisTubeError" && err?.errorCode === "VOICE_CONNECT_FAILED") {
        if (attempt < maxRetries) {
          console.log(`[DisTube] Voice connection failed, retrying...`);
          clearStaleVoiceConnection(message.guild.id);
          await new Promise((resolve) => setTimeout(resolve, 2000));
          continue;
        }
      }

      throw err;
    }
  }

  throw lastError;
};

// ==================== Command Handler ====================
const distubeFunc = () => {
  client.on("messageCreate", async (message) => {
    if (message.author.bot) return;
    if (!message.content.startsWith("ct")) return;

    const args = message.content.slice(2).trim().split(/ +/g);
    const command = args.shift();
    const channel = message.member?.voice?.channel;

    const musicCommands = [
      "play", "stop", "pause", "resume", "repeat", 
      "shuffle", "skip", "queue", "volume", "disconnect"
    ];

    // Require voice channel for music commands
    if (musicCommands.includes(command) && !channel) {
      return message.channel.send("❌ You are not connected to a voice channel!");
    }

    // Check permissions before doing anything
    if (musicCommands.includes(command) && command !== "disconnect") {
      const permIssue = checkVoicePermissions(message, channel);
      if (permIssue) {
        return message.channel.send(`❌ ${permIssue}`);
      }
    }

    // ==================== Commands ====================
    try {
      switch (command) {
        case "play": {
          const input = args.join(" ");
          if (!input) {
            return message.channel.send("❌ Please provide a YouTube or Spotify URL");
          }

          const resolved = await resolveToYouTubeInput(input);

          if (resolved.converted && resolved.source === "spotify-url") {
            message.channel.send(`🔎 Converted Spotify to search: **${resolved.title || resolved.query}**`);
          }

          await playWithRetry(channel, resolved, message);
          break;
        }

        case "stop": {
          const queue = distube.getQueue(message);
          if (!queue) {
            return message.channel.send("❌ Nothing is playing!");
          }
          distube.stop(message);
          message.channel.send("⏹️ Stopped the music and cleared the queue!");
          break;
        }

        case "pause": {
          const queue = distube.getQueue(message);
          if (!queue) {
            return message.channel.send("❌ Nothing is playing!");
          }
          if (queue.paused) {
            return message.channel.send("❌ Music is already paused!");
          }
          distube.pause(message);
          message.channel.send("⏸️ Music paused!");
          break;
        }

        case "resume": {
          const queue = distube.getQueue(message);
          if (!queue) {
            return message.channel.send("❌ Nothing is playing!");
          }
          if (!queue.paused) {
            return message.channel.send("❌ Music is not paused!");
          }
          distube.resume(message);
          message.channel.send("▶️ Music resumed!");
          break;
        }

        case "repeat": {
          const queue = distube.getQueue(message);
          if (!queue) {
            return message.channel.send("❌ Nothing is playing!");
          }

          const modeArg = parseInt(args[0]);
          let mode = distube.setRepeatMode(message, modeArg);
          
          const modeText = mode === 2 ? "🔁 Repeat Queue" : mode === 1 ? "🔂 Repeat Song" : "➡️ Off";
          message.channel.send(`Repeat mode: ${modeText}`);
          break;
        }

        case "shuffle": {
          const queue = distube.getQueue(message);
          if (!queue) {
            return message.channel.send("❌ Nothing is playing!");
          }
          if (queue.songs.length < 3) {
            return message.channel.send("❌ Need at least 3 songs to shuffle!");
          }
          distube.shuffle(message);
          message.channel.send("🔀 Queue shuffled!");
          break;
        }

        case "skip": {
          const queue = distube.getQueue(message);
          if (!queue) {
            return message.channel.send("❌ Nothing is playing!");
          }
          if (queue.songs.length === 1) {
            return message.channel.send("❌ No more songs in queue!");
          }
          await distube.skip(message);
          message.channel.send("⏭️ Skipped!");
          break;
        }

        case "queue": {
          const queue = distube.getQueue(message);
          if (!queue || !queue.songs || queue.songs.length === 0) {
            return message.channel.send("❌ Queue is empty!");
          }

          const currentSong = queue.songs[0];
          const upcomingSongs = queue.songs.slice(1, 11);
          
          let queueText = `🎵 **Current Queue**\n\n`;
          queueText += `**Now Playing:**\n${currentSong.name} - \`${currentSong.formattedDuration}\`\n\n`;
          
          if (upcomingSongs.length > 0) {
            queueText += `**Up Next:**\n`;
            queueText += upcomingSongs
              .map((song, idx) => `${idx + 1}. ${song.name} - \`${song.formattedDuration}\``)
              .join("\n");
            
            if (queue.songs.length > 11) {
              queueText += `\n\n...and ${queue.songs.length - 11} more songs`;
            }
          }

          message.channel.send(queueText);
          break;
        }

        case "volume": {
          const queue = distube.getQueue(message);
          if (!queue) {
            return message.channel.send("❌ Nothing is playing!");
          }

          const vol = parseInt(args[0]);
          if (isNaN(vol) || vol < 0 || vol > 200) {
            return message.channel.send(`🔊 Current volume: **${queue.volume}%**\nUsage: \`ct volume <0-200>\``);
          }

          distube.setVolume(message, vol);
          message.channel.send(`🔊 Volume set to **${vol}%**`);
          break;
        }

        case "disconnect": {
          const queue = distube.getQueue(message);
          if (!queue) {
            clearStaleVoiceConnection(message.guild.id);
            message.channel.send("✅ Cleared any stale connections.");
          }
          distube.voices.leave(message);
          message.channel.send("👋 Disconnected from voice channel!");
          break;
        }

        case "vcdebug": {
          const guildId = message.guild?.id;
          const { defaultConn, distubeConn } = guildId
            ? getVoiceConnections(guildId)
            : { defaultConn: null, distubeConn: null };
          
          const userVc = message.member?.voice?.channel;
          const botVc = message.guild?.members?.me?.voice?.channel;
          const queue = distube.getQueue(message);
          const permIssue = userVc ? checkVoicePermissions(message, userVc) : "User not in VC";
          const voice = distube.voices.get(guildId);

          let debugInfo = `**Voice Debug:**\n`;
          debugInfo += `• User VC: ${userVc ? `${userVc.name} (${userVc.id})` : "none"}\n`;
          debugInfo += `• Bot VC: ${botVc ? `${botVc.name} (${botVc.id})` : "none"}\n`;
          debugInfo += `• Default Connection: ${defaultConn?.state?.status || "none"}\n`;
          debugInfo += `• DisTube Connection: ${distubeConn?.state?.status || "none"}\n`;
          debugInfo += `• DisTube Voice Manager: ${voice ? "exists" : "none"}\n`;
          debugInfo += `• Queue: ${queue ? `${queue.songs.length} songs` : "none"}\n`;
          debugInfo += `• Permissions: ${permIssue || "✅ OK"}\n`;
          
          if (distubeConn) {
            debugInfo += `• Connection Details:\n`;
            debugInfo += `  - Ping: ${distubeConn.ping?.udp || "?"}ms\n`;
            debugInfo += `  - State: ${JSON.stringify(distubeConn.state.status)}\n`;
          }

          message.channel.send(debugInfo);
          break;
        }

        case "help": {
          message.channel.send(
            `🎵 **Music Commands:**\n` +
            `\`ct play <url>\` - Play from YouTube/Spotify URL\n` +
            `\`ct pause\` - Pause the music\n` +
            `\`ct resume\` - Resume the music\n` +
            `\`ct skip\` - Skip current song\n` +
            `\`ct stop\` - Stop and clear queue\n` +
            `\`ct queue\` - Show current queue\n` +
            `\`ct shuffle\` - Shuffle the queue\n` +
            `\`ct repeat <0/1/2>\` - 0=off, 1=song, 2=queue\n` +
            `\`ct volume <0-200>\` - Set volume\n` +
            `\`ct disconnect\` - Leave voice channel\n` +
            `\`ct vcdebug\` - Debug voice connection\n` +
            `\`ct vctest\` - Test voice connectivity\n\n` +
            `📝 **Examples:**\n` +
            `\`ct play https://youtu.be/dQw4w9WgXcQ\`\n` +
            `\`ct play https://open.spotify.com/track/...\`\n\n` +
            `⚠️ **If music won't play:**\n` +
            `• Check Windows Firewall isn't blocking Node.js\n` +
            `• Disable VPN/Proxy temporarily\n` +
            `• Ensure bot has Connect & Speak permissions\n` +
            `• Run \`ct vctest\` to diagnose issues`
          );
          break;
        }

        case "vctest": {
          const userVc = message.member?.voice?.channel;
          if (!userVc) {
            return message.channel.send("❌ Join a voice channel first!");
          }

          message.channel.send("🔍 Testing voice connectivity...");

          try {
            console.log('[VCTest] Starting voice connection test...');
            
            // Clear any existing connections
            clearStaleVoiceConnection(message.guild.id);
            await new Promise((resolve) => setTimeout(resolve, 1000));

            // Try to create a raw connection for testing
            const { joinVoiceChannel: testJoin } = require('@discordjs/voice');
            const testConnection = testJoin({
              channelId: userVc.id,
              guildId: userVc.guild.id,
              adapterCreator: userVc.guild.voiceAdapterCreator,
              group: 'test-group',
            });

            setupConnectionDebug(testConnection, message.guild.id);

            console.log('[VCTest] Waiting for Ready state...');

            const { entersState } = require('@discordjs/voice');
            await entersState(testConnection, VoiceConnectionStatus.Ready, 15000);

            console.log('[VCTest] Connection successful!');
            
            message.channel.send(
              `✅ **Voice Test Successful!**\n` +
              `• Connection established\n` +
              `• UDP handshake completed\n` +
              `• Ping: ${testConnection.ping?.udp || '?'}ms\n\n` +
              `Your voice connection is working. If music still fails, try:\n` +
              `• Close and restart the bot\n` +
              `• Check if ffmpeg is working: \`where ffmpeg\``
            );

            setTimeout(() => {
              if (testConnection.state.status !== VoiceConnectionStatus.Destroyed) {
                testConnection.destroy();
              }
            }, 2000);

          } catch (error) {
            console.error('[VCTest] Test failed:', error);
            
            message.channel.send(
              `❌ **Voice Test Failed**\n` +
              `Error: ${error.message}\n\n` +
              `**Common causes:**\n` +
              `• Windows Firewall blocking Node.js UDP traffic\n` +
              `• VPN/Proxy interfering with Discord voice\n` +
              `• Network blocking UDP ports 50000-65535\n` +
              `• Discord's voice server unreachable\n\n` +
              `**Try this:**\n` +
              `1. Temporarily disable Windows Firewall\n` +
              `2. Disable any VPN/proxy\n` +
              `3. Check your router isn't blocking Discord\n` +
              `4. Run bot as Administrator (temporarily)`
            );
          }
          break;
        }
      }
    } catch (error) {
      console.error(`[DisTube Command Error]`, error);

      if (error?.name === "DisTubeError") {
        if (error.errorCode === "VOICE_CONNECT_FAILED") {
          message.channel.send(
            "❌ Failed to connect to voice channel. Make sure I have **Connect** and **Speak** permissions."
          );
        } else if (error.message.includes("CANNOT_RESOLVE_SONG")) {
          message.channel.send("❌ Couldn't find that song. Try a different search term or URL.");
        } else {
          message.channel.send(`❌ Error: ${error.message}`);
        }
      } else {
        message.channel.send(`❌ An error occurred: ${error.message || "Unknown error"}`);
      }
    }
  });

  // ==================== DisTube Events ====================
  const getQueueStatus = (queue) =>
    `Volume: **${queue.volume}%** | Loop: **${
      queue.repeatMode === 2 ? "Queue" : queue.repeatMode === 1 ? "Song" : "Off"
    }** | Autoplay: **${queue.autoplay ? "On" : "Off"}**`;

  distube
    .on("playSong", (queue, song) => {
      queue.textChannel?.send(
        `🎵 **Now Playing:**\n${song.name} - \`${song.formattedDuration}\`\n` +
        `Requested by: ${song.user}\n${getQueueStatus(queue)}`
      );
    })
    .on("addSong", (queue, song) => {
      queue.textChannel?.send(
        `✅ Added to queue: **${song.name}** - \`${song.formattedDuration}\` by ${song.user}`
      );
    })
    .on("addList", (queue, playlist) => {
      queue.textChannel?.send(
        `✅ Added playlist: **${playlist.name}** (${playlist.songs.length} songs)\n${getQueueStatus(queue)}`
      );
    })
    .on("error", (error, queue) => {
      console.error("[DisTube Error]", error);
      queue.textChannel?.send(`❌ An error occurred: ${error.message}`);
    })
    .on("finish", (queue) => {
      queue.textChannel?.send("✅ Queue finished!");
    })
    .on("disconnect", (queue) => {
      queue.textChannel?.send("👋 Disconnected from voice channel.");
    })
    .on("empty", (queue) => {
      queue.textChannel?.send("🚶 Voice channel is empty. Leaving...");
    })
    .on("searchResult", (message, result) => {
      const searchText = result
        .map((song, i) => `**${i + 1}.** ${song.name} - \`${song.formattedDuration}\``)
        .join("\n");
      
      message.channel.send(
        `🔍 **Choose a song:**\n${searchText}\n\n*Type a number or wait 30 seconds to cancel*`
      );
    })
    .on("searchCancel", (message) => {
      message.channel.send("❌ Search cancelled.");
    })
    .on("searchNoResult", (message) => {
      message.channel.send("❌ No results found.");
    })
    .on("searchInvalidAnswer", (message) => {
      message.channel.send("❌ Invalid selection.");
    })
    .on("searchDone", () => {
      // Song will be added via addSong event
    });
};

module.exports = distubeFunc;