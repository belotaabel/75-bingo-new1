CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS users (
  id BIGSERIAL PRIMARY KEY,
  telegram_id BIGINT UNIQUE NOT NULL,
  username TEXT,
  display_name TEXT NOT NULL,
  phone TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS games (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  status TEXT NOT NULL DEFAULT 'selecting' CHECK (status IN ('selecting', 'playing', 'finished')),
  prize_pool NUMERIC(12, 2) NOT NULL DEFAULT 0,
  called_numbers INTEGER[] NOT NULL DEFAULT '{}',
  current_number INTEGER,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS game_cards (
  id BIGSERIAL PRIMARY KEY,
  game_id UUID NOT NULL REFERENCES games(id) ON DELETE CASCADE,
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  card_number INTEGER NOT NULL,
  purchased_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (game_id, card_number)
);

CREATE TABLE IF NOT EXISTS winners (
  id BIGSERIAL PRIMARY KEY,
  game_id UUID NOT NULL REFERENCES games(id) ON DELETE CASCADE,
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  card_number INTEGER NOT NULL,
  prize_amount NUMERIC(12, 2) NOT NULL,
  winning_rows INTEGER[] NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS game_cards_game_id_idx ON game_cards(game_id);
CREATE INDEX IF NOT EXISTS winners_game_id_idx ON winners(game_id);
