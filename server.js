require('dotenv').config();
console.log('Server starting...');

// Check for required environment variables
const requiredEnvVars = ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY'];
const missingEnvVars = requiredEnvVars.filter(envVar => !process.env[envVar]);

if (missingEnvVars.length > 0) {
    console.error('❌ Missing required environment variables:', missingEnvVars);
    process.exit(1);
}

console.log('✅ Environment variables loaded');

const express = require('express');
const cors = require('cors');
const bcrypt = require('bcrypt');
const { createClient } = require('@supabase/supabase-js');
const { Client } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const QRCode = require('qrcode');

const app = express();

// Configure CORS to allow requests from frontend
const corsOptions = {
    origin: [
        'http://localhost:3000',
        'https://localhost:3000',
        'https://wa-backend-ochre.vercel.app',
        'https://*.vercel.app',
        'https://*.railway.app',
        process.env.RAILWAY_PUBLIC_DOMAIN ? `https://${process.env.RAILWAY_PUBLIC_DOMAIN}` : null,
        process.env.RAILWAY_STATIC_URL || null
    ].filter(Boolean),
    credentials: true,
    optionsSuccessStatus: 200,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'x-api-key']
};

app.use(cors(corsOptions));
app.use(express.json());

// Create Supabase client with service role key (bypasses RLS)
const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
    {
        auth: {
            autoRefreshToken: false,
            persistSession: false
        }
    }
);

// Test database connection on startup
async function testDatabaseConnection() {
    try {
        console.log('🔍 Testing database connection...');
        const { data, error } = await supabase
            .from('users')
            .select('count')
            .limit(1);

        if (error) {
            console.error('❌ Database connection failed:', error.message);
            return false;
        }

        console.log('✅ Database connection successful');
        return true;
    } catch (err) {
        console.error('❌ Database connection error:', err.message);
        return false;
    }
}

// Store WhatsApp clients per user
const whatsappClients = new Map();

// Store QR code per user
const qrCodes = new Map();

// Middleware to verify API key
const verifyApiKey = async (req, res, next) => {
    const apiKey = req.headers['x-api-key'];
    if (!apiKey) return res.status(401).json({ error: 'API key required' });

    const { data, error } = await supabase
        .from('users')
        .select('*')
        .eq('api_key', apiKey)
        .single();

    if (error || !data) return res.status(401).json({ error: 'Invalid API key' });

    req.user = data;
    next();
};

// Endpoint to generate QR code for specific user (admin only)
app.get('/admin/qr/:userId', async (req, res) => {
    try {
        const { userId } = req.params;

        // Verify user exists
        const { data: user, error: userError } = await supabase
            .from('users')
            .select('*')
            .eq('id', userId)
            .single();

        if (userError || !user) {
            return res.status(404).json({ error: 'User not found' });
        }

        // Check if we already have QR for this user
        let qr = qrCodes.get(userId);

        if (!qr) {
            // Create a new WhatsApp client to generate QR
            const client = new Client({
                puppeteer: {
                    headless: true,
                    args: ['--no-sandbox', '--disable-setuid-sandbox']
                }
            });

            // Store client
            whatsappClients.set(userId, client);

            // Handle QR generation
            client.on('qr', async (qrData) => {
                try {
                    // Convert QR string to base64 image
                    const qrImageBase64 = await QRCode.toDataURL(qrData);
                    // Remove the data:image/png;base64, prefix to store only base64 string
                    const base64String = qrImageBase64.replace(/^data:image\/png;base64,/, '');
                    qrCodes.set(userId, base64String);
                } catch (qrError) {
                    console.error('Error converting QR to base64:', qrError);
                    qrCodes.set(userId, qrData); // Fallback to original string
                }
            });

            client.on('ready', async () => {
                // Update whatsapp_connected status
                try {
                    await supabase
                        .from('users')
                        .update({ whatsapp_connected: true })
                        .eq('id', userId);
                } catch (error) {
                    console.error('Error updating whatsapp_connected status:', error);
                }
            });

            client.on('auth_failure', async () => {
                // Update whatsapp_connected status to false
                try {
                    await supabase
                        .from('users')
                        .update({ whatsapp_connected: false })
                        .eq('id', userId);
                } catch (error) {
                    console.error('Error updating whatsapp_connected status:', error);
                }
            });

            client.on('disconnected', async (reason) => {
                // Update whatsapp_connected status to false
                try {
                    await supabase
                        .from('users')
                        .update({ whatsapp_connected: false })
                        .eq('id', userId);
                } catch (error) {
                    console.error('Error updating whatsapp_connected status:', error);
                }
            });

            // Initialize client
            try {
                await client.initialize();
            } catch (initError) {
                console.error('Client initialization error for user', userId, ':', initError);
                return res.status(500).json({ error: 'Failed to initialize WhatsApp client' });
            }

            // Wait for QR to be generated (max 30 seconds)
            let attempts = 0;
            while (!qr && attempts < 30) {
                await new Promise(resolve => setTimeout(resolve, 1000));
                qr = qrCodes.get(userId);
                attempts++;
            }

            if (!qr) {
                return res.status(408).json({
                    error: 'QR code generation timeout',
                    message: 'Please try again. Make sure WhatsApp Web is not already open elsewhere.'
                });
            }
        }

        res.json({
            qr: qr,
            userId: userId,
            userEmail: user.email,
            userWhatsapp: user.whatsapp_number,
            message: `QR code for ${user.email}`,
            instructions: '1. Open WhatsApp on phone\n2. Go to Settings > Linked Devices\n3. Tap "Link a Device"\n4. Scan this QR code'
        });
    } catch (err) {
        console.error('QR generation error for user:', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Test endpoint for database connection
app.get('/admin/test-db', async (req, res) => {
    try {
        const { data, error } = await supabase
            .from('users')
            .select('count')
            .limit(1);

        if (error) {
            console.error('Database test error:', error);
            return res.status(500).json({ error: error.message });
        }

        res.json({ success: true, data });
    } catch (err) {
        console.error('Database test exception:', err);
        res.status(500).json({ error: err.message });
    }
});

// Endpoint for user to generate their own QR code (authenticated with API key)
app.get('/my-qr', verifyApiKey, async (req, res) => {
    try {
        const userId = req.user.id;

        // Check if we already have QR for this user
        let qr = qrCodes.get(userId);

        if (!qr) {
            // Create a new WhatsApp client to generate QR
            const client = new Client({
                puppeteer: {
                    headless: true,
                    args: ['--no-sandbox', '--disable-setuid-sandbox']
                }
            });

            // Store client
            whatsappClients.set(userId, client);

            // Handle QR generation
            client.on('qr', async (qrData) => {
                try {
                    // Convert QR string to base64 image
                    const qrImageBase64 = await QRCode.toDataURL(qrData);
                    // Remove the data:image/png;base64, prefix to store only base64 string
                    const base64String = qrImageBase64.replace(/^data:image\/png;base64,/, '');
                    qrCodes.set(userId, base64String);
                } catch (qrError) {
                    console.error('Error converting QR to base64:', qrError);
                    qrCodes.set(userId, qrData); // Fallback to original string
                }
            });

            client.on('ready', async () => {
                // Update whatsapp_connected status
                try {
                    await supabase
                        .from('users')
                        .update({ whatsapp_connected: true })
                        .eq('id', userId);
                } catch (error) {
                    console.error('Error updating whatsapp_connected status:', error);
                }
            });

            client.on('auth_failure', async () => {
                // Update whatsapp_connected status to false
                try {
                    await supabase
                        .from('users')
                        .update({ whatsapp_connected: false })
                        .eq('id', userId);
                } catch (error) {
                    console.error('Error updating whatsapp_connected status:', error);
                }
            });

            client.on('disconnected', async (reason) => {
                // Update whatsapp_connected status to false
                try {
                    await supabase
                        .from('users')
                        .update({ whatsapp_connected: false })
                        .eq('id', userId);
                } catch (error) {
                    console.error('Error updating whatsapp_connected status:', error);
                }
            });

            // Initialize client
            try {
                await client.initialize();
            } catch (initError) {
                console.error('Client initialization error for user', userId, ':', initError);
                return res.status(500).json({ error: 'Failed to initialize WhatsApp client' });
            }

            // Wait for QR to be generated (max 30 seconds)
            let attempts = 0;
            while (!qr && attempts < 30) {
                await new Promise(resolve => setTimeout(resolve, 1000));
                qr = qrCodes.get(userId);
                attempts++;
            }

            if (!qr) {
                return res.status(408).json({
                    error: 'QR code generation timeout',
                    message: 'Please try again. Make sure WhatsApp Web is not already open elsewhere.'
                });
            }
        }

        res.json({
            qr: qr,
            userId: userId,
            message: 'Scan this QR code with WhatsApp mobile app',
            instructions: '1. Open WhatsApp on your phone\n2. Go to Settings > Linked Devices\n3. Tap "Link a Device"\n4. Scan this QR code'
        });
    } catch (err) {
        console.error('QR generation error for user:', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Endpoint to get all users (for admin dashboard)
app.get('/admin/users', async (req, res) => {
    try {
        const { data, error } = await supabase
            .from('users')
            .select('*')
            .order('created_at', { ascending: false });

        if (error) {
            console.error('Error fetching users:', error);
            return res.status(500).json({ error: error.message });
        }

        res.json({ users: data || [] });
    } catch (err) {
        console.error('Server error fetching users:', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Endpoint to update user (for admin)
app.put('/admin/users/:userId', async (req, res) => {
    try {
        const { userId } = req.params;
        const { email, whatsappNumber } = req.body;

        if (!email) return res.status(400).json({ error: 'Email required' });

        const { data, error } = await supabase
            .from('users')
            .update({
                email,
                whatsapp_number: whatsappNumber
            })
            .eq('id', userId)
            .select();

        if (error) {
            console.error('Error updating user:', error);
            return res.status(500).json({ error: error.message });
        }

        if (!data || data.length === 0) {
            return res.status(404).json({ error: 'User not found' });
        }

        res.json({ user: data[0] });
    } catch (err) {
        console.error('Server error updating user:', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Endpoint to delete user (for admin)
app.delete('/admin/users/:userId', async (req, res) => {
    try {
        const { userId } = req.params;

        const { data, error } = await supabase
            .from('users')
            .delete()
            .eq('id', userId)
            .select();

        if (error) {
            console.error('Error deleting user:', error);
            return res.status(500).json({ error: error.message });
        }

        if (!data || data.length === 0) {
            return res.status(404).json({ error: 'User not found' });
        }

        res.json({ message: 'User deleted successfully' });
    } catch (err) {
        console.error('Server error deleting user:', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Endpoint to generate API key (for admin)
app.post('/admin/generate-api-key', async (req, res) => {
    try {
        const { email, whatsappNumber } = req.body;
        if (!email) return res.status(400).json({ error: 'Email required' });

        const apiKey = bcrypt.hashSync(Math.random().toString(), 10).replace(/\//g, '');

        // Use insert with upsert and bypass RLS with service role
        const { data, error } = await supabase
            .from('users')
            .upsert({
                email,
                api_key: apiKey,
                whatsapp_number: whatsappNumber
            }, {
                onConflict: 'email',
                ignoreDuplicates: false
            })
            .select();

        if (error) {
            console.error('Supabase error:', error);
            return res.status(500).json({ error: error.message });
        }

        res.json({ apiKey, user: data[0] });
    } catch (err) {
        console.error('Server error:', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Endpoint to send message (requires API key)
app.post('/send-message', verifyApiKey, async (req, res) => {
    const { to, message } = req.body;
    if (!to || !message) return res.status(400).json({ error: 'To and message required' });

    const userId = req.user.id;
    let client = whatsappClients.get(userId);

    if (!client) {
        client = new Client({ session: req.user.session_data });
        whatsappClients.set(userId, client);

        client.on('qr', qr => {
            qrCodes.set(userId, qr);
            qrcode.generate(qr, { small: true });
        });

        client.on('ready', async () => {
            // Update whatsapp_connected status
            try {
                await supabase
                    .from('users')
                    .update({ whatsapp_connected: true })
                    .eq('id', userId);
            } catch (error) {
                console.error('Error updating whatsapp_connected status:', error);
            }
        });

        client.on('disconnected', async (reason) => {
            // Update whatsapp_connected status to false
            try {
                await supabase
                    .from('users')
                    .update({ whatsapp_connected: false })
                    .eq('id', userId);
            } catch (error) {
                console.error('Error updating whatsapp_connected status:', error);
            }
        });

        await client.initialize();
    }

    try {
        await client.sendMessage(to + '@c.us', message);
        await supabase.from('logs').insert([{ user_id: userId, action: 'send_message', details: { to, message } }]);
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Endpoint to get system statistics
app.get('/admin/stats', async (req, res) => {
    try {
        // Get total users count
        const { data: usersData, error: usersError } = await supabase
            .from('users')
            .select('id', { count: 'exact' });

        if (usersError) {
            console.error('Error fetching users count:', usersError);
        }

        // Get active connections (users with whatsapp_connected = true)
        const { data: activeUsers, error: activeError } = await supabase
            .from('users')
            .select('id')
            .eq('whatsapp_connected', true);

        if (activeError) {
            console.error('Error fetching active users:', activeError);
        }

        // Get today's messages from logs
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const { data: messagesData, error: messagesError } = await supabase
            .from('logs')
            .select('id', { count: 'exact' })
            .eq('action', 'send_message')
            .gte('timestamp', today.toISOString());

        if (messagesError) {
            console.error('Error fetching messages count:', messagesError);
        }

        // Calculate uptime (simplified - in production you'd track this)
        const uptime = 99.9; // This would be calculated from actual system metrics

        const stats = {
            totalUsers: usersData ? usersData.length : 0,
            activeConnections: activeUsers ? activeUsers.length : 0,
            messagesDay: messagesData ? messagesData.length : 0,
            uptime: `${uptime}%`
        };

        res.json(stats);
    } catch (err) {
        console.error('Server error fetching stats:', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Endpoint to get system health status
app.get('/admin/health', async (req, res) => {
    try {
        const healthChecks = [];

        // Check database connection
        try {
            const start = Date.now();
            const { data, error } = await supabase
                .from('users')
                .select('id')
                .limit(1);
            const responseTime = Date.now() - start;

            healthChecks.push({
                service: 'Database',
                status: error ? 'offline' : 'online',
                responseTime: responseTime,
                details: error ? error.message : `${responseTime}ms`
            });
        } catch (err) {
            healthChecks.push({
                service: 'Database',
                status: 'offline',
                responseTime: null,
                details: err.message
            });
        }

        // Check WhatsApp service (check if any clients are connected)
        const whatsappStatus = whatsappClients.size > 0 ? 'online' : 'warning';
        healthChecks.push({
            service: 'WhatsApp Service',
            status: whatsappStatus,
            responseTime: null,
            details: `${whatsappClients.size} active sessions`
        });

        // API Server status (always online if this endpoint is reached)
        healthChecks.push({
            service: 'API Server',
            status: 'online',
            responseTime: 0,
            details: 'Request processed successfully'
        });

        res.json({ services: healthChecks });
    } catch (err) {
        console.error('Server error in health check:', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Root endpoint
app.get('/', (req, res) => {
    res.json({
        status: 'ok',
        message: 'WhatsApp API Backend is running',
        version: '1.0.0',
        endpoints: {
            'GET /': 'API status',
            'GET /health-check': 'Health check',
            'GET /admin/qr/:userId': 'Generate QR for user (admin)',
            'GET /my-qr': 'Generate QR for authenticated user',
            'GET /admin/test-db': 'Test database connection'
        }
    });
});

// Health check endpoint
app.get('/health-check', (req, res) => {
    res.json({
        status: 'healthy',
        timestamp: new Date().toISOString(),
        uptime: process.uptime(),
        memory: process.memoryUsage(),
        version: '1.0.0'
    });
});

const PORT = process.env.PORT || 3001;

// Start server with database connection test
async function startServer() {
    const dbConnected = await testDatabaseConnection();

    if (!dbConnected) {
        console.error('❌ Failed to connect to database. Server will not start.');
        process.exit(1);
    }

    app.listen(PORT, () => {
        console.log(`🚀 WhatsApp API Backend is running on port ${PORT}`);
        console.log(`📱 API endpoints available at http://localhost:${PORT}`);
        console.log('✅ Server started successfully');
        console.log('\n📋 Available endpoints:');
        console.log(`   GET  http://localhost:${PORT}/`);
        console.log(`   GET  http://localhost:${PORT}/health-check`);
        console.log(`   GET  http://localhost:${PORT}/admin/qr/:userId`);
        console.log(`   GET  http://localhost:${PORT}/my-qr`);
        console.log(`   GET  http://localhost:${PORT}/admin/test-db`);
        console.log(`   GET  http://localhost:${PORT}/admin/users`);
        console.log(`   POST http://localhost:${PORT}/admin/generate-api-key`);
        console.log(`   POST http://localhost:${PORT}/send-message`);
    });
}

startServer().catch(err => {
    console.error('❌ Failed to start server:', err);
    process.exit(1);
});