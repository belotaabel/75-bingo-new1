import type { Server } from "socket.io";
import { io as connectToGame } from "socket.io-client";

type Mode = "90" | "75";

export function registerGatewaySockets(io: Server) {
  io.on("connection", (socket) => {
    const mode: Mode = socket.handshake.query.gameType === "75" ? "75" : "90";
    const target = (process.env[`GAME_SERVICE_URL_${mode}`] ?? "").replace(/\/$/, "");
    if (!target) {
      socket.emit("game:error", { message: `GAME_SERVICE_URL_${mode} is not configured` });
      socket.disconnect(true);
      return;
    }

    // Carry the selected mode through the second Socket.IO hop as well. The
    // upstream is normally a mode-specific service, but this keeps mode
    // selection explicit if the deployment topology changes.
    const upstream = connectToGame(target, {
      transports: ["polling", "websocket"],
      upgrade: false,
      query: { gameType: mode },
      auth: { initData: socket.handshake.auth?.initData },
    });
    upstream.on("game:state", (state) => socket.emit("game:state", state));
    upstream.on("game:error", (error) => socket.emit("game:error", error));
    upstream.on("connect_error", () => socket.emit("game:error", { message: "Game service unavailable" }));
    socket.on("game:join", (payload) => upstream.emit("game:join", payload));
    socket.on("game:leave", () => upstream.emit("game:leave"));
    socket.on("disconnect", () => upstream.disconnect());
  });
}
