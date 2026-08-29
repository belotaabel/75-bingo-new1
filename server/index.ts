import "dotenv/config";
import "dotenv/config";
import express from "express";
import cors from "cors";
import { handleDemo } from "./routes/demo";
import { handleTelegramWebhook } from "./routes/telegram";
import { handleMe, handleProfilePhoto } from "./routes/me";
import { handleCardCatalog, handleGameInfo } from "./routes/game";
import { handleWallet, handleDeposit, handleWithdrawal } from "./routes/wallet";

export type ServiceMode = "90" | "75" | "gateway";
export const serviceMode: ServiceMode = process.env.SERVICE_MODE === "75" ? "75" : process.env.SERVICE_MODE === "gateway" ? "gateway" : "90";

const gameServiceUrl = (mode: "90" | "75") => (process.env[`GAME_SERVICE_URL_${mode}`] ?? "").replace(/\/$/, "");

async function proxyGameRequest(req: express.Request, res: express.Response) {
  const requestedMode = req.query.gameType === "75" ? "75" : "90";
  if (serviceMode !== "gateway") return res.status(404).json({ error: "Game endpoint unavailable" });
  const target = gameServiceUrl(requestedMode);
  if (!target) return res.status(503).json({ error: `GAME_SERVICE_URL_${requestedMode} is not configured` });
  try {
    const query = new URLSearchParams(req.query as Record<string, string>).toString();
    const response = await fetch(`${target}${req.path}${query ? `?${query}` : ""}`, { headers: { accept: "application/json" } });
    const body = await response.text();
    res.status(response.status).type(response.headers.get("content-type") ?? "application/json").send(body);
  } catch (error) {
    console.error("Game service proxy failed", error);
    res.status(502).json({ error: "Game service unavailable" });
  }
}

export function createServer() {
  const app = express();

  // Middleware
  app.use(cors());
  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));

  // Example API routes
  app.get("/api/ping", (_req, res) => {
    const ping = process.env.PING_MESSAGE ?? "ping";
    res.json({ message: ping });
  });

  app.get("/api/demo", handleDemo);
  app.post("/api/telegram/webhook", handleTelegramWebhook);
  app.get("/api/me", handleMe);
  app.get("/api/profile-photo/:telegramId", handleProfilePhoto);
  app.get("/api/wallet", handleWallet);
  app.post("/api/wallet/deposit", handleDeposit);
  app.post("/api/wallet/withdraw", handleWithdrawal);
  // The gateway owns auth/profile; only game endpoints are delegated by mode.
  if (serviceMode === "gateway") {
    app.get("/api/game/cards", proxyGameRequest);
    app.get("/api/game", proxyGameRequest);
  } else {
    app.get("/api/game/cards", handleCardCatalog);
    app.get("/api/game", handleGameInfo);
  }

  return app;
}
