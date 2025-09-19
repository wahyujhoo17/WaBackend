-- Migration to add whatsapp_connected column to users table
-- Run this in Supabase SQL Editor

-- Add whatsapp_connected column to track active WhatsApp connections
ALTER TABLE users ADD COLUMN whatsapp_connected BOOLEAN DEFAULT FALSE;

-- Add index for better query performance
CREATE INDEX idx_users_whatsapp_connected ON users(whatsapp_connected);

-- Update existing users to have whatsapp_connected = false by default
-- (This is already handled by the DEFAULT FALSE above)

-- Optional: Add a comment to document the column
COMMENT ON COLUMN users.whatsapp_connected IS 'Indicates if the user has an active WhatsApp Web connection';