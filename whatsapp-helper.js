const { Client, LocalAuth } = require('whatsapp-web.js');

// Enhanced WhatsApp client configuration for stability
function createStableWhatsAppClient(userId, sessionPath = './sessions') {
    return new Client({
        authStrategy: new LocalAuth({
            clientId: `user_${userId}`,
            dataPath: sessionPath
        }),
        puppeteer: {
            headless: true,
            args: [
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--disable-dev-shm-usage',
                '--disable-extensions',
                '--no-first-run',
                '--disable-default-apps',
                '--disable-background-timer-throttling',
                '--disable-backgrounding-occluded-windows',
                '--disable-renderer-backgrounding',
                '--disable-features=TranslateUI',
                '--disable-ipc-flooding-protection',
                '--no-zygote',
                '--single-process',
                '--disable-web-security',
                '--disable-features=VizDisplayCompositor'
            ],
            handleSIGINT: false,
            handleSIGTERM: false,
            handleSIGHUP: false
        },
        webVersionCache: {
            type: 'remote',
            remotePath: 'https://raw.githubusercontent.com/wppconnect-team/wa-version/main/html/2.2412.54.html',
        }
    });
}

// Keepalive function to prevent disconnection
function startConnectionKeepalive(userId, client, intervalMs = 30000) {
    const interval = setInterval(async () => {
        try {
            if (client && client.pupPage && !client.pupPage.isClosed()) {
                // Send heartbeat by checking client state
                await client.getState();
                console.log(`Keepalive ping successful for user ${userId}`);
            } else {
                console.log(`Client not available for keepalive: ${userId}`);
                clearInterval(interval);
            }
        } catch (error) {
            console.log(`Keepalive failed for user ${userId}:`, error.message);
            clearInterval(interval);
        }
    }, intervalMs);

    return interval;
}

// Auto-reconnect function
async function setupAutoReconnect(client, userId, maxRetries = 3) {
    let reconnectAttempts = 0;

    client.on('disconnected', async (reason) => {
        console.log(`Client disconnected for user ${userId}. Reason: ${reason}`);

        if (reconnectAttempts < maxRetries) {
            reconnectAttempts++;
            console.log(`Attempting to reconnect... (${reconnectAttempts}/${maxRetries})`);

            setTimeout(async () => {
                try {
                    await client.initialize();
                    console.log(`Reconnection successful for user ${userId}`);
                    reconnectAttempts = 0; // Reset counter on success
                } catch (error) {
                    console.log(`Reconnection failed for user ${userId}:`, error.message);
                }
            }, 5000 * reconnectAttempts); // Exponential backoff
        } else {
            console.log(`Max reconnection attempts reached for user ${userId}`);
        }
    });
}

// Session backup and restore
async function backupSession(client, userId) {
    try {
        const session = await client.getSession();
        if (session) {
            // Save session to file or database
            const fs = require('fs').promises;
            await fs.writeFile(`./sessions/backup_${userId}.json`, JSON.stringify(session));
            console.log(`Session backed up for user ${userId}`);
        }
    } catch (error) {
        console.log(`Session backup failed for user ${userId}:`, error.message);
    }
}

module.exports = {
    createStableWhatsAppClient,
    startConnectionKeepalive,
    setupAutoReconnect,
    backupSession
};