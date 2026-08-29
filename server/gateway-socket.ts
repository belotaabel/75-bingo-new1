import type { Server } from "socket.io";
import { io as connectToGame } from "socket.io-client";

export function registerGatewaySockets(io: Server) {
  io.on("connection", (socket) => {
    const target = (process.env.GAME_SERVICE_URL_75 ?? "").replace(/\/$/, "");
    if (!target) {
      socket.emit("game:error", { message: "GAME_SERVICE_URL_75 is not configured" });
      socket.disconnect(true);
      return;
    }

    const upstream = connectToGame(target, {
      transports: ["polling", "websocket"],
      upgrade: false,
      query: { gameType: "75" },
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
