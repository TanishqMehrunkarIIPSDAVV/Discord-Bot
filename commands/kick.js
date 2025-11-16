const { SlashCommandBuilder, userMention } = require('discord.js');

const arr = [
  "https://media.giphy.com/media/M9Tvo7WALVoelIKZXa/giphy.gif",
  "https://media.giphy.com/media/ch1sqP9AmSX9pSM6wE/giphy.gif",
  "https://media.giphy.com/media/Y3k8aDFWeoORyes3AC/giphy.gif",
  "https://media.giphy.com/media/26gR1DpB7NvMw9Iys/giphy.gif",
  "https://media.giphy.com/media/l1J9LxBE5Xqq1Tnzi/giphy.gif",
  "https://media.giphy.com/media/0WWFM5hXC4dUGxz0Gv/giphy.gif",
  "https://media.giphy.com/media/BoWlZz6CjNktV3N0Vg/giphy.gif",
  "https://media.giphy.com/media/8vZLo0AIrlqq2ixzfb/giphy.gif",
  "https://media.giphy.com/media/xT9IgmxjomlULyIXny/giphy.gif",
  "https://media.giphy.com/media/2xPJCN4HUWKrWF14Uv/giphy.gif",
  "https://media.giphy.com/media/4gFi76E6e3wis/giphy.gif",
  "https://media.giphy.com/media/Iata2hPrvneCxvXc2f/giphy.gif"
];

module.exports = {
  data: new SlashCommandBuilder()
    .setName('kick')
    .setDescription('Select a member and kick them (but not really).')
    .addUserOption(option => option.setName('target').setDescription('The member to kick')),
  async execute(interaction) {
    try {
      const member = interaction.options.getMember('target');
      if (!member) {
        return await interaction.reply({ content: 'Please select a valid member.', ephemeral: true });
      }

      const exampleEmbed = {
        title: 'KO!! Flawless Victory!!!',
        image: {
          url: arr[Math.floor(Math.random() * arr.length)],
        },
      };

      const u = userMention(member.id);
      return await interaction.reply({ content: `You kicked ${u}`, embeds: [exampleEmbed], ephemeral: false });
    } catch (err) {
      console.error('kick command error:', err);
      try {
        if (interaction.deferred || interaction.replied) {
          await interaction.editReply({ content: 'There was an error executing this command.' });
        } else {
          await interaction.reply({ content: 'There was an error executing this command.', ephemeral: true });
        }
      } catch (e) {
        console.error('kick error reply failed:', e);
      }
    }
  },
};