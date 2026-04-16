const fs = require("node:fs");
const path = require("node:path");
const { SlashCommandBuilder, PermissionFlagsBits } = require("discord.js");

const configPath = path.join(__dirname, "..", "config.json");

const loadConfig = () => {
  delete require.cache[require.resolve("../config.json")];
  return require("../config.json");
};

const persistConfig = (nextConfig) => {
  fs.writeFileSync(configPath, `${JSON.stringify(nextConfig, null, 2)}\n`, "utf8");
  const cached = require("../config.json");
  Object.keys(cached).forEach((key) => {
    if (!(key in nextConfig)) delete cached[key];
  });
  Object.assign(cached, nextConfig);
};

module.exports = {
  data: new SlashCommandBuilder()
    .setName("vcguard")
    .setDescription("Enable or disable blocked-user VC auto-disconnect system")
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addSubcommand((sub) =>
      sub
        .setName("enable")
        .setDescription("Enable blocked-user VC auto-disconnect")
    )
    .addSubcommand((sub) =>
      sub
        .setName("disable")
        .setDescription("Disable blocked-user VC auto-disconnect")
    )
    .addSubcommand((sub) =>
      sub
        .setName("status")
        .setDescription("Show current VC guard status")
    ),

  async execute(interaction) {
    try {
      const action = interaction.options.getSubcommand();
      const config = loadConfig();
      const enabled = typeof process.env.VC_AUTO_DISCONNECT_ENABLED === "string"
        ? process.env.VC_AUTO_DISCONNECT_ENABLED.toLowerCase() === "true"
        : config.vcAutoDisconnectEnabled !== false;

      if (action === "status") {
        const blockedCount = Array.isArray(config.blockedVcUserIds)
          ? config.blockedVcUserIds.filter((id) => String(id).trim()).length
          : 0;
        return interaction.reply({
          content: `VC guard is currently **${enabled ? "ENABLED" : "DISABLED"}**. Blocked users configured: **${blockedCount}**.`,
          flags: 64,
        });
      }

      const nextEnabled = action === "enable";
      if (enabled === nextEnabled) {
        return interaction.reply({
          content: `VC guard is already **${enabled ? "ENABLED" : "DISABLED"}**.`,
          flags: 64,
        });
      }

      config.vcAutoDisconnectEnabled = nextEnabled;
      persistConfig(config);
      process.env.VC_AUTO_DISCONNECT_ENABLED = String(nextEnabled);

      return interaction.reply({
        content: `VC guard is now **${nextEnabled ? "ENABLED" : "DISABLED"}**.`,
        flags: 64,
      });
    } catch (err) {
      console.error("vcguard command error:", err);
      if (interaction.deferred || interaction.replied) {
        return interaction.followUp({
          content: "There was an error while updating VC guard settings.",
          flags: 64,
        }).catch(() => {});
      }
      return interaction.reply({
        content: "There was an error while updating VC guard settings.",
        flags: 64,
      }).catch(() => {});
    }
  },
};

