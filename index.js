const { Client, GatewayIntentBits } = require('discord.js');
const { joinVoiceChannel, createAudioPlayer, createAudioResource, AudioPlayerStatus } = require('@discordjs/voice');
const { spawn } = require('child_process');
const { token } = require('./config.json');
const ytSearch = require('yt-search'); // Import yt-search for YouTube search

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildVoiceStates,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildMessages,
    ],
});

// Queue for each guild
const queues = new Map();

client.once('ready', () => {
    console.log(`✅ Logged in as ${client.user.tag}`);
});

client.on('messageCreate', async (message) => {
    if (message.author.bot) return; // Ignore bot messages

    // !play Command
    if (message.content.startsWith('!play')) {
        const voiceChannel = message.member.voice.channel;
        if (!voiceChannel) return message.reply('You need to join a voice channel first!');

        const query = message.content.slice(6).trim();
        if (!query) return message.reply('Please provide a song name or URL!');

        try {
            const { videos } = await ytSearch(query);
            const video = videos[0];
            if (!video) return message.reply('No results found for that query.');

            const song = { url: video.url, name: video.title };

            let queue = queues.get(message.guild.id) || { songs: [], playing: false };
            queues.set(message.guild.id, queue);

            queue.songs.push(song);

            if (!queue.playing) {
                await playNext(message.guild.id, voiceChannel, message.channel);
            } else {
                message.reply(`🎶 Added to queue: [${song.name}](${song.url})`);
            }
        } catch (error) {
            console.error('Error adding song:', error);
            message.reply('An error occurred while searching for the song.');
        }
    }

    // !skip Command
    if (message.content.startsWith('!skip')) {
        const queue = queues.get(message.guild.id);
        if (!queue || queue.songs.length === 0 || !queue.playing) {
            return message.reply('There is no song currently playing.');
        }

        queue.songs.shift();
        queue.playing = false;
        message.reply('⏭ Skipped the current song.');
        playNext(message.guild.id, message.member.voice.channel, message.channel);
    }

    // !stop Command
    if (message.content.startsWith('!stop')) {
        const queue = queues.get(message.guild.id);
        if (!queue || !queue.playing) {
            return message.reply('There is no song currently playing.');
        }

        queue.songs = [];
        queue.playing = false;
        const connection = joinVoiceChannel({
            channelId: message.member.voice.channel.id,
            guildId: message.guild.id,
            adapterCreator: message.guild.voiceAdapterCreator,
        });
        connection.destroy();
        message.reply('🛑 Music stopped and the bot has left the voice channel.');
    }

    // !queue Command
    if (message.content.startsWith('!queue')) {
        const queue = queues.get(message.guild.id);
        if (!queue || queue.songs.length === 0) {
            return message.reply('The queue is currently empty.');
        }

        let queueMessage = '🎵 **Current Queue:**\n';
        queue.songs.forEach((song, index) => {
            queueMessage += `${index + 1}. [${song.name}](<${song.url}>)\n`;
        });

        message.reply(queueMessage);
    }

    // !help Command
    if (message.content.startsWith('!help')) {
        const helpMessage = `
**Music Bot Commands:**
- \`!play <song name or URL>\`: Add a song to the queue and play it.
- \`!queue\`: Display the current song queue.
- \`!skip\`: Skip the current song.
- \`!stop\`: Stop the music and clear the queue.
- \`!help\`: Show this help message.
        `;

        try {
            await message.author.send(helpMessage);
            message.reply('📬 I\'ve sent you a DM with the list of commands!');
        } catch (error) {
            console.error('Error sending DM:', error);
            message.reply('I couldn\'t send you a DM. Please check your privacy settings.');
        }
    }
});

// Function to play the next song in the queue
async function playNext(guildId, voiceChannel, textChannel) {
    const queue = queues.get(guildId);
    if (queue.songs.length === 0) {
        console.log('Queue is empty.');
        return;
    }

    const song = queue.songs[0];
    console.log(`▶ Playing: ${song.name}`);

    const connection = joinVoiceChannel({
        channelId: voiceChannel.id,
        guildId: voiceChannel.guild.id,
        adapterCreator: voiceChannel.guild.voiceAdapterCreator,
    });

    const ytDlpProcess = spawn('yt-dlp', ['-f', 'bestaudio', '-o', '-', song.url], { stdio: ['ignore', 'pipe', 'ignore'] });
    const resource = createAudioResource(ytDlpProcess.stdout);

    const player = createAudioPlayer();
    connection.subscribe(player);

    player.play(resource);
    queue.playing = true;

    player.on(AudioPlayerStatus.Playing, () => {
        textChannel.send(`🎶 Now playing: [${song.name}](${song.url})`);
    });

    player.on(AudioPlayerStatus.Idle, () => {
        queue.songs.shift();
        queue.playing = false;

        if (queue.songs.length > 0) {
            playNext(guildId, voiceChannel, textChannel);
        } else {
            connection.destroy();
        }
    });

    player.on('error', (error) => {
        console.error('Audio player error:', error);
        queue.songs.shift();
        queue.playing = false;

        if (queue.songs.length > 0) {
            playNext(guildId, voiceChannel, textChannel);
        } else {
            connection.destroy();
        }
    });

    ytDlpProcess.on('error', (error) => {
        console.error('yt-dlp error:', error);
        textChannel.reply('Error fetching audio. Please try again later.');
        queue.songs.shift();
        queue.playing = false;
        connection.destroy();
    });
}

client.login(token);
