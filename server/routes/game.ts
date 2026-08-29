import type { RequestHandler } from "express";
import { getActiveGame, getCardCatalog } from "../db";
import { serviceMode } from "../index";

export const handleCardCatalog: RequestHandler = async (_req, res) => {
  try {
    const cards = await getCardCatalog();
    return res.json(cards);
  } catch (error) {
    console.error("Unable to load bingo card catalog", error);
    return res.status(503).json({ error: "Bingo card catalog is unavailable." });
  }
};

export const handleGameInfo: RequestHandler = async (req, res) => {
  try {
    const parsedUserId = Number(req.query.userId);
    const userId = Number.isSafeInteger(parsedUserId) && parsedUserId > 0 ? parsedUserId : undefined;
    return res.json(await getActiveGame(userId));
  } catch (error) {
    console.error("Unable to load active bingo game", error);
    return res.status(503).json({ error: "Game data is unavailable." });
  }
};
