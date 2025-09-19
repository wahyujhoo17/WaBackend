-- Migrasi untuk menambahkan tabel statistik dan system status
-- Jalankan query ini di Supabase SQL Editor

-- Tabel untuk menyimpan statistik sistem
CREATE TABLE system_stats (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  metric_name TEXT UNIQUE NOT NULL,
  metric_value INTEGER NOT NULL,
  updated_at TIMESTAMP DEFAULT NOW()
);

-- Tabel untuk menyimpan status sistem
CREATE TABLE system_health (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  service_name TEXT UNIQUE NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('online', 'offline', 'warning')),
  last_check TIMESTAMP DEFAULT NOW(),
  response_time INTEGER, -- dalam milliseconds
  details JSONB
);

-- Insert data awal untuk statistik
INSERT INTO system_stats (metric_name, metric_value) VALUES
  ('total_messages_today', 0),
  ('active_connections', 0),
  ('total_users', 0),
  ('uptime_percentage', 999); -- 99.9%

-- Insert data awal untuk system health
INSERT INTO system_health (service_name, status, response_time, details) VALUES
  ('api_server', 'online', 45, '{"version": "1.0.0", "uptime": "24h"}'),
  ('database', 'online', 12, '{"connections": 5, "latency": "12ms"}'),
  ('whatsapp_service', 'online', 89, '{"sessions": 2, "ready": true}');

-- Enable RLS untuk tabel baru
ALTER TABLE system_stats ENABLE ROW LEVEL SECURITY;
ALTER TABLE system_health ENABLE ROW LEVEL SECURITY;