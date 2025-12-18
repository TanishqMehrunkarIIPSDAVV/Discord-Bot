const path = require("node:path");
const { PermissionFlagsBits, ChannelType } = require("discord.js");
const client = require(`${path.dirname(__dirname)}/index.js`);
const channelAliases = require("../channelMap"); // make sure this path is correct

const move = () => {
  client.on("messageCreate", async (message) => {
    if (message.author.bot || !message.guild) return;

    const prefix = "ct";
    if (!message.content.toLowerCase().startsWith(prefix)) return;

    // Remove prefix: "ct move duo vc 2 afk vc" -> "move duo vc 2 afk vc"
    const withoutPrefix = message.content.slice(prefix.length).trim();
    const parts = withoutPrefix.split(/\s+/); // ["move","duo","vc","2","afk","vc"]
    const subcommand = parts.shift();
    if (!subcommand || subcommand.toLowerCase() !== "move") return;

    if (parts.length < 2) {
      return message.reply(
        "Usage: `ct move <fromChannel> <toChannel>`\n" +
        "Example: `ct move duo vc 2 afk vc`"
      );
    }

    // Permissions
    if (!message.member.permissions.has(PermissionFlagsBits.MoveMembers)) {
      return message.reply("You don't have permission to move members.");
    }
    if (!message.guild.members.me.permissions.has(PermissionFlagsBits.MoveMembers)) {
      return message.reply("I don't have permission to move members. Give me the **Move Members** permission.");
    }

    // Helper: resolve a voice channel from raw text
    const resolveVoiceChannel = (raw) => {
      if (!raw) return null;

      // 1) Alias map
      const aliasKey = raw.trim().toLowerCase();
      if (channelAliases[aliasKey]) {
        const aliased = message.guild.channels.cache.get(channelAliases[aliasKey]);
        if (
          aliased &&
          (aliased.type === ChannelType.GuildVoice ||
            aliased.type === ChannelType.GuildStageVoice)
        ) {
          return aliased;
        }
      }

      let target = null;

      // 2) Mention <#id>
      const mentionIdMatch = raw.match(/^<#!?(\d+)>$/);
      if (mentionIdMatch) {
        const id = mentionIdMatch[1];
        target = message.guild.channels.cache.get(id) || null;
      }

      // 3) Raw ID
      if (!target) {
        const cleanedId = raw.replace(/[<#>]/g, "");
        if (/^\d+$/.test(cleanedId)) {
          target = message.guild.channels.cache.get(cleanedId) || null;
        }
      }

      // 4) Name (exact / case-insensitive)
      if (!target) {
        const queryName = raw.trim();
        target =
          message.guild.channels.cache.find((ch) => {
            if (
              ch.type !== ChannelType.GuildVoice &&
              ch.type !== ChannelType.GuildStageVoice
            ) {
              return false;
            }
            if (ch.name === queryName) return true;
            if (ch.name.toLowerCase() === queryName.toLowerCase()) return true;
            return false;
          }) || null;
      }

      if (
        target &&
        target.type !== ChannelType.GuildVoice &&
        target.type !== ChannelType.GuildStageVoice
      ) {
        return null;
      }

      return target;
    };

    // ---------- SMART SPLIT USING ALIASES FIRST ----------

    const restOriginal = parts.join(" ");         // "duo vc 2 afk vc"
    const restLower = restOriginal.toLowerCase();

    let fromRaw = null;
    let toRaw = null;

    // Try to find a known alias at the start (longest match first!)
    const aliasKeys = Object.keys(channelAliases).sort(
      (a, b) => b.length - a.length
    );

    for (const key of aliasKeys) {
      if (restLower.startsWith(key)) {
        fromRaw = key;                                           // e.g. "duo vc 2"
        toRaw = restOriginal.slice(key.length).trim();           // e.g. "afk vc"
        break;
      }
    }

    // If no alias prefix matched, fall back to generic split (prefix scanning)
    if (!fromRaw) {
      for (let i = parts.length; i >= 1; i--) {
        const candidateFrom = parts.slice(0, i).join(" ");
        const chan = resolveVoiceChannel(candidateFrom);
        if (chan) {
          fromRaw = candidateFrom;
          toRaw = parts.slice(i).join(" ");
          break;
        }
      }
    }

    if (!fromRaw) {
      return message.reply(
        "I couldn't resolve the **from** voice channel.\n" +
        "Make sure you're using a valid alias (like `duo vc 2`), a channel mention, its ID, or the exact name."
      );
    }

    if (!toRaw || !toRaw.trim().length) {
      return message.reply("I couldn't detect the **to** voice channel name.");
    }

    const fromChannel = resolveVoiceChannel(fromRaw);
    const toChannel = resolveVoiceChannel(toRaw);

    if (!fromChannel) {
      return message.reply(
        "I couldn't resolve the **from** voice channel.\n" +
        `Got: \`${fromRaw}\` – check your alias map or channel name.`
      );
    }

    if (!toChannel) {
      return message.reply(
        "I couldn't resolve the **to** voice channel.\n" +
        `Got: \`${toRaw}\` – check your alias map or channel name.`
      );
    }

    if (fromChannel.id === toChannel.id) {
      return message.reply("The source and target channels are the same.");
    }

    // Bot perms in channels
    const botPermsFrom = fromChannel.permissionsFor(message.guild.members.me);
    const botPermsTo = toChannel.permissionsFor(message.guild.members.me);

    if (!botPermsFrom || !botPermsFrom.has(PermissionFlagsBits.ViewChannel)) {
      return message.reply("I don't have permission to view the **from** voice channel.");
    }

    if (
      !botPermsTo ||
      !botPermsTo.has(PermissionFlagsBits.ViewChannel) ||
      !botPermsTo.has(PermissionFlagsBits.Connect)
    ) {
      return message.reply("I don't have permission to join the **to** voice channel.");
    }

    const membersToMove = [...fromChannel.members.values()];

    if (membersToMove.length === 0) {
      return message.reply(`There is no one in **${fromChannel.name}** to move.`);
    }

    try {
      let movedCount = 0;

      await Promise.all(
        membersToMove.map(async (member) => {
          if (member.voice.channelId === toChannel.id) return;

          try {
            await member.voice.setChannel(
              toChannel,
              `Moved by ${message.author.tag} from ${fromChannel.name} to ${toChannel.name}`
            );
            movedCount++;
          } catch (err) {
            console.error(`Failed to move ${member.user.tag}:`, err);
          }
        })
      );

      if (movedCount === 0) {
        return message.reply(
          "I couldn't move any members. They might already be in the target channel or I lack permissions."
        );
      }

      return message.reply(
        `✅ Moved **${movedCount}** member(s) from **${fromChannel.name}** to **${toChannel.name}**.`
      );
    } catch (err) {
      console.error("Move command error:", err);
      return message.reply("Something went wrong while moving members.");
    }
  });
};

module.exports = move;
