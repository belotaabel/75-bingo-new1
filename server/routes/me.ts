import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import type { RequestHandler } from "express";
import { getTelegramProfile, registerTelegramUser } from "../db";

export function getTelegramUser(initData: string, botToken: string): { id: number; username?: string; displayName: string } | null {
  const params = new URLSearchParams(initData);
  const receivedHash = params.get("hash");
  if (!receivedHash || !/^[a-f0-9]{64}$/i.test(receivedHash)) return null;

  const dataCheckString = [...params.entries()]
    .filter(([key]) => key !== "hash")
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => `${key}=${value}`)
    .join("\n");
  const secretKey = createHmac("sha256", "WebAppData").update(botToken).digest();
  const expectedHash = createHmac("sha256", secretKey).update(dataCheckString).digest("hex");
  if (!timingSafeEqual(Buffer.from(receivedHash, "hex"), Buffer.from(expectedHash, "hex"))) return null;

  try {
    const user = JSON.parse(params.get("user") ?? "null") as { id?: number; username?: string; first_name?: string; last_name?: string } | null;
    if (!user?.id || !Number.isSafeInteger(user.id)) return null;
    const displayName = [user.first_name, user.last_name].filter(Boolean).join(" ") || user.username || `Telegram User ${user.id}`;
    return { id: user.id, username: user.username, displayName };
  } catch {
    return null;
  }
}

export const handleMe: RequestHandler = async (req, res) => {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const initData = req.header("x-telegram-init-data");
  if (!token || !initData) {
    console.error("Telegram /api/me authentication rejected", {
      missingBotToken: !token,
      missingInitData: !initData,
      origin: req.header("origin") ?? null,
      userAgent: req.header("user-agent") ?? null,
    });
    return res.sendStatus(401);
  }

  const telegramUser = getTelegramUser(initData, token);
  if (!telegramUser) {
    console.error("Telegram /api/me authentication rejected: invalid initData");
    return res.sendStatus(401);
  }

  try {
    await registerTelegramUser({
      telegramId: telegramUser.id,
      username: telegramUser.username,
      displayName: telegramUser.displayName,
    });
    const profile = await getTelegramProfile(telegramUser.id);
    if (!profile) return res.sendStatus(401);
    return res.json({ ...profile, photo_url: `/api/profile-photo/${telegramUser.id}` });
  } catch (error) {
    const databaseError = error instanceof Error ? error : new Error(String(error));
    const code = (error as { code?: string }).code;
    console.error("Telegram /api/me database error", { message: databaseError.message, stack: databaseError.stack, code });
    return res.status(500).json({ error: databaseError.message, code: code ?? null });
  }
};

export const handleProfilePhoto: RequestHandler = async (req, res) => {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const requestedId = Number(req.params.telegramId);
  if (!token || !Number.isSafeInteger(requestedId)) return res.sendStatus(401);
  try {
    const photosResponse = await fetch(`https://api.telegram.org/bot${token}/getUserProfilePhotos?user_id=${requestedId}&limit=1`);
    const photos = await photosResponse.json() as { ok?: boolean; result?: { photos?: Array<Array<{ file_id: string }>> } };
    const fileId = photos.result?.photos?.[0]?.[0]?.file_id;
    if (!photos.ok || !fileId) return res.sendStatus(404);
    const fileResponse = await fetch(`https://api.telegram.org/bot${token}/getFile?file_id=${fileId}`);
    const file = await fileResponse.json() as { ok?: boolean; result?: { file_path?: string } };
    if (!file.ok || !file.result?.file_path) return res.sendStatus(404);
    const imageResponse = await fetch(`https://api.telegram.org/file/bot${token}/${file.result.file_path}`);
    if (!imageResponse.ok || !imageResponse.body) return res.sendStatus(404);
    res.setHeader("content-type", imageResponse.headers.get("content-type") ?? "image/jpeg");
    res.setHeader("cache-control", "private, max-age=300");
    const buffer = Buffer.from(await imageResponse.arrayBuffer());
    return res.end(buffer);
  } catch {
    return res.sendStatus(404);
  }
};
