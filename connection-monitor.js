const rateLimit = require('express-rate-limit');
const NodeCache = require('node-cache');

// Cache untuk menyimpan status koneksi
const connectionCache = new NodeCache({ stdTTL: 300 }); // 5 menit

// Rate limiting untuk send message
const sendMessageLimiter = rateLimit({
    windowMs: 60 * 1000, // 1 menit
    max: 10, // maksimal 10 pesan per menit per IP
    message: {
        error: 'Too many messages sent',
        message: 'Please wait before sending another message',
        retryAfter: '60 seconds'
    },
    standardHeaders: true,
    legacyHeaders: false,
});

// Rate limiting untuk QR generation
const qrLimiter = rateLimit({
    windowMs: 2 * 60 * 1000, // 2 menit
    max: 3, // maksimal 3 QR generation per 2 menit
    message: {
        error: 'Too many QR requests',
        message: 'Please wait before generating another QR code'
    }
});

// Connection health monitoring
class ConnectionMonitor {
    constructor() {
        this.connections = new Map();
        this.healthCheckInterval = null;
        this.startHealthCheck();
    }

    addConnection(userId, client) {
        this.connections.set(userId, {
            client,
            lastSeen: Date.now(),
            isHealthy: true,
            reconnectAttempts: 0
        });
    }

    removeConnection(userId) {
        this.connections.delete(userId);
        connectionCache.del(`health_${userId}`);
    }

    updateLastSeen(userId) {
        const conn = this.connections.get(userId);
        if (conn) {
            conn.lastSeen = Date.now();
            conn.isHealthy = true;
        }
    }

    startHealthCheck() {
        this.healthCheckInterval = setInterval(async () => {
            for (const [userId, conn] of this.connections.entries()) {
                try {
                    const state = await conn.client.getState();
                    const isHealthy = state === 'CONNECTED';

                    conn.isHealthy = isHealthy;
                    connectionCache.set(`health_${userId}`, {
                        state,
                        isHealthy,
                        lastCheck: Date.now()
                    });

                    if (!isHealthy) {
                        console.log(`Connection unhealthy for user ${userId}: ${state}`);
                    }
                } catch (error) {
                    conn.isHealthy = false;
                    connectionCache.set(`health_${userId}`, {
                        state: 'ERROR',
                        isHealthy: false,
                        lastCheck: Date.now(),
                        error: error.message
                    });
                    console.log(`Health check failed for user ${userId}:`, error.message);
                }
            }
        }, 30000); // Check every 30 seconds
    }

    getConnectionHealth(userId) {
        return connectionCache.get(`health_${userId}`) || {
            state: 'UNKNOWN',
            isHealthy: false,
            lastCheck: null
        };
    }

    stop() {
        if (this.healthCheckInterval) {
            clearInterval(this.healthCheckInterval);
        }
    }
}

// Message queue untuk handling high volume
class MessageQueue {
    constructor() {
        this.queues = new Map();
        this.processing = new Map();
    }

    addMessage(userId, message) {
        if (!this.queues.has(userId)) {
            this.queues.set(userId, []);
        }

        const queue = this.queues.get(userId);
        queue.push({
            ...message,
            timestamp: Date.now(),
            id: Date.now() + Math.random()
        });

        // Start processing if not already running
        if (!this.processing.get(userId)) {
            this.processQueue(userId);
        }
    }

    async processQueue(userId) {
        this.processing.set(userId, true);
        const queue = this.queues.get(userId) || [];

        while (queue.length > 0) {
            const message = queue.shift();
            try {
                // Process message here
                await this.sendMessage(userId, message);
                console.log(`Message processed for user ${userId}:`, message.id);

                // Wait 2 seconds between messages to avoid being blocked
                await new Promise(resolve => setTimeout(resolve, 2000));
            } catch (error) {
                console.log(`Message failed for user ${userId}:`, error.message);
                // Could implement retry logic here
            }
        }

        this.processing.set(userId, false);
    }

    async sendMessage(userId, message) {
        // This would be called from the main server file
        // Implementation depends on the client instance
        throw new Error('sendMessage must be implemented');
    }
}

module.exports = {
    sendMessageLimiter,
    qrLimiter,
    ConnectionMonitor,
    MessageQueue,
    connectionCache
};