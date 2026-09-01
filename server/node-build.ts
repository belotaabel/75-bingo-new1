import path from "node:path";
import { createServer, serviceMode } from "./index";
import { registerTelegramWebhook } from "./routes/telegram";
import * as express from "express";
import { createServer as createHttpServer } from "node:http";
import { Server as SocketServer } from "socket.io";
import { registerGameSockets } from "./socket";
import { registerGatewaySockets } from "./gateway-socket";
import { initializeDatabase } from "./db";
import { createAdapter } from "@socket.io/redis-adapter";
import { createClient } from "redis";

const app = createServer();
const port = Number(process.env.PORT ?? (serviceMode === "gateway" ? 8080 : 3001));

// In production, serve the built SPA files
const __dirname = import.meta.dirname;
const distPath = path.join(__dirname, "../spa");

// Serve static files
app.use(express.static(distPath));

// Handle React Router - serve index.html for all non-API routes
app.use((req, res) => {
  // Don't serve index.html for API routes
  if (req.path.startsWith("/api/") || req.path.startsWith("/health")) {
    return res.status(404).json({ error: "API endpoint not found" });
  }

  res.sendFile(path.join(distPath, "index.html"));
});

const httpServer = createHttpServer(app);
const io = new SocketServer(httpServer, { cors: { origin: true, credentials: true } });

async function configureSocketAdapter() {
  const redisUrl = process.env.REDIS_URL;
  if (!redisUrl) return;
  const pubClient = createClient({ url: redisUrl });
  const subClient = pubClient.duplicate();
  pubClient.on("error", (error) => console.error("Redis publisher error", error));
  subClient.on("error", (error) => console.error("Redis subscriber error", error));
  await Promise.all([pubClient.connect(), subClient.connect()]);
  io.adapter(createAdapter(pubClient, subClient));
  console.log("Socket.IO Redis adapter enabled");
}

if (serviceMode === "gateway") registerGatewaySockets(io);
else registerGameSockets(io, serviceMode);

void configureSocketAdapter().catch((error) => {
  console.error("Redis Socket.IO adapter initialization failed", error);
  process.exit(1);
});

httpServer.listen(port, () => {
  void initializeDatabase().catch((error) => {
    console.error("Neon database initialization failed", error instanceof Error ? { message: error.message, stack: error.stack, code: (error as { code?: string }).code } : error);
  });
  if (process.env.TELEGRAM_WEBHOOK_ENABLED !== "false") void registerTelegramWebhook().catch((error) => {
    console.error("Telegram webhook registration failed", error instanceof Error ? { message: error.message, stack: error.stack } : error);
  });
  const runningOnRender = process.env.RENDER === "true" || Boolean(process.env.RENDER_EXTERNAL_URL);
  console.log(`Fusion Starter server running on port ${port}`);
  console.log(`Running on Render: ${runningOnRender}`);
  console.log(`Frontend: http://localhost:${port}`);
  console.log(`API: http://localhost:${port}/api`);
});

// Graceful shutdown
process.on("SIGTERM", () => {
  console.log("🛑 Received SIGTERM, shutting down gracefully");
  process.exit(0);
});

process.on("SIGINT", () => {
  console.log("🛑 Received SIGINT, shutting down gracefully");
  process.exit(0);
});
