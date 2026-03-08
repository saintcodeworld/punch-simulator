-- =====================================================
-- PUNCH SIMULATOR - SUPABASE SCHEMA
-- Run this in Supabase SQL Editor (https://supabase.com/dashboard)
-- =====================================================

-- Users table (stores wallet + auth info)
CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  username TEXT UNIQUE NOT NULL,
  public_key TEXT UNIQUE NOT NULL,
  private_key_encrypted TEXT NOT NULL,
  total_wins INTEGER DEFAULT 0,
  total_losses INTEGER DEFAULT 0,
  total_kills INTEGER DEFAULT 0,
  total_damage INTEGER DEFAULT 0,
  games_played INTEGER DEFAULT 0,
  rating INTEGER DEFAULT 1000,
  sol_earned NUMERIC(10,4) DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Lobbies table
CREATE TABLE IF NOT EXISTS lobbies (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  mode TEXT NOT NULL CHECK (mode IN ('1v1', '2v2', '3v3')),
  max_players INTEGER NOT NULL,
  current_players INTEGER DEFAULT 0,
  status TEXT DEFAULT 'waiting' CHECK (status IN ('waiting', 'playing', 'finished')),
  created_by UUID REFERENCES users(id),
  winner_team INTEGER,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  started_at TIMESTAMPTZ,
  finished_at TIMESTAMPTZ
);

-- Lobby players (who is in which lobby)
CREATE TABLE IF NOT EXISTS lobby_players (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  lobby_id UUID REFERENCES lobbies(id) ON DELETE CASCADE,
  user_id UUID REFERENCES users(id),
  team INTEGER NOT NULL DEFAULT 1,
  is_ready BOOLEAN DEFAULT FALSE,
  joined_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(lobby_id, user_id)
);

-- Game history (per-game stats for each player)
CREATE TABLE IF NOT EXISTS game_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  lobby_id UUID REFERENCES lobbies(id),
  user_id UUID REFERENCES users(id),
  mode TEXT NOT NULL,
  team INTEGER NOT NULL,
  kills INTEGER DEFAULT 0,
  damage_dealt INTEGER DEFAULT 0,
  survived BOOLEAN DEFAULT FALSE,
  won BOOLEAN DEFAULT FALSE,
  rating_change INTEGER DEFAULT 0,
  played_at TIMESTAMPTZ DEFAULT NOW()
);

-- Leaderboard view (top players by wins, recalculated)
CREATE OR REPLACE VIEW leaderboard AS
SELECT
  u.id,
  u.username,
  u.public_key,
  u.total_wins,
  u.total_losses,
  u.total_kills,
  u.total_damage,
  u.games_played,
  u.rating,
  u.sol_earned,
  RANK() OVER (ORDER BY u.total_wins DESC, u.rating DESC) as rank
FROM users u
WHERE u.games_played > 0
ORDER BY u.total_wins DESC, u.rating DESC;

-- Enable RLS (Row Level Security)
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE lobbies ENABLE ROW LEVEL SECURITY;
ALTER TABLE lobby_players ENABLE ROW LEVEL SECURITY;
ALTER TABLE game_history ENABLE ROW LEVEL SECURITY;

-- Policies: allow all operations via anon key (server-side management)
CREATE POLICY "Allow all for users" ON users FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all for lobbies" ON lobbies FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all for lobby_players" ON lobby_players FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all for game_history" ON game_history FOR ALL USING (true) WITH CHECK (true);

-- User balances (internal SOL balance for deposits/withdrawals)
ALTER TABLE users ADD COLUMN IF NOT EXISTS balance NUMERIC(10,6) DEFAULT 0;

-- Lobbies: add entry_fee and prize_pool columns
ALTER TABLE lobbies ADD COLUMN IF NOT EXISTS entry_fee NUMERIC(10,6) DEFAULT 0;
ALTER TABLE lobbies ADD COLUMN IF NOT EXISTS prize_pool NUMERIC(10,6) DEFAULT 0;

-- Transactions table (deposit/withdraw history)
CREATE TABLE IF NOT EXISTS transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id),
  type TEXT NOT NULL CHECK (type IN ('deposit', 'withdraw', 'entry_fee', 'prize_win', 'refund')),
  amount NUMERIC(10,6) NOT NULL,
  tx_signature TEXT,
  status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'confirmed', 'failed')),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Enable RLS for transactions
ALTER TABLE transactions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow all for transactions" ON transactions FOR ALL USING (true) WITH CHECK (true);

-- Pumpfun buy log
CREATE TABLE IF NOT EXISTS pumpfun_buys (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  lobby_id UUID REFERENCES lobbies(id),
  tx_signature TEXT,
  amount_sol NUMERIC(10,6) DEFAULT 0.01,
  token_address TEXT,
  status TEXT DEFAULT 'pending',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE pumpfun_buys ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow all for pumpfun_buys" ON pumpfun_buys FOR ALL USING (true) WITH CHECK (true);

-- Index for fast leaderboard queries
CREATE INDEX IF NOT EXISTS idx_users_wins ON users(total_wins DESC);
CREATE INDEX IF NOT EXISTS idx_users_rating ON users(rating DESC);
CREATE INDEX IF NOT EXISTS idx_game_history_user ON game_history(user_id);
CREATE INDEX IF NOT EXISTS idx_lobbies_status ON lobbies(status);
CREATE INDEX IF NOT EXISTS idx_transactions_user ON transactions(user_id);
CREATE INDEX IF NOT EXISTS idx_pumpfun_buys_lobby ON pumpfun_buys(lobby_id);
