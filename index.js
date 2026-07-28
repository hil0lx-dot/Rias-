require('dotenv').config();
const fs = require('fs');
const { 
    Client, 
    GatewayIntentBits, 
    ApplicationCommandOptionType, 
    ActionRowBuilder, 
    ButtonBuilder, 
    ButtonStyle, 
    StringSelectMenuBuilder, 
    EmbedBuilder, 
    ChannelType, 
    PermissionFlagsBits,
    ActivityType
} = require('discord.js');
const { Client: SelfClient, RichPresence } = require('discord.js-selfbot-v13');

const mainBot = new Client({
    intents: [
        GatewayIntentBits.Guilds, 
        GatewayIntentBits.GuildVoiceStates,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.DirectMessages
    ]
});

const activeSessions = new Map();
const spammerLoops = new Map();
const savedRpcLayouts = new Map();

const prefix = "&"; 
const PRIMARY_OWNER_ID = "1387459828179406958";
const OWNER_IDS = ["1404189983807639672", PRIMARY_OWNER_ID]; 

const delay = ms => new Promise(res => setTimeout(res, ms));

// ==========================================
// PERSISTENCE (SAVE / LOAD DATA TO JSON)
// ==========================================
function loadData() {
    try {
        if (fs.existsSync('./rpc_data.json')) {
            const raw = fs.readFileSync('./rpc_data.json', 'utf8');
            const parsed = JSON.parse(raw);
            for (const [k, v] of Object.entries(parsed)) {
                savedRpcLayouts.set(k, v);
            }
        }
    } catch(e) { 
        console.error('Error loading RPC data file:', e); 
    }

    try {
        if (fs.existsSync('./sessions_data.json')) {
            const raw = fs.readFileSync('./sessions_data.json', 'utf8');
            return JSON.parse(raw);
        }
    } catch(e) { 
        console.error('Error loading Session data file:', e); 
    }
    return {};
}

function saveData() {
    try {
        const rpcObj = {};
        for (const [k, v] of savedRpcLayouts.entries()) {
            rpcObj[k] = v;
        }
        fs.writeFileSync('./rpc_data.json', JSON.stringify(rpcObj, null, 2));

        const sessionObj = {};
        for (const [userId, sessions] of activeSessions.entries()) {
            sessionObj[userId] = sessions.map(s => ({
                serverId: s.serverId,
                channelId: s.channelId,
                tokens: s.tokens.map(t => t.token)
            }));
        }
        fs.writeFileSync('./sessions_data.json', JSON.stringify(sessionObj, null, 2));
    } catch(e) { 
        console.error('Error saving data to filesystem:', e); 
    }
}

const MESSAGES = {
    serverInvalid: "Please provide a valid server location ID context.",
    channelInvalid: "Please provide a valid connection channel destination ID context.",
    tokenInvalid: "An unexpected authorization checkpoint error occurred.",
    maxSessionsReached: "<a:rWarning:1494077439670878329> You have **reached your maximum limit** of 4 simultaneous sessions.\n<a:rArrow:1493252548826763275> Use /247-stopall to clean them up",
    noActiveSessions: "<a:rWarning:1494077439670878329> You don't have any running **sessions** !",
    allStopped: "<a:rSuccess:1494078302632149083> **All active sessions and tokens have been fully cleared.**\n\n<a:rArrow:1493252548826763275> **Use /247 to run it again <a:rRitaMaid:1494319991187574794>**",
    slotStopped: (slot) => `<a:rSuccess:1494078302632149083> **Session slot ${slot} was fully shut down and tokens disconnected.**`,
    slotRelocated: (slot) => `<a:rSuccess:1494078302632149083> Relocated session slot **${slot}** to its new location successfully!`,
    allRelocated: "<a:rSuccess:1494078302632149083> Relocated all active tokens across your sessions **successfully**",
    processFailed: "<a:rWarning:1494077439670878329> Process complete. No profiles could successfully connect. Verification failed.",
    altMuted: "**<a:rArrow:1493252548826763275> your alts have been muted <:rMicrophone:1507766561723781381>**",
    altUnmuted: "**<a:rArrow:1493252548826763275> your alts have been unmuted successfully**",
    altDeafened: "**<a:rArrow:1493252548826763275> your alts have been deafened <:rDeafen:1494357361694085121>**",
    altUndeafened: "**<a:rArrow:1493252548826763275> your alts have been undeafened**",
    statusUpdated: (statusName) => `**<a:rArrow:1493252548826763275> your alts status has been updated to ${statusName} successfully**`,
    cameraUpdated: (flag) => `**<a:rArrow:1493252548826763275> Camera mode set to **${flag.toUpperCase()}** across active alts.**`,
    liveUpdated: (flag) => `**<a:rArrow:1493252548826763275> Voice Channel Red Live stream mode set to **${flag.toUpperCase()}** across active alts.**`,
    spammerUpdated: (flag) => `**<a:rArrow:1493252548826763275> Background text spammer state switched to: **${flag.toUpperCase()}****`,
    editSuccess: (slot) => `**<a:rSuccess:1494078302632149083> Session slot ${slot} tokens updated and deployed successfully!**`,
    restartingAll: `**🔄 Restarting all active sessions and re-verifying connection gateways...**`,
    restartingSlot: (slot) => `**🔄 Restarting active session slot ${slot}...**`,
    buildSuccessLine: (username, channelName, guildName) => `<a:rSuccess:1494078302632149083> • The **${username}** has successfully joined **${channelName}** on the server **${guildName}**\n`,
    successFooter: `i will stay there 24/7 don't worry <a:rRitaMaid:1494319991187574794>\n\n<a:rPurple:1493250339359555654> if u want to change the channel or server just run the cmd /change-place \`and follow the step\` <a:rWarn:1494077016939430039>`
};

const TICKET_PANEL_DESC = `- __We want to keep our community safe, friendly, and fun for everyone. To help with this, we have a report system you can use to tell us about any problems or questions you have. Here's a quick look at the different parts of our report system:__  ⁘\n\n` +
`- <:rAllumix:1493253489130733600>  **Pub** : \`Report spam or pub\` \n\n` +
`- <:rBughunter:1493253428695011409> **Bugs** : \`Report bugs or issues\` \n\n` +
`- <:rDiscord_employe:1493323538487054435>  **Abuse** : \`Report abuse or harassment\` \n\n` +
`- <:rquarantined:1493324162155024415> **Server** : \`Bot info or requests\` \n\n` +
`- <:rbans:1493323589145989140> **Staff Abuse** : \`Report staff issues\` \n\n\n` +
`- <:rHmm:1494304201319252170>   __Use these modules for assistance or to report issues. Our team is here to help!__`;

mainBot.once('ready', async () => {
    console.log(`🚀 Main bot online: ${mainBot.user.tag}`);
    
    // Set Main Bot Streaming Status with valid Twitch link
    mainBot.user.setPresence({
        activities: [{ 
            name: '69', 
            type: ActivityType.Streaming, 
            url: 'https://www.twitch.tv/discord' 
        }],
        status: 'online'
    });

    const commands = [
        {
            name: '247',
            description: 'Start keeping up to 5 tokens in a voice channel (Max 4 sessions)',
            options: [
                { name: 'server-id', description: 'The Server ID', type: ApplicationCommandOptionType.String, required: true },
                { name: 'channel-id', description: 'The Voice Channel ID', type: ApplicationCommandOptionType.String, required: true },
                { name: 'token1', description: 'First account token', type: ApplicationCommandOptionType.String, required: true },
                { name: 'token2', description: 'Second account token', type: ApplicationCommandOptionType.String, required: false },
                { name: 'token3', description: 'Third account token', type: ApplicationCommandOptionType.String, required: false },
                { name: 'token4', description: 'Fourth account token', type: ApplicationCommandOptionType.String, required: false },
                { name: 'token5', description: 'Fifth account token', type: ApplicationCommandOptionType.String, required: false },
            ]
        },
        { 
            name: '247-stop', 
            description: 'Stop a specific running session slot',
            options: [{ name: 'slot', description: 'The active session slot number to destroy (1-4)', type: ApplicationCommandOptionType.Integer, required: true }]
        },
        { name: '247-stopall', description: 'Force kill all running sessions and drop connections globally' },
        { name: '247-storage', description: 'Inspect the exact full authorization token strings running inside your active slots' },
        { 
            name: '247-restart', 
            description: 'Restart active sessions',
            options: [{ name: 'slot', description: 'Target a specific slot to restart. Leave blank to restart ALL slots.', type: ApplicationCommandOptionType.Integer, required: false }]
        },
        {
            name: 'change-place',
            description: 'Move active tokens to a new server/channel location',
            options: [
                { name: 'new-server-id', description: 'The new Server ID', type: ApplicationCommandOptionType.String, required: true },
                { name: 'new-channel-id', description: 'The new Voice Channel ID', type: ApplicationCommandOptionType.String, required: true },
                { name: 'slot', description: 'Target a specific slot to move. Leave blank to move ALL running slots.', type: ApplicationCommandOptionType.Integer, required: false }
            ]
        },
        {
            name: '247-edit',
            description: 'Edit, overwrite, add, or drop tokens inside a running session slot directly',
            options: [
                { name: 'slot', description: 'The Session Slot to change (1-4)', type: ApplicationCommandOptionType.Integer, required: true },
                { name: 'token1', description: 'First account token', type: ApplicationCommandOptionType.String, required: true },
                { name: 'token2', description: 'Second account token', type: ApplicationCommandOptionType.String, required: false },
                { name: 'token3', description: 'Third account token', type: ApplicationCommandOptionType.String, required: false },
                { name: 'token4', description: 'Fourth account token', type: ApplicationCommandOptionType.String, required: false },
                { name: 'token5', description: 'Fifth account token', type: ApplicationCommandOptionType.String, required: false },
            ]
        },
        {
            name: '247-mute',
            description: 'Mute or unmute your running tokens',
            options: [
                { name: 'status', description: 'True to mute, False to unmute', type: ApplicationCommandOptionType.Boolean, required: true },
                { name: 'slot', description: 'Target session slot (1-4). Leave blank for all', type: ApplicationCommandOptionType.Integer, required: false }
            ]
        },
        {
            name: '247-deaf',
            description: 'Deafen or undeafen your running tokens',
            options: [
                { name: 'status', description: 'True to deafen, False to undeafen', type: ApplicationCommandOptionType.Boolean, required: true },
                { name: 'slot', description: 'Target session slot (1-4). Leave blank for all', type: ApplicationCommandOptionType.Integer, required: false }
            ]
        },
        {
            name: '247-camera',
            description: 'Toggle camera green icon visibility inside active voice channels',
            options: [
                { name: 'status', description: 'True to switch on, False to switch off', type: ApplicationCommandOptionType.Boolean, required: true },
                { name: 'slot', description: 'Target session slot (1-4). Leave blank for all', type: ApplicationCommandOptionType.Integer, required: false }
            ]
        },
        {
            name: '247-live-badge',
            description: 'Toggle the Red Voice Channel Live stream marker',
            options: [
                { name: 'status', description: 'True to turn on red live view, False to hide', type: ApplicationCommandOptionType.Boolean, required: true },
                { name: 'slot', description: 'Target session slot (1-4). Leave blank for all', type: ApplicationCommandOptionType.Integer, required: false }
            ]
        },
        {
            name: '247-status',
            description: 'Change the online presence status of active profiles',
            options: [
                {
                    name: 'type',
                    description: 'Choose status type',
                    type: ApplicationCommandOptionType.String,
                    required: true,
                    choices: [
                        { name: 'Online', value: 'online' },
                        { name: 'Idle', value: 'idle' },
                        { name: 'Do Not Disturb', value: 'dnd' },
                        { name: 'Invisible', value: 'invisible' }
                    ]
                }
            ]
        },
        {
            name: '247-rpc',
            description: 'Configure standard Rich Activities text layout parameters for alts',
            options: [
                {
                    name: 'activity-type',
                    description: 'The display type of the activity layout',
                    type: ApplicationCommandOptionType.String,
                    required: true,
                    choices: [
                        { name: 'Playing', value: 'PLAYING' },
                        { name: 'Streaming', value: 'STREAMING' },
                        { name: 'Listening', value: 'LISTENING' },
                        { name: 'Watching', value: 'WATCHING' },
                        { name: 'Competing', value: 'COMPETING' }
                    ]
                },
                { name: 'name', description: 'The primary status title name text', type: ApplicationCommandOptionType.String, required: false },
                { name: 'state', description: 'Secondary subtext info line detail', type: ApplicationCommandOptionType.String, required: false },
                { name: 'url', description: 'Stream asset source link', type: ApplicationCommandOptionType.String, required: false },
                { name: 'application-id', description: 'Custom App Client ID override', type: ApplicationCommandOptionType.String, required: false },
                { name: 'button-1-name', description: 'Label text for custom RPC link button', type: ApplicationCommandOptionType.String, required: false },
                { name: 'button-1-url', description: 'Direct URL path link destination for custom button', type: ApplicationCommandOptionType.String, required: false }
            ]
        },
        {
            name: '247-rpc-edit',
            description: 'Edit your existing Rich Presence details dynamically',
            options: [
                { name: 'name', description: 'Update status title name text', type: ApplicationCommandOptionType.String, required: false },
                { name: 'state', description: 'Update secondary subtext line detail', type: ApplicationCommandOptionType.String, required: false },
                { name: 'url', description: 'Update streaming channel link', type: ApplicationCommandOptionType.String, required: false },
                { name: 'button-1-name', description: 'Update button label text', type: ApplicationCommandOptionType.String, required: false },
                { name: 'button-1-url', description: 'Update button web url path', type: ApplicationCommandOptionType.String, required: false }
            ]
        },
        {
            name: '247-rpc-toggle',
            description: 'Turn your custom Rich Presence status visibility display ON or OFF completely',
            options: [{ name: 'status', description: 'True to enable custom status, False to hide it completely', type: ApplicationCommandOptionType.Boolean, required: true }]
        },
        {
            name: '247-rpc-assets',
            description: 'Upload custom RPC display media right from your gallery choice attachment field',
            options: [
                { name: 'large-image', description: 'Select an image or GIF straight from your gallery', type: ApplicationCommandOptionType.Attachment, required: false },
                { name: 'small-badge', description: 'Select a small icon image straight from your gallery', type: ApplicationCommandOptionType.Attachment, required: false }
            ]
        },
        {
            name: '247-spammer',
            description: 'Configure multi-account background text spamming loops',
            options: [
                { name: 'status', description: 'True to enable loop, False to close and kill loop', type: ApplicationCommandOptionType.Boolean, required: true },
                { name: 'slot', description: 'Target session slot configuration (1-4)', type: ApplicationCommandOptionType.Integer, required: false },
                { name: 'text', description: 'The text phrase to spam', type: ApplicationCommandOptionType.String, required: false },
                { name: 'channel-id', description: 'Target text channel ID', type: ApplicationCommandOptionType.String, required: false },
                { name: 'delay', description: 'Delay wait time between messages sent (in milliseconds)', type: ApplicationCommandOptionType.Integer, required: false }
            ]
        },
        { name: 'stats', description: 'View current status across your active sessions' }
    ];

    await mainBot.application.commands.set(commands).catch(console.error);

    // ==========================================
    // AUTO-RESTORE SAVED SESSIONS ON STARTUP
    // ==========================================
    const restoredSessions = loadData();
    for (const [userId, sessions] of Object.entries(restoredSessions)) {
        if (!activeSessions.has(userId)) activeSessions.set(userId, []);
        const userSessionsArr = activeSessions.get(userId);

        for (const sBackup of sessions) {
            const launchedTokens = [];
            for (const tokenStr of sBackup.tokens) {
                const res = await launchSelfbot(userId, tokenStr, sBackup.serverId, sBackup.channelId, null);
                if (res && !res.error) launchedTokens.push(res);
                await delay(2000);
            }
            if (launchedTokens.length > 0) {
                userSessionsArr.push({
                    serverId: sBackup.serverId,
                    channelId: sBackup.channelId,
                    tokens: launchedTokens
                });
            }
        }
    }
    console.log("💾 Restored saved sessions and Rich Presence layouts successfully!");
});

// ==========================================
// VOICE & STREAM PAYLOAD GENERATORS
// ==========================================
function sendVoicePayload(client, serverId, channelId, mute=false, deaf=false, video=false) {
    try {
        client.ws.broadcast({
            op: 4,
            d: {
                guild_id: serverId,
                channel_id: channelId,
                self_mute: mute,
                self_deaf: deaf,
                self_video: video
            }
        });
    } catch(e) {
        console.error(`Error casting gateway payload:`, e);
    }
}

const buildStreamPayload = (serverId, channelId, active) => {
    if (!active) {
        return { op: 18, d: null };
    }
    return {
        op: 18, 
        d: {
            type: "guild",
            guild_id: serverId,
            channel_id: channelId,
            preferred_region: null
        }
    };
};

// ==========================================
// BACKGROUND VOICE CONNECTION INTEGRITY LOOP
// ==========================================
setInterval(async () => {
    for (const [userId, sessions] of activeSessions.entries()) {
        for (const session of sessions) {
            for (const t of session.tokens) {
                if (!t.selfClient || !t.serverId || !t.channelId) continue;
                try {
                    const guild = t.selfClient.guilds.cache.get(t.serverId);
                    if (guild) {
                        const currentVc = guild.me?.voice?.channelId;
                        if (currentVc !== t.channelId) {
                            sendVoicePayload(t.selfClient, t.serverId, t.channelId, t.muted, t.deafened, t.camera);
                            if (t.live) {
                                try { t.selfClient.ws.broadcast(buildStreamPayload(t.serverId, t.channelId, true)); } catch(e){}
                            }
                        }
                    }
                } catch(e){}
            }
        }
    }
}, 15000);

// ==========================================
// RICH PRESENCE SYNC (STREAMING + BOT AVATAR + BUTTONS)
// ==========================================
async function syncRichPresenceToClient(t) {
    const savedLayout = savedRpcLayouts.get(t.userId) || {
        enabled: true,
        activityType: 'STREAMING',
        name: '69',
        url: 'https://www.twitch.tv/discord',
        button1Name: 'Join Discord Server',
        button1Url: 'https://discord.gg/3YfvJxNm9x'
        // 'state' line removed completely from default so no stats line shows up under "69"
    };

    if (!savedLayout || !savedLayout.enabled) {
        try { t.selfClient.user.setActivity(null); } catch(e){}
        return;
    }

    try {
        const pr = new RichPresence(t.selfClient);
        
        if (savedLayout.applicationId) pr.setApplicationId(savedLayout.applicationId);
        
        // Streaming Activity Setup
        pr.setType(savedLayout.activityType || 'STREAMING');
        pr.setName(savedLayout.name || '69');

        // Required Twitch URL to trigger the purple badge
        const streamUrl = (savedLayout.url && savedLayout.url.includes('twitch.tv')) 
            ? savedLayout.url 
            : 'https://www.twitch.tv/discord';
        pr.setURL(streamUrl);

        // ONLY add subtext line if explicitly provided via /247-rpc
        if (savedLayout.state) pr.setState(savedLayout.state);

        // ==========================================
        // LARGE IMAGE: Main Bot Avatar OR Custom Upload
        // ==========================================
        const botAvatarUrl = mainBot.user ? mainBot.user.displayAvatarURL({ format: 'png', dynamic: true, size: 512 }) : null;
        const largeImgUrl = savedLayout.largeImage || botAvatarUrl;

        if (largeImgUrl) pr.setLargeImage(largeImgUrl);
        if (savedLayout.smallImage) pr.setSmallImage(savedLayout.smallImage);

        // ==========================================
        // BUTTONS
        // ==========================================
        if (savedLayout.button1Name && savedLayout.button1Url) {
            pr.addButton(savedLayout.button1Name, savedLayout.button1Url);
        }

        t.selfClient.user.setActivity(pr);
    } catch (e) {
        console.error(`Error syncing presence layout state for ${t.username}:`, e);
    }
}

async function launchSelfbot(userId, token, serverId, channelId, interaction) {
    const selfClient = new SelfClient({ checkUpdate: false, patchVoice: true });
    
    return new Promise((resolve) => {
        const timeoutTracker = setTimeout(() => {
            try { selfClient.destroy(); } catch(e){}
            resolve({ error: true });
        }, 25000);

        selfClient.on('shardConnect', () => {
            selfClient.user.client.options.ws.properties = {
                ...selfClient.user.client.options.ws.properties,
                friend_source_flags: { all: true, mutual_friends: true, mutual_guilds: true }
            };
        });

        selfClient.on('ready', async () => {
            try {
                if (selfClient.user.settings) {
                    selfClient.user.settings.friendSourceFlags = { all: true, mutualFriends: true, mutualGuilds: true };
                }

                const guild = await selfClient.guilds.fetch(serverId).catch(() => null);
                if (!guild) {
                    clearTimeout(timeoutTracker);
                    selfClient.destroy();
                    return resolve({ error: true });
                }

                const channel = await selfClient.channels.fetch(channelId).catch(() => null);
                if (!channel || !channel.isVoice()) {
                    clearTimeout(timeoutTracker);
                    selfClient.destroy();
                    return resolve({ error: true });
                }

                sendVoicePayload(selfClient, serverId, channelId, false, false, false);
                clearTimeout(timeoutTracker);

                selfClient.on('voiceStateUpdate', async (oldState, newState) => {
                    if (newState.member.id === selfClient.user.id) {
                        if (!newState.channelId || newState.channelId !== channelId) {
                            await delay(4000);
                            
                            const sessionReference = activeSessions.get(userId)?.find(s => s.channelId === channelId);
                            const tokenObj = sessionReference?.tokens.find(t => t.token === token);
                            
                            const isMuted = tokenObj ? tokenObj.muted : false;
                            const isDeaf = tokenObj ? tokenObj.deafened : false;
                            const isCam = tokenObj ? tokenObj.camera : false;
                            const isLive = tokenObj ? tokenObj.live : false;

                            sendVoicePayload(selfClient, serverId, channelId, isMuted, isDeaf, isCam);
                            try { selfClient.ws.broadcast(buildStreamPayload(serverId, channelId, isLive)); } catch(e){}
                        }
                    }
                });

                if (process.env.LOGS_CHANNEL_ID) {
                    const logChannel = await mainBot.channels.fetch(process.env.LOGS_CHANNEL_ID).catch(() => null);
                    if (logChannel) {
                        let logText = MESSAGES.buildSuccessLine(selfClient.user.username, channel.name, guild.name);
                        logText += MESSAGES.successFooter;
                        await logChannel.send(logText).catch(() => null);
                    }
                }

                const tObj = { 
                    userId,
                    token, 
                    selfClient, 
                    serverId, 
                    channelId, 
                    muted: false, 
                    deafened: false,
                    camera: false,
                    live: false,
                    username: selfClient.user.username,
                    channelName: channel.name,
                    guildName: guild.name
                };

                await syncRichPresenceToClient(tObj);
                resolve(tObj);
            } catch (err) {
                clearTimeout(timeoutTracker);
                try { selfClient.destroy(); } catch(e){}
                resolve({ error: true });
            }
        });

        selfClient.login(token).catch(async () => {
            clearTimeout(timeoutTracker);
            resolve({ error: true });
        });
    });
}

function stopSpammerLoop(userId, slotIndex) {
    const key = `${userId}-${slotIndex}`;
    if (spammerLoops.has(key)) {
        clearInterval(spammerLoops.get(key));
        spammerLoops.delete(key);
    }
}

function startSpammerLoop(userId, slotIndex, tokens, text, channelId, delayMs) {
    stopSpammerLoop(userId, slotIndex);
    const key = `${userId}-${slotIndex}`;

    const executeSpamRun = async () => {
        if (!spammerLoops.has(key)) return;

        for (const tokenObj of tokens) {
            try {
                const targetChannel = await tokenObj.selfClient.channels.fetch(channelId).catch(() => null);
                if (targetChannel && targetChannel.isText()) {
                    const antiBotBypassArray = ["", "\u200b", "\u200c", "\u200d", "\uFEFF", " \u200b"];
                    const variant = antiBotBypassArray[Math.floor(Math.random() * antiBotBypassArray.length)];
                    const formattedPayload = `${text}${variant}`;

                    await targetChannel.send(formattedPayload).catch(() => null);
                    await delay(600); 
                }
            } catch(e){}
        }

        const minDelay = Math.max(delayMs, 1000);
        const jitterValue = Math.floor((Math.random() * 0.3 - 0.15) * minDelay);
        const finalCalculatedNextDelay = minDelay + jitterValue;

        if (spammerLoops.has(key)) {
            const nextTimeout = setTimeout(executeSpamRun, finalCalculatedNextDelay);
            spammerLoops.set(key, nextTimeout);
        }
    };

    const initialTimeout = setTimeout(executeSpamRun, delayMs);
    spammerLoops.set(key, initialTimeout);
}

function cleanRpcImageLink(linkStr) {
    if (!linkStr) return undefined;
    return linkStr;
}

async function reinitializeSingleSlot(userId, userSessions, slotIndex, interaction) {
    const backup = {
        serverId: userSessions[slotIndex].serverId,
        channelId: userSessions[slotIndex].channelId,
        tokens: userSessions[slotIndex].tokens.map(t => t.token)
    };

    stopSpammerLoop(userId, slotIndex);
    userSessions[slotIndex].tokens.forEach(t => {
        try {
            sendVoicePayload(t.selfClient, t.serverId, null);
            t.selfClient.destroy();
        } catch(e){}
    });

    const launchedTokens = [];
    for (const tokenStr of backup.tokens) {
        const res = await launchSelfbot(userId, tokenStr, backup.serverId, backup.channelId, interaction);
        if (res && !res.error) launchedTokens.push(res);
        await delay(2000);
    }

    if (launchedTokens.length > 0) {
        userSessions[slotIndex].tokens = launchedTokens;
        saveData();
        return true;
    } else {
        userSessions.splice(slotIndex, 1);
        saveData();
        return false;
    }
}

// ==========================================
// INTERACTION CONTROLLER
// ==========================================
mainBot.on('interactionCreate', async (interaction) => {
    
    // --------------------------------------
    // 1. TICKET & PANEL BUTTON INTERACTIONS
    // --------------------------------------
    if (interaction.isButton()) {
        const { customId, guild, user } = interaction;

        if (customId === 'setup_btn_mode') {
            const panelEmbed = new EmbedBuilder()
                .setColor("#2F3136")
                .setTitle("<:rTicket:1493253531644203098>   Rias • Ticket Support System")
                .setDescription(TICKET_PANEL_DESC);

            const row = new ActionRowBuilder().addComponents(
                new ButtonBuilder().setCustomId('tk_pub').setLabel('Pub').setEmoji('1493253489130733600').setStyle(ButtonStyle.Secondary),
                new ButtonBuilder().setCustomId('tk_bugs').setLabel('Bugs').setEmoji('1493253428695011409').setStyle(ButtonStyle.Secondary),
                new ButtonBuilder().setCustomId('tk_abuse').setLabel('Abuse').setEmoji('1493323538487054435').setStyle(ButtonStyle.Secondary),
                new ButtonBuilder().setCustomId('tk_server').setLabel('Server').setEmoji('1493324162155024415').setStyle(ButtonStyle.Secondary),
                new ButtonBuilder().setCustomId('tk_staff').setLabel('Staff Abuse').setEmoji('1493323589145989140').setStyle(ButtonStyle.Secondary)
            );

            await interaction.reply({ content: "✅ Button embed panel deployed successfully.", ephemeral: true }).catch(() => null);
            return interaction.channel.send({ embeds: [panelEmbed], components: [row] });
        }

        if (customId === 'setup_menu_mode') {
            const panelEmbed = new EmbedBuilder()
                .setColor("#2F3136")
                .setTitle("<:rTicket:1493253531644203098>   Rias • Ticket Support System")
                .setDescription(TICKET_PANEL_DESC);

            const menu = new StringSelectMenuBuilder()
                .setCustomId('ticket_select_menu')
                .setPlaceholder('Select a ticket department category...')
                .addOptions([
                    { label: 'Pub', value: 'Pub', description: 'Report spam or pub', emoji: '1493253489130733600' },
                    { label: 'Bugs', value: 'Bugs', description: 'Report bugs or issues', emoji: '1493253428695011409' },
                    { label: 'Abuse', value: 'Abuse', description: 'Report abuse or harassment', emoji: '1493323538487054435' },
                    { label: 'Server', value: 'Server', description: 'Bot info or requests', emoji: '1493324162155024415' },
                    { label: 'Staff Abuse', value: 'Staff Abuse', description: 'Report staff issues', emoji: '1493323589145989140' }
                ]);

            const row = new ActionRowBuilder().addComponents(menu);
            await interaction.reply({ content: "✅ Select Menu dropdown embed deployed successfully.", ephemeral: true }).catch(() => null);
            return interaction.channel.send({ embeds: [panelEmbed], components: [row] });
        }

        if (customId === 'close_ticket') {
            await interaction.reply({ content: "🔒 *This ticket channel is shutting down in 5 seconds...*" }).catch(() => null);
            await delay(5000);
            return interaction.channel.delete().catch(() => null);
        }

        if (customId.startsWith('tk_')) {
            await interaction.deferReply({ ephemeral: true }).catch(() => null);
            const titleMap = { tk_pub: 'Pub', tk_bugs: 'Bugs', tk_abuse: 'Abuse', tk_server: 'Server', tk_staff: 'Staff Abuse' };
            const typeSelected = titleMap[customId];

            const ticketChan = await guild.channels.create({
                name: `${user.username}-ticket`,
                type: ChannelType.GuildText,
                permissionOverwrites: [
                    { id: guild.roles.everyone.id, deny: [PermissionFlagsBits.ViewChannel] },
                    { id: user.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory] }
                ]
            }).catch(() => null);

            if (!ticketChan) return interaction.editReply({ content: "❌ Error generating channel permissions frame." });

            const innerEmbed = new EmbedBuilder()
                .setColor("#2F3136")
                .setTitle(`🎫 Department Connection: ${typeSelected}`)
                .setDescription(`Welcome to your request thread <@${user.id}>.\nOur management staff node has been initialized. State your case details below clearly.`);

            const closeRow = new ActionRowBuilder().addComponents(
                new ButtonBuilder().setCustomId('close_ticket').setLabel('Close Ticket').setStyle(ButtonStyle.Danger)
            );

            await ticketChan.send({ content: `<@${user.id}>`, embeds: [innerEmbed], components: [closeRow] }).catch(() => null);
            return interaction.editReply({ content: `📬 Ticket opened inside channel target location: ${ticketChan}` });
        }
    }

    // --------------------------------------
    // 2. DROPDOWN SELECT MENUS
    // --------------------------------------
    if (interaction.isStringSelectMenu()) {
        if (interaction.customId === 'ticket_select_menu') {
            await interaction.deferReply({ ephemeral: true }).catch(() => null);
            const typeSelected = interaction.values[0];
            const { guild, user } = interaction;

            const ticketChan = await guild.channels.create({
                name: `${user.username}-ticket`,
                type: ChannelType.GuildText,
                permissionOverwrites: [
                    { id: guild.roles.everyone.id, deny: [PermissionFlagsBits.ViewChannel] },
                    { id: user.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory] }
                ]
            }).catch(() => null);

            if (!ticketChan) return interaction.editReply({ content: "❌ Error generating channel dropdown location frame." });

            const innerEmbed = new EmbedBuilder()
                .setColor("#2F3136")
                .setTitle(`🎫 Department Connection: ${typeSelected}`)
                .setDescription(`Welcome to your request thread <@${user.id}>.\nOur management staff node has been initialized. State your case details below clearly.`);

            const closeRow = new ActionRowBuilder().addComponents(
                new ButtonBuilder().setCustomId('close_ticket').setLabel('Close Ticket').setStyle(ButtonStyle.Danger)
            );

            await ticketChan.send({ content: `<@${user.id}>`, embeds: [innerEmbed], components: [closeRow] }).catch(() => null);
            return interaction.editReply({ content: `📬 Ticket opened inside channel target location: ${ticketChan}` });
        }
    }

    // --------------------------------------
    // 3. SLASH COMMAND CONTROLLER
    // --------------------------------------
    if (!interaction.isChatInputCommand()) return;
    const { commandName, user, options } = interaction;

    if (!activeSessions.has(user.id)) activeSessions.set(user.id, []);
    const userSessions = activeSessions.get(user.id);

    if (commandName === '247') {
        await interaction.deferReply({ ephemeral: true }).catch(() => null);

        if (userSessions.length >= 4) {
            return interaction.editReply(MESSAGES.maxSessionsReached).catch(() => null);
        }

        const serverId = options.getString('server-id');
        const channelId = options.getString('channel-id');
        const rawTokens = [
            options.getString('token1'), options.getString('token2'),
            options.getString('token3'), options.getString('token4'), options.getString('token5')
        ].filter(Boolean);

        const launchedTokens = [];
        for (const token of rawTokens) {
            const res = await launchSelfbot(user.id, token, serverId, channelId, interaction);
            if (res && !res.error) launchedTokens.push(res);
            await delay(2000);
        }

        if (launchedTokens.length > 0) {
            userSessions.push({ serverId, channelId, tokens: launchedTokens });
            saveData();

            let userReplyText = "";
            launchedTokens.forEach(t => {
                userReplyText += MESSAGES.buildSuccessLine(t.username, t.channelName, t.guildName);
            });
            userReplyText += MESSAGES.successFooter;
            await interaction.editReply({ content: userReplyText }).catch(() => null);
        } else {
            await interaction.editReply(MESSAGES.processFailed).catch(() => null);
        }
    }

    if (commandName === '247-storage') {
        if (userSessions.length === 0) return interaction.reply({ content: MESSAGES.noActiveSessions, ephemeral: true }).catch(() => null);
        
        let storageOutput = `🔑 **Active Authorization Key Vault Storage**:\n\n`;
        userSessions.forEach((session, slotIdx) => {
            storageOutput += `__**Session Slot [ ${slotIdx + 1} ]**__ (Channel: \`${session.channelId}\`)\n`;
            session.tokens.forEach((tObj, tokenIdx) => {
                storageOutput += `• TOKEN_${tokenIdx + 1} (${tObj.username}) = \`${tObj.token}\`\n`;
            });
            storageOutput += `\n`;
        });

        return interaction.reply({ content: storageOutput, ephemeral: true }).catch(() => null);
    }

    if (commandName === '247-edit') {
        await interaction.deferReply({ ephemeral: true }).catch(() => null);
        const slot = options.getInteger('slot');
        const sessionIndex = slot - 1;

        if (!userSessions[sessionIndex]) {
            return interaction.editReply(`<a:rWarning:1494077439670878329> No active session running inside Slot ${slot}.`).catch(() => null);
        }

        const targetSession = userSessions[sessionIndex];
        
        stopSpammerLoop(user.id, sessionIndex);
        targetSession.tokens.forEach(t => {
            try {
                sendVoicePayload(t.selfClient, t.serverId, null);
                t.selfClient.destroy();
            } catch(e){}
        });

        const rawTokens = [
            options.getString('token1'), options.getString('token2'),
            options.getString('token3'), options.getString('token4'), options.getString('token5')
        ].filter(Boolean);

        const launchedTokens = [];
        for (const token of rawTokens) {
            const res = await launchSelfbot(user.id, token, targetSession.serverId, targetSession.channelId, interaction);
            if (res && !res.error) launchedTokens.push(res);
            await delay(2000);
        }

        if (launchedTokens.length > 0) {
            targetSession.tokens = launchedTokens;
            saveData();
            await interaction.editReply(MESSAGES.editSuccess(slot)).catch(() => null);
        } else {
            userSessions.splice(sessionIndex, 1);
            saveData();
            await interaction.editReply(`<a:rWarning:1494077439670878329> Edit failed. All tokens failed authentication. Slot ${slot} wiped.`).catch(() => null);
        }
    }

    if (commandName === '247-restart') {
        await interaction.deferReply({ ephemeral: true }).catch(() => null);
        if (userSessions.length === 0) return interaction.editReply(MESSAGES.noActiveSessions).catch(() => null);

        const slotOpt = options.getInteger('slot');

        if (slotOpt) {
            const sessionIndex = slotOpt - 1;
            if (!userSessions[sessionIndex]) {
                return interaction.editReply(`<a:rWarning:1494077439670878329> No running session allocated to Slot **${slotOpt}**.`).catch(() => null);
            }
            await interaction.editReply(MESSAGES.restartingSlot(slotOpt)).catch(() => null);
            await reinitializeSingleSlot(user.id, userSessions, sessionIndex, interaction);
            return interaction.editReply(`**<a:rSuccess:1494078302632149083> Reset and re-synchronized session slot ${slotOpt} safely!**`).catch(() => null);
        } else {
            await interaction.editReply(MESSAGES.restartingAll).catch(() => null);
            const originalBackups = JSON.parse(JSON.stringify(userSessions.map(s => ({
                serverId: s.serverId,
                channelId: s.channelId,
                tokens: s.tokens.map(t => t.token)
            }))));

            userSessions.forEach((session, idx) => {
                stopSpammerLoop(user.id, idx);
                session.tokens.forEach(t => {
                    try {
                        sendVoicePayload(t.selfClient, t.serverId, null);
                        t.selfClient.destroy();
                    } catch(e){}
                });
            });
            activeSessions.set(user.id, []);

            for (const backup of originalBackups) {
                const launchedTokens = [];
                for (const tokenStr of backup.tokens) {
                    const res = await launchSelfbot(user.id, tokenStr, backup.serverId, backup.channelId, interaction);
                    if (res && !res.error) launchedTokens.push(res);
                    await delay(2000);
                }
                if (launchedTokens.length > 0) {
                    activeSessions.get(user.id).push({ serverId: backup.serverId, channelId: backup.channelId, tokens: launchedTokens });
                }
            }
            saveData();
            await interaction.editReply(`**<a:rSuccess:1494078302632149083> Restored, reset, and re-synchronized all active profile session routes safely!**`).catch(() => null);
        }
    }

    if (commandName === '247-stop') {
        const slot = options.getInteger('slot');
        const sessionIndex = slot - 1;

        if (!userSessions[sessionIndex]) {
            return interaction.reply({ content: `<a:rWarning:1494077439670878329> There is no running session allocated to Slot **${slot}**.`, ephemeral: true }).catch(() => null);
        }

        stopSpammerLoop(user.id, sessionIndex);
        userSessions[sessionIndex].tokens.forEach(t => {
            try {
                sendVoicePayload(t.selfClient, t.serverId, null);
                t.selfClient.destroy();
            } catch(e){}
        });

        userSessions.splice(sessionIndex, 1);
        saveData();
        return interaction.reply({ content: MESSAGES.slotStopped(slot), ephemeral: true }).catch(() => null);
    }

    if (commandName === '247-stopall') {
        if (userSessions.length === 0) return interaction.reply({ content: MESSAGES.noActiveSessions, ephemeral: true }).catch(() => null);
        
        userSessions.forEach((session, idx) => {
            stopSpammerLoop(user.id, idx);
            session.tokens.forEach(t => { 
                try { 
                    sendVoicePayload(t.selfClient, t.serverId, null);
                    t.selfClient.destroy(); 
                } catch(e){} 
            });
        });
        
        activeSessions.set(user.id, []);
        saveData();
        return interaction.reply({ content: MESSAGES.allStopped, ephemeral: true }).catch(() => null);
    }

    if (commandName === 'change-place') {
        await interaction.deferReply({ ephemeral: true }).catch(() => null);
        if (userSessions.length === 0) return interaction.editReply(MESSAGES.noActiveSessions).catch(() => null);

        const newServerId = options.getString('new-server-id');
        const newChannelId = options.getString('new-channel-id');
        const slotOpt = options.getInteger('slot');

        if (slotOpt) {
            const sessionIndex = slotOpt - 1;
            if (!userSessions[sessionIndex]) {
                return interaction.editReply(`<a:rWarning:1494077439670878329> Session slot **${slotOpt}** is not running.`).catch(() => null);
            }
            const session = userSessions[sessionIndex];
            session.serverId = newServerId;
            session.channelId = newChannelId;
            for (const t of session.tokens) {
                try {
                    sendVoicePayload(t.selfClient, newServerId, newChannelId, t.muted, t.deafened, t.camera);
                    try { t.selfClient.ws.broadcast(buildStreamPayload(newServerId, newChannelId, t.live)); } catch(e){}
                    t.serverId = newServerId; 
                    t.channelId = newChannelId;
                } catch (e) {}
            }
            saveData();
            return interaction.editReply(MESSAGES.slotRelocated(slotOpt)).catch(() => null);
        } else {
            for (const session of userSessions) {
                session.serverId = newServerId;
                session.channelId = newChannelId;
                for (const t of session.tokens) {
                    try {
                        sendVoicePayload(t.selfClient, newServerId, newChannelId, t.muted, t.deafened, t.camera);
                        try { t.selfClient.ws.broadcast(buildStreamPayload(newServerId, newChannelId, t.live)); } catch(e){}
                        t.serverId = newServerId; 
                        t.channelId = newChannelId;
                    } catch (e) {}
                }
            }
            saveData();
            return interaction.editReply(MESSAGES.allRelocated).catch(() => null);
        }
    }

    if (commandName === '247-mute') {
        if (userSessions.length === 0) return interaction.reply({ content: MESSAGES.noActiveSessions, ephemeral: true }).catch(() => null);
        const status = options.getBoolean('status');
        const targetSlot = options.getInteger('slot');

        userSessions.forEach((session, idx) => {
            if (!targetSlot || targetSlot === idx + 1) {
                session.tokens.forEach(t => {
                    t.muted = status;
                    sendVoicePayload(t.selfClient, t.serverId, t.channelId, status, t.deafened, t.camera);
                });
            }
        });
        return interaction.reply({ content: status ? MESSAGES.altMuted : MESSAGES.altUnmuted }).catch(() => null);
    }

    if (commandName === '247-deaf') {
        if (userSessions.length === 0) return interaction.reply({ content: MESSAGES.noActiveSessions, ephemeral: true }).catch(() => null);
        const status = options.getBoolean('status');
        const targetSlot = options.getInteger('slot');

        userSessions.forEach((session, idx) => {
            if (!targetSlot || targetSlot === idx + 1) {
                session.tokens.forEach(t => {
                    t.deafened = status;
                    sendVoicePayload(t.selfClient, t.serverId, t.channelId, t.muted, status, t.camera);
                });
            }
        });
        return interaction.reply({ content: status ? MESSAGES.altDeafened : MESSAGES.altUndeafened }).catch(() => null);
    }

    if (commandName === '247-camera') {
        if (userSessions.length === 0) return interaction.reply({ content: MESSAGES.noActiveSessions, ephemeral: true }).catch(() => null);
        const status = options.getBoolean('status');
        const targetSlot = options.getInteger('slot');

        userSessions.forEach((session, idx) => {
            if (!targetSlot || targetSlot === idx + 1) {
                session.tokens.forEach(t => {
                    t.camera = status;
                    sendVoicePayload(t.selfClient, t.serverId, t.channelId, t.muted, t.deafened, status);
                });
            }
        });
        return interaction.reply({ content: MESSAGES.cameraUpdated(status ? "on" : "off") }).catch(() => null);
    }

    if (commandName === '247-live-badge') {
        if (userSessions.length === 0) return interaction.reply({ content: MESSAGES.noActiveSessions, ephemeral: true }).catch(() => null);
        const status = options.getBoolean('status');
        const targetSlot = options.getInteger('slot');

        userSessions.forEach((session, idx) => {
            if (!targetSlot || targetSlot === idx + 1) {
                session.tokens.forEach(t => {
                    t.live = status;
                    try {
                        t.selfClient.ws.broadcast(buildStreamPayload(t.serverId, t.channelId, status));
                        sendVoicePayload(t.selfClient, t.serverId, t.channelId, t.muted, t.deafened, t.camera);
                    } catch(e){
                        console.error("Live stream state dispatch failure:", e);
                    }
                });
            }
        });
        return interaction.reply({ content: MESSAGES.liveUpdated(status ? "on" : "off") }).catch(() => null);
    }

    if (commandName === '247-status') {
        if (userSessions.length === 0) return interaction.reply({ content: MESSAGES.noActiveSessions, ephemeral: true }).catch(() => null);
        const statusType = options.getString('type');

        userSessions.forEach(session => {
            session.tokens.forEach(t => {
                try { t.selfClient.user.setStatus(statusType); } catch (e) {}
            });
        });

        const statusDisplayNames = { online: 'Online', idle: 'Idle', dnd: 'Do Not Disturb', invisible: 'Invisible' };
        return interaction.reply({ content: MESSAGES.statusUpdated(statusDisplayNames[statusType]) }).catch(() => null);
    }

    if (commandName === '247-rpc') {
        await interaction.deferReply({ ephemeral: true }).catch(() => null);
        if (userSessions.length === 0) return interaction.editReply(MESSAGES.noActiveSessions).catch(() => null);
        
        const activityType = options.getString('activity-type') || 'STREAMING';
        const name = options.getString('name') || "69";
        const state = options.getString('state') || null; // Subtext state line is null by default
        const url = options.getString('url') || "https://www.twitch.tv/discord";
        const customAppId = options.getString('application-id');
        
        const button1Name = options.getString('button-1-name') || "Join Discord Server";
        const button1Url = options.getString('button-1-url') || "https://discord.gg/3YfvJxNm9x";

        const currentLayout = savedRpcLayouts.get(user.id) || { largeImage: undefined, smallImage: undefined };

        savedRpcLayouts.set(user.id, {
            enabled: true,
            activityType,
            name,
            state,
            url,
            applicationId: customAppId,
            largeImage: currentLayout.largeImage,
            smallImage: currentLayout.smallImage,
            button1Name,
            button1Url
        });

        saveData();

        for (const session of userSessions) {
            for (const t of session.tokens) {
                await syncRichPresenceToClient(t);
            }
        }

        return interaction.editReply({ content: "🎮 **Rich Presence status configured for alts!**" });
    }

    if (commandName === '247-rpc-edit') {
        await interaction.deferReply({ ephemeral: true }).catch(() => null);
        if (userSessions.length === 0) return interaction.editReply(MESSAGES.noActiveSessions).catch(() => null);

        const savedLayout = savedRpcLayouts.get(user.id);
        if (!savedLayout) {
            return interaction.editReply({ content: "❌ No RPC session layout setup found. Run `/247-rpc` first to create one!" });
        }

        const nameOpt = options.getString('name');
        const stateOpt = options.getString('state');
        const urlOpt = options.getString('url');
        const btnNameOpt = options.getString('button-1-name');
        const btnUrlOpt = options.getString('button-1-url');

        if (nameOpt !== null) savedLayout.name = nameOpt;
        if (stateOpt !== null) savedLayout.state = stateOpt;
        if (urlOpt !== null) savedLayout.url = urlOpt;
        if (btnNameOpt !== null) savedLayout.button1Name = btnNameOpt;
        if (btnUrlOpt !== null) savedLayout.button1Url = btnUrlOpt;

        saveData();

        for (const session of userSessions) {
            for (const t of session.tokens) {
                await syncRichPresenceToClient(t);
            }
        }

        return interaction.editReply({ content: "📝 **Rich Presence properties updated and successfully synchronized.**" });
    }

    if (commandName === '247-rpc-toggle') {
        await interaction.deferReply({ ephemeral: true }).catch(() => null);
        if (userSessions.length === 0) return interaction.editReply(MESSAGES.noActiveSessions).catch(() => null);

        const status = options.getBoolean('status');
        const savedLayout = savedRpcLayouts.get(user.id);

        if (!savedLayout) {
            return interaction.editReply({ content: "❌ No saved RPC parameters found to toggle. Run `/247-rpc` first." });
        }

        savedLayout.enabled = status;
        saveData();

        for (const session of userSessions) {
            for (const t of session.tokens) {
                await syncRichPresenceToClient(t);
            }
        }

        return interaction.editReply({ content: status ? "🟢 Custom Rich Presence state turned **ON**." : "🔴 Custom Rich Presence state turned **OFF** (hidden)." });
    }

    if (commandName === '247-rpc-assets') {
        await interaction.deferReply({ ephemeral: true }).catch(() => null);
        if (userSessions.length === 0) return interaction.editReply(MESSAGES.noActiveSessions).catch(() => null);

        const savedLayout = savedRpcLayouts.get(user.id);
        if (!savedLayout) {
            return interaction.editReply({ content: "❌ Set up your text parameters with `/247-rpc` before mapping assets." });
        }

        const largeImgAttachment = options.getAttachment('large-image');
        const smallBadgeAttachment = options.getAttachment('small-badge');

        if (largeImgAttachment) savedLayout.largeImage = cleanRpcImageLink(largeImgAttachment.url);
        if (smallBadgeAttachment) savedLayout.smallImage = cleanRpcImageLink(smallBadgeAttachment.url);

        saveData();

        for (const session of userSessions) {
            for (const t of session.tokens) {
                await syncRichPresenceToClient(t);
            }
        }

        return interaction.editReply({ content: "🖼️ **Gallery assets matched and linked straight into your active profiles successfully!**" });
    }

    if (commandName === '247-spammer') {
        if (userSessions.length === 0) return interaction.reply({ content: MESSAGES.noActiveSessions, ephemeral: true }).catch(() => null);
        
        const status = options.getBoolean('status');
        const slot = options.getInteger('slot') || 1;
        const sessionIndex = slot - 1;

        if (status === false) {
            stopSpammerLoop(user.id, sessionIndex);
            return interaction.reply({ content: MESSAGES.spammerUpdated("disabled") }).catch(() => null);
        }

        const text = options.getString('text');
        const targetChannelId = options.getString('channel-id');
        const delayMs = options.getInteger('delay');

        if (!text || !targetChannelId || !delayMs) {
            return interaction.reply({ content: "❌ Missing arguments! When enabling (`status: True`), you must fill text, channel-id, and delay configuration metrics.", ephemeral: true }).catch(() => null);
        }

        if (!userSessions[sessionIndex]) {
            return interaction.reply({ content: `<a:rWarning:1494077439670878329> Slot ${slot} does not contain an active session.`, ephemeral: true }).catch(() => null);
        }

        startSpammerLoop(user.id, sessionIndex, userSessions[sessionIndex].tokens, text, targetChannelId, delayMs);
        return interaction.reply({ content: MESSAGES.spammerUpdated("active") }).catch(() => null);
    }

    if (commandName === 'stats') {
        if (userSessions.length === 0) return interaction.reply({ content: MESSAGES.noActiveSessions, ephemeral: true }).catch(() => null);
        let resText = `📊 **Your Active Sessions (${userSessions.length}/4):**\n\n`;
        
        userSessions.forEach((session, sIdx) => {
            resText += `__**Session Slot ${sIdx + 1}:**__\n`;
            session.tokens.forEach((t, tIdx) => {
                const gName = t.selfClient.guilds.cache.get(t.serverId)?.name || "Unknown Server";
                const cName = t.selfClient.channels.cache.get(t.channelId)?.name || "Unknown Channel";
                resText += `<a:rArrow:1493252548826763275> Account ${tIdx + 1}: **${t.username}** | Voice: \`${cName}\` | Server: \`${gName}\`\n`;
            });
            resText += `\n`;
        });
        
        return interaction.reply({ content: resText, ephemeral: true }).catch(() => null);
    }
});

mainBot.login(process.env.DISCORD_TOKEN);
