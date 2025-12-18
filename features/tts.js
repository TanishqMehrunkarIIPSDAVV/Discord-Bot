const {getVoiceConnection,joinVoiceChannel, createAudioPlayer, createAudioResource, entersState, VoiceConnectionStatus } = require('@discordjs/voice');
const path = require("node:path");
const client = require(`${path.dirname(__dirname)}/index.js`);
const googleTTS = require('google-tts-api'); // No API key needed

const tts = ()=>{
    client.on('messageCreate', async (message) => {
        if (message.content.startsWith('ct tts')) {
            const text = message.content.slice(7);
            if (text.length === 0) return message.reply('Please provide some text to convert to speech.');
            if (text.length > 200) return message.reply('Text is too long. Please limit it to 200 characters.');
            const voiceChannel = message.member.voice.channel;
            if (!voiceChannel) {
                return message.reply('Join a voice channel first!');
            }
            await speakInVC(voiceChannel, text, message.member.user.username);
        }

        if(message.content === "ct disconnect") {
            const voiceChannel = message.member.voice.channel;
            if (!voiceChannel) {
                return message.reply('Join a voice channel first!');
            }
            const connection = getVoiceConnection(voiceChannel.guild.id);
            if (connection) {
                connection.destroy();
                message.reply('Disconnected from the voice channel.');
            } else {
                message.reply('I am not connected to any voice channel.');
            }
        }   
    });
}

async function speakInVC(voiceChannel, text,user) {
    // Get TTS audio URL
    const url = googleTTS.getAudioUrl(`${user} wants to say that `+text, { lang: 'en', slow: false });

    // Join the voice channel
    const connection = joinVoiceChannel({
        channelId: voiceChannel.id,
        guildId: voiceChannel.guild.id,
        adapterCreator: voiceChannel.guild.voiceAdapterCreator,
    });

    // Wait for connection to be ready
    await entersState(connection, VoiceConnectionStatus.Ready, 30_000);

    // Play the TTS audio
    const player = createAudioPlayer();
    const resource = createAudioResource(url);
    connection.subscribe(player);
    player.play(resource);
}

module.exports = tts;
// Usage in a command: