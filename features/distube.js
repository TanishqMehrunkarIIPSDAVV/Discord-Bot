const path = require("node:path");
const fs = require("node:fs");
const { execFileSync } = require("node:child_process");
const client = require(`${path.dirname(__dirname)}/index.js`);
const { DisTube } = require("distube");
const { SpotifyPlugin } = require("@distube/spotify");
const { YtDlpPlugin } = require("@distube/yt-dlp");
const { PermissionFlagsBits, ChannelType } = require("discord.js");
const { getVoiceConnection, VoiceConnectionStatus } = require("@discordjs/voice");
const ffmpegPath = require("ffmpeg-static");

// ==================== FFmpeg Path Resolution ====================
// Resolve ffmpeg-static to a path without spaces for Windows compatibility
const getFFmpegPath = () => {
  if (!ffmpegPath) return "ffmpeg";
  if (!ffmpegPath.includes(" ")) return ffmpegPath;

  // Try Windows short path first
  try {
    const shortPath = execFileSync(
      "cmd.exe",
      ["/d", "/s", "/c", `for %I in ("${ffmpegPath}") do @echo %~sI`],
      { encoding: "utf8", windowsHide: true }
    ).trim();
    if (shortPath && !shortPath.includes(" ")) return shortPath;
  } catch {}

  // Fallback: copy to path without spaces
  try {
    const noSpaceDir = path.join(path.parse(process.cwd()).root, "ctbot-bin");
    const noSpacePath = path.join(noSpaceDir, "ffmpeg.exe");
    if (!fs.existsSync(noSpaceDir)) fs.mkdirSync(noSpaceDir, { recursive: true });
    if (!fs.existsSync(noSpacePath)) fs.copyFileSync(ffmpegPath, noSpacePath);
    return noSpacePath;
  } catch {}

  return ffmpegPath;
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

  if (channel.full) {
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
    new YtDlpPlugin({ update: true }),
  ],
  emitNewSongOnly: false,
  emitAddSongWhenCreatingQueue: true,
  emitAddListWhenCreatingQueue: true,
});

// ==================== Play with Retry Logic ====================
const playWithRetry = async (channel, url, message) => {
  const existingQueue = distube.getQueue(message.guild.id);
  
  console.log(`[DisTube] Play request: ${url.substring(0, 50)}...`);
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
      
      await distube.play(channel, url, {
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
          const url = args.join(" ");
          if (!url) {
            return message.channel.send("❌ Gaane ka naam to de bsdk!!!");
          }

          await playWithRetry(channel, url, message);
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
            return message.channel.send("✅ Cleared any stale connections.");
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
            `\`ct play <song/url>\` - Play a song\n` +
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