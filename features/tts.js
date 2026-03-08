const {getVoiceConnection,joinVoiceChannel, createAudioPlayer, createAudioResource, entersState, VoiceConnectionStatus } = require('@discordjs/voice');
const path = require("node:path");
const client = require(`${path.dirname(__dirname)}/index.js`);
const googleTTS = require('google-tts-api'); // No API key needed

const tts = ()=>{
    client.on('messageCreate', async (message) => {
        if (message.content.startsWith('ct tts')) {
            const text = message.content.slice(7).trim();
            if (text.length === 0) return message.reply('Please provide some text to convert to speech.');
            if (text.length > 200) return message.reply('Text is too long. Please limit it to 200 characters.');
            const voiceChannel = message.member.voice.channel;
            if (!voiceChannel) {
                return message.reply('Join a voice channel first!');
            }
            await speakInVC(voiceChannel, text, message.member.user.username, message);
        }

        // REMOVED: ct disconnect is now handled by distube.js
    });
}

async function speakInVC(voiceChannel, text, user, message) {
    try {
        // Get TTS audio URL
        const url = googleTTS.getAudioUrl(`${user} wants to say that `+text, { lang: 'en', slow: false });

        // Check if DisTube is using this channel - don't interfere
        const distubeConn = client.user?.id ? getVoiceConnection(voiceChannel.guild.id, client.user.id) : null;
        if (distubeConn && distubeConn.state.status === VoiceConnectionStatus.Ready) {
            return message.reply('⚠️ Music is playing. Use `ct stop` first or wait for the queue to finish.');
        }

        // Join with a different group to avoid conflicts
        const connection = joinVoiceChannel({
            channelId: voiceChannel.id,
            guildId: voiceChannel.guild.id,
            adapterCreator: voiceChannel.guild.voiceAdapterCreator,
            group: 'tts-group', // Use different group from DisTube
            selfDeaf: false,
            selfMute: false,
        });

        console.log('[TTS] Joining voice channel...');

        // Wait for connection to be ready
        await entersState(connection, VoiceConnectionStatus.Ready, 30_000);

        console.log('[TTS] Connection ready, playing audio...');

        // Play the TTS audio
        const player = createAudioPlayer();
        const resource = createAudioResource(url);
        connection.subscribe(player);
        player.play(resource);

        // Auto-disconnect after playing
        player.on('idle', () => {
            setTimeout(() => {
                if (connection.state.status !== VoiceConnectionStatus.Destroyed) {
                    connection.destroy();
                    console.log('[TTS] Disconnected after playback');
                }
            }, 1000);
        });

        player.on('error', (err) => {
            console.error('[TTS] Player error:', err);
            if (connection.state.status !== VoiceConnectionStatus.Destroyed) {
                connection.destroy();
            }
        });

    } catch (error) {
        console.error('[TTS] Error:', error);
        message.reply('❌ Failed to play TTS. ' + error.message);
    }
}

module.exports = tts;