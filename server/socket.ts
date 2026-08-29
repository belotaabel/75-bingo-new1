import { Server } from "socket.io";
import { getTelegramUser } from "./routes/me";
import { advanceSelectingGame, callNextNumber, claimGameWinners, getActiveGame, persistSelectedCards, readGameState, startFinalizingGame, type GameType } from "./db";
import type { BingoWinner } from "@shared/api";

type GameState = {
  gameId: string;
  calledNumbers: number[];
  currentBall: number | null;
  status: "waiting" | "finalizing" | "active" | "complete";
  playerCount: number;
  prizeAmount: number;
  winners: BingoWinner[];
  selectionEndsAt: string | null;
};

function toGameState(row: any): GameState {
  return {
    gameId: String(row.id),
    calledNumbers: row.called_numbers ?? [],
    currentBall: row.current_number ?? null,
    status: row.status === "finished" ? "complete" : row.status === "playing" ? "active" : row.status === "finalizing" ? "finalizing" : "waiting",
    playerCount: Number(row.player_count ?? 0),
    prizeAmount: Number(row.prize_pool ?? 0),
    selectionEndsAt: row.selecting_started_at ? new Date(new Date(row.selecting_started_at).getTime() + 50000).toISOString() : null,
    winners: (row.winners ?? []).map((winner: BingoWinner) => ({
      ...winner,
      userId: Number(winner.userId),
      cardNumber: Number(winner.cardNumber),
      prizeAmount: Number(winner.prizeAmount),
    })),
  };
}

export function registerGameSockets(io: Server, serviceMode: GameType = "75") {
  const activeGames = new Map<GameType, string>();
  const tickInProgress = new Set<GameType>();
  const finalizingTimers = new Map<GameType, ReturnType<typeof setTimeout>>();

  const roomFor = (gameType: GameType, gameId: string) => `game:${gameType}:${gameId}`;

  const broadcastState = async (gameType: GameType) => {
    const gameId = activeGames.get(gameType);
    if (!gameId) return;
    const row = await readGameState(gameId);
    if (row) io.to(roomFor(gameType, gameId)).emit("game:state", toGameState(row));
  };

  const advanceMode = async (gameType: GameType) => {
    if (tickInProgress.has(gameType)) return;
    tickInProgress.add(gameType);
    try {
      const transition = await advanceSelectingGame();
      if (transition?.started && transition.gameId === activeGames.get(gameType)) {
        await broadcastState(gameType);
        if (transition.finalizing && !finalizingTimers.has(gameType)) {
          const gameId = transition.gameId;
          const timer = setTimeout(() => {
            finalizingTimers.delete(gameType);
            void (async () => {
              if (await startFinalizingGame(gameId)) {
                io.to(roomFor(gameType, gameId)).emit("game:announcement", { message: "Game started" });
                await broadcastState(gameType);
                await advanceMode(gameType);
              }
            })().catch((error) => console.error("Unable to start finalized game", error));
          }, 3000);
          finalizingTimers.set(gameType, timer);
        }
        return;
      }
      const gameId = activeGames.get(gameType);
      if (!gameId) return;
      const activeState = await readGameState(gameId);
      if (activeState?.status !== "playing") return;
      const nextNumber = await callNextNumber(gameId);
      if (nextNumber !== null) {
        await claimGameWinners(gameId);
        await broadcastState(gameType);
        const finalized = await readGameState(gameId);
        if (finalized?.status === "finished") activeGames.delete(gameType);
      }
    } catch (error) {
      console.error(`Unable to advance ${gameType} bingo game`, error);
    } finally {
      tickInProgress.delete(gameType);
    }
  };

  const timer = setInterval(() => {
    void advanceMode(serviceMode);
  }, 2000);

  io.use((socket, next) => {
    const initData = typeof socket.handshake.auth?.initData === "string" ? socket.handshake.auth.initData : "";
    const token = process.env.TELEGRAM_BOT_TOKEN;
    const telegramUser = token && initData ? getTelegramUser(initData, token) : null;
    if (!telegramUser) return next(new Error("Telegram authentication is required."));
    socket.data.telegramId = telegramUser.id;
    next();
  });

  io.on("connection", (socket) => {
    socket.on("game:join", async ({ playerId, cardNumbers }: { playerId?: string | number; cardNumbers?: number[] }) => {
      try {
        const parsedPlayerId = Number(playerId);
        if (!Number.isSafeInteger(parsedPlayerId) || parsedPlayerId <= 0 || parsedPlayerId !== socket.data.telegramId) {
          socket.emit("game:error", { message: "Telegram player verification failed." });
          return;
        }
        const cards = Array.isArray(cardNumbers)
          ? [...new Set(cardNumbers.map(Number))].filter((card) => Number.isInteger(card) && card >= 1 && card <= 400).slice(0, 2)
          : [];
        if (!cards.length) {
          socket.emit("game:error", { message: "Select at least one bingo card before joining." });
          return;
        }
        const mode = serviceMode;
        // Lookup and persistence are transactional in the database. Passing the
        // user here also keeps the occupied-card view tied to this same shared
        // round before cards are locked/purchased.
        const game = await getActiveGame(parsedPlayerId);
        const gameId = String(game.id);
        activeGames.set(mode, gameId);
        await persistSelectedCards(gameId, parsedPlayerId, cards);
        const room = roomFor(mode, gameId);
        await socket.join(room);
        socket.data.gameId = gameId;
        socket.data.gameType = mode;
        socket.data.playerId = parsedPlayerId;
        const updatedGame = await getActiveGame();
        io.to(room).emit("cards:occupied", updatedGame.occupiedCardNumbers);
        await broadcastState(mode);
      } catch (error) {
        const joinError = error instanceof Error ? error : new Error(String(error));
        console.error("Unable to join bingo game", { message: joinError.message, stack: joinError.stack, code: (error as { code?: string }).code });
        socket.emit("game:error", { message: `ጨዋታውን መቀላቀል አልተቻለም: ${joinError.message}` });
      }
    });

    const leaveGame = () => {
      const gameId = socket.data.gameId as string | undefined;
      const gameType = socket.data.gameType as GameType | undefined;
      const playerId = socket.data.playerId as number | undefined;
      if (gameId && gameType) {
        const room = roomFor(gameType, gameId);
        void (async () => {
          if (playerId) {
            const game = await getActiveGame(playerId);
            if (String(game.id) === gameId && game.status === "selecting") {
              await persistSelectedCards(gameId, playerId, []);
              const updatedGame = await getActiveGame();
              io.to(room).emit("cards:occupied", updatedGame.occupiedCardNumbers);
            }
          }
          await socket.leave(room);
        })().catch((error) => console.error("Unable to release bingo cards", error));
      }
      socket.data.gameId = undefined;
      socket.data.gameType = undefined;
      socket.data.playerId = undefined;
    };

    socket.on("game:leave", leaveGame);
    socket.on("disconnect", leaveGame);
  });

  return () => clearInterval(timer);
}
