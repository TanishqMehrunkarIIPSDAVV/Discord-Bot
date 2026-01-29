const { SlashCommandBuilder } = require('discord.js');
const fs = require('fs');
const path = require('path');

// Store active timers for users
const activeTimers = new Map();
const dataFile = path.join(__dirname, '..', 'scheduledRemovals.json');

// Load scheduled removals from file
function loadScheduledRemovals() {
  try {
    if (fs.existsSync(dataFile)) {
      const data = JSON.parse(fs.readFileSync(dataFile, 'utf8'));
      return data;
    }
  } catch (err) {
    console.error('Error loading scheduled removals:', err);
  }
  return {};
}

// Save scheduled removals to file
function saveScheduledRemovals(data) {
  try {
    fs.writeFileSync(dataFile, JSON.stringify(data, null, 2));
  } catch (err) {
    console.error('Error saving scheduled removals:', err);
  }
}

// Initialize timers on bot startup
function initializeTimers(client) {
  const scheduled = loadScheduledRemovals();
  const now = Date.now();
  const updated = {};
  let count = 0;

  for (const [key, data] of Object.entries(scheduled)) {
    const timeLeft = data.removalTime - now;
    
    // Skip expired timers
    if (timeLeft <= 0) {
      console.log(`[RemoveMe] Skipping expired timer for user ${data.userId}`);
      continue;
    }

    console.log(`[RemoveMe] Restoring timer for user ${data.userId} in ${Math.round(timeLeft / 1000)}s`);

    // Recreate timer with proper closure
    const createTimer = (timerData) => {
      return setTimeout(async () => {
        console.log(`[RemoveMe] Timer fired for user ${timerData.userId}, executing removal...`);
        await executeRemoval(client, timerData);
        const current = loadScheduledRemovals();
        delete current[`${timerData.guildId}-${timerData.userId}`];
        saveScheduledRemovals(current);
        activeTimers.delete(`${timerData.guildId}-${timerData.userId}`);
      }, timeLeft);
    };

    const timer = createTimer(data);
    activeTimers.set(key, timer);
    updated[key] = data;
    count++;
  }

  saveScheduledRemovals(updated);
  console.log(`[RemoveMe] Initialized ${count} scheduled removal timer(s)`);
}

// Execute the removal
async function executeRemoval(client, data) {
  try {
    console.log(`[RemoveMe] Attempting to remove user ${data.userId} from guild ${data.guildId}`);
    const guild = client.guilds.cache.get(data.guildId);
    if (!guild) {
      console.log(`[RemoveMe] Guild not found: ${data.guildId}`);
      return;
    }

    const member = await guild.members.fetch(data.userId).catch((err) => {
      console.log(`[RemoveMe] Could not fetch member ${data.userId}: ${err.message}`);
      return null;
    });
    
    if (!member) {
      console.log(`[RemoveMe] Member not found: ${data.userId}`);
      return;
    }

    if (!member.voice.channel) {
      console.log(`[RemoveMe] Member ${data.userId} is not in a voice channel`);
      return;
    }

    console.log(`[RemoveMe] Disconnecting user ${data.userId} from ${member.voice.channel.name}`);
    await member.voice.disconnect('Scheduled removal');
    
    try {
      await member.send(`⏰ You have been removed from **${data.channelName}** as scheduled (${data.minutes} minute${data.minutes > 1 ? 's' : ''} timer expired).`);
    } catch (err) {
      console.log(`[RemoveMe] Could not DM user ${data.userId}: ${err.message}`);
    }
  } catch (error) {
    console.error('[RemoveMe] Error in scheduled removal execution:', error);
  }
}

module.exports.initializeTimers = initializeTimers;

module.exports = {
  data: new SlashCommandBuilder()
    .setName('removeme')
    .setDescription('Schedule your removal from voice channel after specified time')
    .addIntegerOption(option =>
      option.setName('minutes')
        .setDescription('Minutes until removal from voice channel')
        .setRequired(true)
        .setMinValue(1)
        .setMaxValue(1440) // Max 24 hours
    ),
  async execute(interaction) {
    try {
      const minutes = interaction.options.getInteger('minutes');
      const member = interaction.member;

      // Check if user is in a voice channel
      if (!member.voice.channel) {
        return await interaction.reply({
          content: '❌ You must be in a voice channel to use this command!',
          ephemeral: true
        });
      }

      const voiceChannel = member.voice.channel;
      const userId = member.id;
      const guildId = interaction.guild.id;
      const key = `${guildId}-${userId}`;

      // Cancel existing timer if any
      const existingTimer = activeTimers.get(key);
      if (existingTimer) {
        clearTimeout(existingTimer);
        activeTimers.delete(key);
      }

      // Convert minutes to milliseconds
      const delay = minutes * 60 * 1000;
      const removalTime = Date.now() + delay;

      // Prepare data to save
      const removalData = {
        userId,
        guildId,
        channelName: voiceChannel.name,
        minutes,
        removalTime
      };

      // Create timer
      const timer = setTimeout(async () => {
        await executeRemoval(interaction.client, removalData);
        
        // Remove from storage
        const scheduled = loadScheduledRemovals();
        delete scheduled[key];
        saveScheduledRemovals(scheduled);
        activeTimers.delete(key);
      }, delay);

      // Store timer in memory
      activeTimers.set(key, timer);
      
      // Save to file for persistence
      const scheduled = loadScheduledRemovals();
      scheduled[key] = removalData;
      saveScheduledRemovals(scheduled);

      // Calculate removal time using Discord timestamp
      const removalTimestamp = Math.floor(removalTime / 1000);

      return await interaction.reply({
        content: `✅ You will be removed from **${voiceChannel.name}** in **${minutes}** minute${minutes > 1 ? 's' : ''} at <t:${removalTimestamp}:t> (<t:${removalTimestamp}:R>).\n\n*You can run this command again to reschedule or leave the voice channel to cancel.*`,
        ephemeral: true
      });

    } catch (err) {
      console.error('removeme command error:', err);
      try {
        if (interaction.deferred || interaction.replied) {
          await interaction.editReply({ content: 'There was an error executing this command.' });
        } else {
          await interaction.reply({ content: 'There was an error executing this command.', ephemeral: true });
        }
      } catch (e) {
        console.error('removeme error reply failed:', e);
      }
    }
  },
  initializeTimers
};
