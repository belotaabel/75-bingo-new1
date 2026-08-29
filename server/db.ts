import { Pool } from "pg";

export const db = process.env.DATABASE_URL
  ? new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } })
  : null;

export type GameType = "75";
export type BingoCardRecord = { card_number: number; rows: number[][]; game_type?: GameType };

const bingo75Ranges = [[1, 15], [16, 30], [31, 45], [46, 60], [61, 75]] as const;

function build75Card(cardNumber: number): BingoCardRecord {
  const rows = Array.from({ length: 5 }, (_, row) => bingo75Ranges.map(([min, max], col) => row === 2 && col === 2 ? 0 : min + ((cardNumber * 13 + row * 7 + col * 3) % (max - min + 1))));
  return { card_number: cardNumber, rows, game_type: "75" };
}


export async function initializeDatabase() {
  if (!db) return;
  const schemaSql = `
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
      game_type TEXT NOT NULL DEFAULT '75',
      status TEXT NOT NULL DEFAULT 'selecting' CHECK (status IN ('selecting', 'finalizing', 'playing', 'finished')),
      prize_pool NUMERIC(12, 2) NOT NULL DEFAULT 0,
      called_numbers INTEGER[] NOT NULL DEFAULT '{}',
      current_number INTEGER,
      selecting_started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      finished_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    ALTER TABLE games ADD COLUMN IF NOT EXISTS game_type TEXT NOT NULL DEFAULT '75';
    ALTER TABLE games ADD COLUMN IF NOT EXISTS selecting_started_at TIMESTAMPTZ NOT NULL DEFAULT NOW();
    ALTER TABLE games ADD COLUMN IF NOT EXISTS finished_at TIMESTAMPTZ;
    ALTER TABLE games DROP CONSTRAINT IF EXISTS games_status_check;
    ALTER TABLE games ADD CONSTRAINT games_status_check CHECK (status IN ('selecting', 'finalizing', 'playing', 'finished'));
    ALTER TABLE games DROP CONSTRAINT IF EXISTS games_game_type_check;
    ALTER TABLE games ADD CONSTRAINT games_game_type_check CHECK (game_type IN ('90', '75'));
    CREATE INDEX IF NOT EXISTS games_active_type_idx ON games(game_type, status, created_at);
    CREATE INDEX IF NOT EXISTS games_finished_retention_idx ON games(status, finished_at, created_at) WHERE status = 'finished';
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
    ALTER TABLE users ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

    CREATE TABLE IF NOT EXISTS balances (
      id BIGSERIAL PRIMARY KEY,
      user_id BIGINT NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
      balance NUMERIC(12, 2) NOT NULL DEFAULT 0 CHECK (balance >= 0),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    ALTER TABLE balances ADD COLUMN IF NOT EXISTS balance NUMERIC(12, 2) NOT NULL DEFAULT 0;
    ALTER TABLE balances ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT NOW();
    ALTER TABLE balances ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

    CREATE TABLE IF NOT EXISTS transactions (
      id BIGSERIAL PRIMARY KEY,
      user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      type TEXT NOT NULL,
      amount NUMERIC(12, 2) NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      external_reference TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    ALTER TABLE transactions ADD COLUMN IF NOT EXISTS type TEXT;
    ALTER TABLE transactions ADD COLUMN IF NOT EXISTS amount NUMERIC(12, 2);
    ALTER TABLE transactions ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'pending';
    ALTER TABLE transactions ADD COLUMN IF NOT EXISTS external_reference TEXT;
    ALTER TABLE transactions ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT NOW();
    ALTER TABLE transactions ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

    CREATE TABLE IF NOT EXISTS promo_codes (
      id BIGSERIAL PRIMARY KEY,
      code TEXT NOT NULL UNIQUE,
      amount NUMERIC(12, 2) NOT NULL DEFAULT 0,
      max_uses INTEGER,
      used_count INTEGER NOT NULL DEFAULT 0,
      expires_at TIMESTAMPTZ,
      active BOOLEAN NOT NULL DEFAULT TRUE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    ALTER TABLE promo_codes ADD COLUMN IF NOT EXISTS amount NUMERIC(12, 2) NOT NULL DEFAULT 0;
    ALTER TABLE promo_codes ADD COLUMN IF NOT EXISTS max_uses INTEGER;
    ALTER TABLE promo_codes ADD COLUMN IF NOT EXISTS used_count INTEGER NOT NULL DEFAULT 0;
    ALTER TABLE promo_codes ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ;
    ALTER TABLE promo_codes ADD COLUMN IF NOT EXISTS active BOOLEAN NOT NULL DEFAULT TRUE;
    ALTER TABLE promo_codes ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

    CREATE TABLE IF NOT EXISTS user_promo_codes (
      id BIGSERIAL PRIMARY KEY,
      user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      promo_code_id BIGINT NOT NULL REFERENCES promo_codes(id) ON DELETE CASCADE,
      used_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE (user_id, promo_code_id)
    );

    CREATE TABLE IF NOT EXISTS referrals (
      id BIGSERIAL PRIMARY KEY,
      referrer_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      referred_id BIGINT NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
      status TEXT NOT NULL DEFAULT 'pending',
      reward_amount NUMERIC(12, 2) NOT NULL DEFAULT 0,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      completed_at TIMESTAMPTZ,
      CHECK (referrer_id <> referred_id)
    );

    CREATE TABLE IF NOT EXISTS bingo_round_archive (
      game_id UUID PRIMARY KEY,
      game_type TEXT NOT NULL,
      finished_at TIMESTAMPTZ NOT NULL,
      game JSONB NOT NULL,
      game_cards JSONB NOT NULL DEFAULT '[]'::JSONB,
      winners JSONB NOT NULL DEFAULT '[]'::JSONB,
      audit_logs JSONB NOT NULL DEFAULT '[]'::JSONB,
      archived_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS audit_logs (
      id BIGSERIAL PRIMARY KEY,
      user_id BIGINT REFERENCES users(id) ON DELETE SET NULL,
      action TEXT NOT NULL,
      entity_type TEXT,
      entity_id TEXT,
      details JSONB NOT NULL DEFAULT '{}'::JSONB,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    ALTER TABLE audit_logs ADD COLUMN IF NOT EXISTS details JSONB NOT NULL DEFAULT '{}'::JSONB;

    CREATE INDEX IF NOT EXISTS game_cards_game_id_idx ON game_cards(game_id);
    CREATE INDEX IF NOT EXISTS game_cards_user_id_idx ON game_cards(user_id);
    CREATE INDEX IF NOT EXISTS winners_game_id_idx ON winners(game_id);
    CREATE INDEX IF NOT EXISTS winners_user_id_idx ON winners(user_id);
    CREATE INDEX IF NOT EXISTS transactions_user_id_created_at_idx ON transactions(user_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS transactions_status_idx ON transactions(status);
    CREATE INDEX IF NOT EXISTS transactions_external_reference_idx ON transactions(external_reference);
    CREATE INDEX IF NOT EXISTS user_promo_codes_user_id_idx ON user_promo_codes(user_id);
    CREATE INDEX IF NOT EXISTS user_promo_codes_promo_code_id_idx ON user_promo_codes(promo_code_id);
    CREATE INDEX IF NOT EXISTS referrals_referrer_id_idx ON referrals(referrer_id);
    CREATE INDEX IF NOT EXISTS referrals_status_idx ON referrals(status);
    CREATE INDEX IF NOT EXISTS audit_logs_user_id_created_at_idx ON audit_logs(user_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS audit_logs_entity_idx ON audit_logs(entity_type, entity_id);
    CREATE INDEX IF NOT EXISTS audit_logs_action_idx ON audit_logs(action);
    CREATE INDEX IF NOT EXISTS bingo_round_archive_finished_at_idx ON bingo_round_archive(finished_at);
    CREATE TABLE IF NOT EXISTS bingo_cards (
      card_number INTEGER PRIMARY KEY CHECK (card_number BETWEEN 1 AND 400),
      rows JSONB NOT NULL,
      game_type TEXT NOT NULL DEFAULT '75',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    ALTER TABLE bingo_cards DROP CONSTRAINT IF EXISTS bingo_cards_card_number_check;
    ALTER TABLE bingo_cards ADD COLUMN IF NOT EXISTS game_type TEXT NOT NULL DEFAULT '75';
    ALTER TABLE bingo_cards DROP CONSTRAINT IF EXISTS bingo_cards_card_number_check;
    ALTER TABLE bingo_cards ADD CONSTRAINT bingo_cards_card_number_check CHECK (card_number BETWEEN 1 AND 800);
    ALTER TABLE bingo_cards DROP CONSTRAINT IF EXISTS bingo_cards_game_type_check;
    ALTER TABLE bingo_cards ADD CONSTRAINT bingo_cards_game_type_check CHECK (game_type IN ('90', '75'));
    CREATE INDEX IF NOT EXISTS bingo_cards_game_type_idx ON bingo_cards(game_type, card_number);
    ALTER TABLE winners DROP CONSTRAINT IF EXISTS winners_game_card_unique;
    ALTER TABLE winners ADD CONSTRAINT winners_game_card_unique UNIQUE (game_id, user_id, card_number);
    INSERT INTO bingo_cards (card_number, rows, game_type)
    SELECT source.card_number, source.rows, COALESCE(source.game_type, '75')
    FROM jsonb_to_recordset($1::jsonb) AS source(card_number INTEGER, rows JSONB, game_type TEXT)
    ON CONFLICT (card_number) DO UPDATE SET rows = EXCLUDED.rows, game_type = EXCLUDED.game_type;
    INSERT INTO games (status)
    SELECT 'selecting'
    WHERE NOT EXISTS (SELECT 1 FROM games WHERE status IN ('selecting', 'playing'));
  `;
  const cardRows = JSON.stringify([
    ...Array.from({ length: 400 }, (_, index) => ({ ...build75Card(index + 1), card_number: index + 401 })),
  ]);
  for (const statement of schemaSql.split(";").map((sql) => sql.trim()).filter(Boolean)) {
    try {
      await db.query(statement, statement.includes("$1") ? [cardRows] : []);
    } catch (error) {
      if ((error as { code?: string }).code !== "42710" || !statement.includes("ADD CONSTRAINT games_")) throw error;
    }
  }
  void archiveExpiredBingoRounds().catch((error) => {
    console.error("Bingo round retention cleanup failed", error);
  });
}

const roundRetentionDays = () => {
  const configured = Number.parseInt(process.env.GAME_ROUND_RETENTION_DAYS ?? "30", 10);
  return Number.isFinite(configured) && configured > 0 ? configured : 30;
};

/** Archives finished rounds before removing their live rows. Wallet transactions are intentionally untouched. */
export async function archiveExpiredBingoRounds() {
  if (!db) return;
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    await client.query(
      `INSERT INTO bingo_round_archive (game_id, game_type, finished_at, game, game_cards, winners, audit_logs)
       SELECT g.id, g.game_type, COALESCE(g.finished_at, g.created_at), to_jsonb(g),
         COALESCE((SELECT jsonb_agg(to_jsonb(gc)) FROM game_cards gc WHERE gc.game_id = g.id), '[]'::jsonb),
         COALESCE((SELECT jsonb_agg(to_jsonb(w)) FROM winners w WHERE w.game_id = g.id), '[]'::jsonb),
         COALESCE((SELECT jsonb_agg(to_jsonb(a)) FROM audit_logs a WHERE a.entity_type = 'game' AND a.entity_id = g.id::text), '[]'::jsonb)
       FROM games g
       WHERE g.status = 'finished'
         AND COALESCE(g.finished_at, g.created_at) < NOW() - ($1::int * INTERVAL '1 day')
       ON CONFLICT (game_id) DO NOTHING`,
      [roundRetentionDays()],
    );
    await client.query(`DELETE FROM game_cards WHERE game_id IN (SELECT game_id FROM bingo_round_archive)`);
    await client.query(`DELETE FROM winners WHERE game_id IN (SELECT game_id FROM bingo_round_archive)`);
    await client.query(`DELETE FROM games WHERE id IN (SELECT game_id FROM bingo_round_archive) AND status = 'finished'`);
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally { client.release(); }
}

export async function verifyDatabaseConnection() {
  if (!db) return;
  await db.query("SELECT 1");
}

export async function registerTelegramUser(input: {
  telegramId: number;
  username?: string | null;
  displayName: string;
  phone?: string | null;
}) {
  if (!db) throw new Error("DATABASE_URL is not configured");
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    const user = await client.query(
      `INSERT INTO users (telegram_id, username, display_name, phone, updated_at)
       VALUES ($1, $2, $3, $4, NOW())
       ON CONFLICT (telegram_id) DO UPDATE
       SET username = EXCLUDED.username,
           display_name = EXCLUDED.display_name,
           phone = EXCLUDED.phone,
           updated_at = NOW()
       RETURNING id, telegram_id, username, display_name, phone`,
      [input.telegramId, input.username ?? null, input.displayName, input.phone],
    );
    await client.query(
      `INSERT INTO balances (user_id, balance)
       VALUES ($1, 0)
       ON CONFLICT (user_id) DO NOTHING`,
      [user.rows[0].id],
    );
    await client.query("COMMIT");
    return user.rows[0];
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function createWithdrawalRequest(telegramId: number, amount: number, account: string, ownerName: string) {
  if (!db) throw new Error("DATABASE_URL is not configured");
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    const user = await client.query("SELECT id FROM users WHERE telegram_id = $1 FOR UPDATE", [telegramId]);
    if (!user.rowCount) throw new Error("Telegram user is not registered");
    const balance = await client.query("SELECT balance FROM balances WHERE user_id = $1 FOR UPDATE", [user.rows[0].id]);
    if (!balance.rowCount || Number(balance.rows[0].balance) < amount) throw new Error("Insufficient balance");
    await client.query("UPDATE balances SET balance = balance - $1, updated_at = NOW() WHERE user_id = $2", [amount, user.rows[0].id]);
    const result = await client.query("INSERT INTO transactions (user_id, type, amount, status, external_reference) VALUES ($1, 'withdraw', $2, 'pending', $3) RETURNING id, amount", [user.rows[0].id, amount, JSON.stringify({ account, ownerName })]);
    await client.query("COMMIT");
    return result.rows[0];
  } catch (error) { await client.query("ROLLBACK"); throw error; }
  finally { client.release(); }
}

export async function reviewDepositRequest(transactionId: number, approved: boolean) {
  if (!db) throw new Error("DATABASE_URL is not configured");
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    const transaction = await client.query(
      "SELECT id, user_id, amount, status FROM transactions WHERE id = $1 FOR UPDATE",
      [transactionId],
    );
    if (!transaction.rowCount || transaction.rows[0].status !== "pending") throw new Error("Deposit request is no longer pending");
    const row = transaction.rows[0];
    if (approved) {
      await client.query("UPDATE balances SET balance = balance + $1, updated_at = NOW() WHERE user_id = $2", [row.amount, row.user_id]);
    }
    await client.query("UPDATE transactions SET status = $1, updated_at = NOW() WHERE id = $2", [approved ? "approved" : "rejected", transactionId]);
    await client.query("COMMIT");
    return row;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function reviewWithdrawalRequest(transactionId: number, approved: boolean) {
  if (!db) throw new Error("DATABASE_URL is not configured");
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    const transaction = await client.query("SELECT id, user_id, amount, status FROM transactions WHERE id = $1 AND type = 'withdraw' FOR UPDATE", [transactionId]);
    if (!transaction.rowCount || transaction.rows[0].status !== "pending") throw new Error("Withdrawal request is no longer pending");
    const row = transaction.rows[0];
    if (!approved) await client.query("UPDATE balances SET balance = balance + $1, updated_at = NOW() WHERE user_id = $2", [row.amount, row.user_id]);
    await client.query("UPDATE transactions SET status = $1, updated_at = NOW() WHERE id = $2", [approved ? "approved" : "rejected", transactionId]);
    await client.query("COMMIT");
    return row;
  } catch (error) { await client.query("ROLLBACK"); throw error; }
  finally { client.release(); }
}

export async function createDepositRequest(telegramId: number, amount: number, reference: string) {
  if (!db) throw new Error("DATABASE_URL is not configured");
  const result = await db.query(
    `INSERT INTO transactions (user_id, type, amount, status, external_reference)
     SELECT id, 'deposit', $2, 'pending', $3
     FROM users
     WHERE telegram_id = $1
     RETURNING id, amount, status, external_reference`,
    [telegramId, amount, reference],
  );
  if (!result.rowCount) throw new Error("Telegram user is not registered");
  return result.rows[0];
}

export async function getWalletTransactions(telegramId: number) {
  if (!db) throw new Error("DATABASE_URL is not configured");
  const result = await db.query(
    `SELECT t.id, t.type, t.amount, t.status, t.external_reference, t.created_at
     FROM transactions t JOIN users u ON u.id = t.user_id
     WHERE u.telegram_id = $1 ORDER BY t.created_at DESC LIMIT 25`,
    [telegramId],
  );
  return result.rows;
}

export async function getTelegramProfile(telegramId: number) {
  if (!db) throw new Error("DATABASE_URL is not configured");
  const result = await db.query(
    `SELECT u.id, u.telegram_id, u.username, u.display_name, u.phone,
            COALESCE(b.balance, 0)::numeric AS balance,
            COUNT(DISTINCT gc.card_number)::int AS card_count
     FROM users u
     LEFT JOIN balances b ON b.user_id = u.id
     LEFT JOIN game_cards gc ON gc.user_id = u.id
     WHERE u.telegram_id = $1
     GROUP BY u.id, b.balance`,
    [telegramId],
  );
  return result.rows[0] ?? null;
}

export async function getCardCatalog() {
  if (!db) throw new Error("DATABASE_URL is not configured");
  const result = await db.query<BingoCardRecord>(
    "SELECT card_number, rows, game_type FROM bingo_cards WHERE game_type = $1 ORDER BY card_number",
    ["75"],
  );
  result.rows.forEach((card) => { card.card_number -= 400; });
  return result.rows;
}

export async function getActiveGame(userId?: number) {
  const gameType: GameType = "75";
  if (!db) throw new Error("DATABASE_URL is not configured");
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock($1, $2)", [90210, 75]);
    const result = await client.query(
      `SELECT id, status, prize_pool, called_numbers, current_number, selecting_started_at
       FROM games
       WHERE status IN ('selecting', 'finalizing', 'playing') AND game_type = $1
       ORDER BY created_at ASC
       LIMIT 1
       FOR UPDATE`, [gameType]);
    const game = result.rowCount
      ? result.rows[0]
      : (await client.query(
          "INSERT INTO games (status, game_type) VALUES ('selecting', $1) RETURNING id, status, prize_pool, called_numbers, current_number, selecting_started_at, game_type",
          [gameType],
        )).rows[0];
    const occupiedResult = userId && game.status === "selecting"
      ? await client.query(
          "SELECT card_number FROM game_cards WHERE game_id = $1 AND user_id <> $2",
          [game.id, userId],
        )
      : { rows: [] as Array<{ card_number: number }> };
    const occupiedCardNumbers = occupiedResult.rows.map((row) => {
      const cardNumber = Number(row.card_number);
      return cardNumber - 400;
    });
    await client.query("COMMIT");
    const selectionEndsAt = game.selecting_started_at
      ? new Date(new Date(game.selecting_started_at).getTime() + 50000).toISOString()
      : null;
    return { ...game, selectionEndsAt, occupiedCardNumbers };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function persistSelectedCards(gameId: string, userId: number, cardNumbers: number[]) {
  const gameType: GameType = "75";
  if (!db) throw new Error("DATABASE_URL is not configured");
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    const gameStatus = await client.query("SELECT status, selecting_started_at FROM games WHERE id = $1 AND game_type = $2 FOR UPDATE", [gameId, gameType]);
    if (!gameStatus.rowCount) throw new Error("Game not found");
    if (gameStatus.rows[0].status !== "selecting" || Date.now() - new Date(gameStatus.rows[0].selecting_started_at).getTime() >= 50000) throw new Error("ጨዋታ እየተካሄደ ነው");
    const storedCards = cardNumbers.map((n) => n + 400);
    const validCards = await client.query(
      "SELECT card_number FROM bingo_cards WHERE game_type = $1 AND card_number = ANY($2::int[])",
      [gameType, storedCards],
    );
    if (validCards.rowCount !== cardNumbers.length) throw new Error("One or more selected cards do not exist");
    const occupied = await client.query(
      "SELECT card_number FROM game_cards WHERE game_id = $1 AND card_number = ANY($2::int[]) AND user_id <> $3 FOR UPDATE",
      [gameId, storedCards, userId],
    );
    if (occupied.rowCount) throw new Error("One or more selected cards are already taken");
    const existing = await client.query(
      "SELECT card_number FROM game_cards WHERE game_id = $1 AND user_id = $2 AND card_number = ANY($3::int[]) FOR UPDATE",
      [gameId, userId, storedCards],
    );
    const newCards = storedCards.filter((card) => !existing.rows.some((row) => Number(row.card_number) === card));
    if (newCards.length) {
      const balance = await client.query("SELECT balance FROM balances WHERE user_id = $1 FOR UPDATE", [userId]);
      const total = newCards.length * 10;
      if (!balance.rowCount || Number(balance.rows[0].balance) < total) throw new Error("Insufficient balance");
      await client.query("UPDATE balances SET balance = balance - $1, updated_at = NOW() WHERE user_id = $2", [total, userId]);
      await client.query("INSERT INTO transactions (user_id, type, amount, status, external_reference) VALUES ($1, 'card_purchase', $2, 'approved', $3)", [userId, total, `game:${gameId}`]);
    }
    await client.query(
      `DELETE FROM game_cards WHERE game_id = $1 AND user_id = $2 AND NOT (card_number = ANY($3::int[]))`,
      [gameId, userId, storedCards],
    );
    for (const cardNumber of newCards) {
      await client.query(
        "INSERT INTO game_cards (game_id, user_id, card_number) VALUES ($1, $2, $3)",
        [gameId, userId, cardNumber],
      );
    }
    await client.query(
      `UPDATE games
       SET prize_pool = (SELECT COUNT(*) * 10 * 0.8 FROM game_cards WHERE game_id = $1)
       WHERE id = $1 AND status = 'selecting'`,
      [gameId],
    );
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function advanceSelectingGame() {
  const gameType: GameType = "75";
  if (!db) throw new Error("DATABASE_URL is not configured");
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock($1, $2)", [90210, 75]);
    const result = await client.query(
      `SELECT g.id, COUNT(gc.card_number)::int AS card_count FROM games g
       LEFT JOIN game_cards gc ON gc.game_id = g.id
       WHERE g.status = 'selecting' AND g.game_type = $1
       GROUP BY g.id, g.created_at, g.selecting_started_at
       HAVING NOW() - g.selecting_started_at >= INTERVAL '50 seconds'
       ORDER BY g.created_at ASC LIMIT 1`, [gameType]);
    if (!result.rowCount) { await client.query("COMMIT"); return null; }
    const gameId = String(result.rows[0].id);
    if (Number(result.rows[0].card_count) > 0) {
      await client.query("UPDATE games SET status = 'finalizing' WHERE id = $1 AND status = 'selecting'", [gameId]);
      await client.query("COMMIT");
      return { gameId, started: true, finalizing: true };
    }
    await client.query("UPDATE games SET selecting_started_at = NOW(), created_at = NOW() WHERE id = $1 AND status = 'selecting'", [gameId]);
    await client.query("COMMIT");
    return { gameId, started: false };
  } catch (error) { await client.query("ROLLBACK"); throw error; }
  finally { client.release(); }
}

export async function startFinalizingGame(gameId: string) {
  if (!db) throw new Error("DATABASE_URL is not configured");
  const result = await db.query("UPDATE games SET status = 'playing' WHERE id = $1 AND game_type = $2 AND status = 'finalizing' RETURNING id", [gameId, "75"]);
  return result.rowCount > 0;
}

export async function claimGameWinners(gameId: string) {
  if (!db) throw new Error("DATABASE_URL is not configured");
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    const result = await client.query(
      `SELECT g.called_numbers, g.prize_pool, gc.user_id, gc.card_number, bc.rows
       FROM games g
       JOIN game_cards gc ON gc.game_id = g.id
       JOIN bingo_cards bc ON bc.card_number = gc.card_number AND bc.game_type = g.game_type
       WHERE g.id = $1 AND g.status = 'playing' FOR UPDATE OF g`,
      [gameId],
    );
    const candidates: Array<{ userId: number; cardNumber: number; rows: number[] }> = [];
    for (const row of result.rows) {
      const called = new Set<number>((row.called_numbers ?? []) as number[]);
      const grid = row.rows as number[][];
      const complete = (values: number[]) => values.every((n) => n === 0 || called.has(n));
      const winningRows = grid.map((numbers, index) => complete(numbers) ? index + 1 : null).filter((index): index is number => index !== null);
      const winningCols = grid[0].map((_, c) => complete(grid.map((r) => r[c])) ? c + 6 : null).filter((x): x is number => x !== null);
      const diagonals = [complete(grid.map((r, i) => r[i])), complete(grid.map((r, i) => r[4 - i]))];
      const corners = [grid[0][0], grid[0][4], grid[4][0], grid[4][4]].every((n) => called.has(n));
      if (!winningRows.length && !winningCols.length && !diagonals.some(Boolean) && !corners) continue;
      winningRows.push(...winningCols, ...(diagonals[0] ? [11] : []), ...(diagonals[1] ? [12] : []), ...(corners ? [13] : []));
      const existing = await client.query("SELECT 1 FROM winners WHERE game_id = $1 AND user_id = $2 AND card_number = $3", [gameId, row.user_id, row.card_number]);
      if (!existing.rowCount) candidates.push({ userId: Number(row.user_id), cardNumber: Number(row.card_number), rows: winningRows });
    }
    const winners: Array<{ userId: number; cardNumber: number; rows: number[]; prizeAmount: number }> = [];
    const prizeAmount = candidates.length ? Number(result.rows[0]?.prize_pool ?? 0) / candidates.length : 0;
    for (const candidate of candidates) {
      const inserted = await client.query(
        `INSERT INTO winners (game_id, user_id, card_number, prize_amount, winning_rows)
         VALUES ($1, $2, $3, $4, $5) ON CONFLICT (game_id, user_id, card_number) DO NOTHING RETURNING id`,
        [gameId, candidate.userId, candidate.cardNumber, prizeAmount, candidate.rows],
      );
      if (!inserted.rowCount) continue;
      await client.query("UPDATE balances SET balance = balance + $1, updated_at = NOW() WHERE user_id = $2", [prizeAmount, candidate.userId]);
      await client.query("INSERT INTO transactions (user_id, type, amount, status, external_reference) VALUES ($1, 'bingo_prize', $2, 'approved', $3)", [candidate.userId, prizeAmount, `bingo:${gameId}:${candidate.cardNumber}`]);
      await client.query("INSERT INTO audit_logs (user_id, action, entity_type, entity_id, details) VALUES ($1, 'bingo_winner_paid', 'game', $2, $3::jsonb)", [candidate.userId, gameId, JSON.stringify({ cardNumber: candidate.cardNumber, amount: prizeAmount, winningRows: candidate.rows })]);
      winners.push({ ...candidate, prizeAmount });
    }
    if (winners.length) await client.query("UPDATE games SET status = 'finished', finished_at = NOW() WHERE id = $1", [gameId]);
    await client.query("COMMIT");
    return winners;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function readGameState(gameId: string) {
  if (!db) throw new Error("DATABASE_URL is not configured");
  const result = await db.query(
    `SELECT g.id, g.status, g.prize_pool, g.called_numbers, g.current_number, g.selecting_started_at,
            COUNT(DISTINCT gc.user_id)::int AS player_count
     FROM games g
     LEFT JOIN game_cards gc ON gc.game_id = g.id
     WHERE g.id = $1
     GROUP BY g.id`,
    [gameId],
  );
  if (!result.rowCount) return null;
  const winners = await db.query(
    `SELECT w.user_id AS "userId", u.display_name AS "displayName",
            w.card_number AS "cardNumber", w.winning_rows AS rows,
            w.prize_amount AS "prizeAmount"
     FROM winners w JOIN users u ON u.id = w.user_id
     WHERE w.game_id = $1 ORDER BY w.id`,
    [gameId],
  );
  return { ...result.rows[0], winners: winners.rows };
}

export async function callNextNumber(gameId: string) {
  if (!db) throw new Error("DATABASE_URL is not configured");
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    const lock = await client.query("SELECT pg_try_advisory_xact_lock($1, hashtext($2)) AS acquired", [90212, gameId]);
    if (!lock.rows[0].acquired) { await client.query("ROLLBACK"); return null; }
    const gameResult = await client.query(
      "SELECT called_numbers FROM games WHERE id = $1 AND status = 'playing' FOR UPDATE",
      [gameId],
    );
    if (!gameResult.rowCount) {
      await client.query("ROLLBACK");
      return null;
    }
    const calledNumbers = (gameResult.rows[0].called_numbers ?? []) as number[];
    const remaining = Array.from({ length: 75 }, (_, index) => index + 1).filter((number) => !calledNumbers.includes(number));
    if (!remaining.length) {
      await client.query("UPDATE games SET status = 'finished', finished_at = NOW() WHERE id = $1", [gameId]);
      await client.query("COMMIT");
      return null;
    }
    const nextNumber = remaining[Math.floor(Math.random() * remaining.length)];
    const nextCalledNumbers = [...calledNumbers, nextNumber];
    await client.query(
      "UPDATE games SET called_numbers = $1, current_number = $2 WHERE id = $3",
      [nextCalledNumbers, nextNumber, gameId],
    );
    await client.query("COMMIT");
    return nextNumber;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}
