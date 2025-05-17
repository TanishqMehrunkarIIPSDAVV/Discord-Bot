const { SlashCommandBuilder,channelMention,userMention,roleMention} = require('discord.js');

var arr=[
"https://giphy.com/gifs/kid-hit-smack-XDRoTw2Fs6rlIW7yQL",
  "https://giphy.com/gifs/80s-retro-1980s-3XlEk2RxPS1m8",
  "https://giphy.com/gifs/iQiyiOfficial-anime-demon-slayer-entertainment-district-90cAvw5mBQHa1QNFG9",
]
module.exports = {
	data: new SlashCommandBuilder()
		.setName('slap')
		.setDescription('Select a member and slap them.')
		.addUserOption(option => option.setName('target').setDescription('The member to slap')),
	async execute(interaction) {
        const exampleEmbed = {
    	title: 'Uffff it was a hard one!!!',
    	image: {
    		url: arr[Math.floor(Math.random()*arr.length)],
    	},
    };
		const member = interaction.options.getMember('target');
    if(!member) return;
    const u=userMention(member.id);
		return interaction.reply({ content: `You slapped`+` `+u,embeds:[exampleEmbed], ephemeral: false });
	},
};
