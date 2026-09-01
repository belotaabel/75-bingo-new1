import { RequestHandler } from "express";
import { createDepositRequest, createWithdrawalRequest, getTelegramProfile, recordReferralRegistration, registerTelegramUser, reviewDepositRequest, reviewWithdrawalRequest } from "../db";

const depositSteps = new Map<number, { step: "amount" | "reference"; amount?: number }>();
const withdrawalSteps = new Map<number, { step: "amount" | "account" | "owner"; amount?: number; account?: string }>();

function mainMenu() {
  const playButton = { text: "🎮 Play Bingo" };
  return {
    keyboard: [
      [{ text: "📝 Register" }, playButton],
      [{ text: "🎁 Promo Code" }, { text: "💰 Deposit" }],
      [{ text: "💸 Withdraw" }, { text: "🔗 Invite & Earn" }],
      [{ text: "👤 Profile & Account" }, { text: "🆘 Support" }],
    ],
    resize_keyboard: true,
  };
}

function gameMenu(miniAppUrl?: string) {
  if (!miniAppUrl) return mainMenu();
  const url = new URL(miniAppUrl);
  url.pathname = `${url.pathname.replace(/\/$/, "")}/bingo/75`;
  return { inline_keyboard: [[{ text: "75 BINGO", web_app: { url: url.toString() } }]] };
}

function contactRequestMenu() {
  return {
    keyboard: [[{ text: "📱 Share Contact", request_contact: true }], [{ text: "↩️ Back to Menu" }]],
    resize_keyboard: true,
    one_time_keyboard: true,
  };
}

async function sendTelegramMessage(token: string, chatId: number, payload: Record<string, unknown>) {
  const response = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, ...payload }),
  });
  if (!response.ok) {
    const details = await response.text();
    throw new Error(`Telegram sendMessage failed (${response.status}): ${details}`);
  }
}

export const handleTelegramWebhook: RequestHandler = async (req, res) => {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const callback = req.body?.callback_query;
  const message = req.body?.message ?? callback?.message;
  const chatId = message?.chat?.id;
  const text = message?.text;
  const contact = message?.contact;
  const miniAppUrl = process.env.MINI_APP_URL ?? process.env.APP_URL;

  if (!token || !chatId) {
    res.sendStatus(200);
    return;
  }

  if (callback?.data && callback.from?.id === Number(process.env.TELEGRAM_ADMIN_CHAT_ID)) {
    const [action, transactionIdText] = String(callback.data).split(":");
    const transactionId = Number(transactionIdText);
    if ((action === "deposit_approve" || action === "deposit_reject" || action === "withdraw_approve" || action === "withdraw_reject") && Number.isSafeInteger(transactionId)) {
      try {
        const approved = action.endsWith("approve");
        if (action.startsWith("deposit")) await reviewDepositRequest(transactionId, approved);
        else await reviewWithdrawalRequest(transactionId, approved);
        await sendTelegramMessage(token, chatId, { text: `${approved ? "✅" : "❌"} ${action.startsWith("deposit") ? "Deposit" : "Withdraw"} ${approved ? "ተፈቅዷል" : "ተሰርዟል"}\nTransaction ID: ${transactionId}` });
      } catch (error) {
        console.error("Telegram transaction review failed", error);
        await sendTelegramMessage(token, chatId, { text: "ይህን የገንዘብ ጥያቄ ማስተካከል አልተቻለም። ቀድሞ ተከናውኖ ሊሆን ይችላል።" });
      }
    }
    await fetch(`https://api.telegram.org/bot${token}/answerCallbackQuery`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ callback_query_id: callback.id }) });
    res.sendStatus(200);
    return;
  }

  if (text === "/start" || (typeof text === "string" && text.startsWith("/start "))) {
    // Reply before touching the database. A database outage must not make Telegram
    // wait for (and eventually retry) the /start update without a response.
    await sendTelegramMessage(token, chatId, {
      text: "እንኳን ወደ 75Bingo በደህና መጡ! ከታች ያለውን ምናሌ ይጠቀሙ።",
      reply_markup: mainMenu(),
    });
    if (message.from?.id) {
      const name = [message.from.first_name, message.from.last_name].filter(Boolean).join(" ");
      try {
        await registerTelegramUser({
          telegramId: message.from.id,
          username: message.from.username,
          displayName: name || message.from.username || `Telegram User ${message.from.id}`,
        });
        const referralMatch = typeof text === "string" ? text.match(/^\/start\s+ref_(\d+)$/) : null;
        if (referralMatch) {
          const reward = await recordReferralRegistration(Number(referralMatch[1]), message.from.id);
          if (reward.credited) await sendTelegramMessage(token, chatId, { text: `🎁 የInvite ሽልማት ${reward.amount} ብር ተጨምሯል።` });
        }
      } catch (error) {
        console.error("Telegram /start user registration failed", error);
      }
    }
  } else if (contact && contact.user_id === message.from?.id) {
    const name = [contact.first_name, contact.last_name].filter(Boolean).join(" ");
    try {
      await registerTelegramUser({
        telegramId: message.from.id,
        username: message.from.username,
        displayName: name || message.from.username || `Telegram User ${message.from.id}`,
        phone: contact.phone_number,
      });
      await sendTelegramMessage(token, chatId, {
        text: `እንኳን ደስ አለዎት ${name}! ምዝገባዎ ተሳክቷል።`,
        reply_markup: mainMenu(),
      });
    } catch (error) {
      console.error("Telegram user registration failed", error);
      await sendTelegramMessage(token, chatId, {
        text: "ምዝገባው አልተሳካም። እባክዎ DATABASE_URL እና ዳታቤዝ ግንኙነቱን ያረጋግጡ።",
        reply_markup: mainMenu(),
      });
    }
  } else if (typeof text === "string") {
    const responses: Record<string, string> = {
      "📝 Register": "ምዝገባዎን ለመጨረስ ከታች ያለውን 'Share Contact' ቁልፍ ይጫኑ።",
      "🎁 Promo Code": "የPromo Code ኮድዎን ይላኩ።",
      "💰 Deposit": "Deposit ለማድረግ Mini App ውስጥ ይግቡ።",
      "💸 Withdraw": "Withdraw ለማድረግ Mini App ውስጥ ይግቡ።",
      "🔗 Invite & Earn": "ጓደኞችዎን ይጋብዙ እና ሽልማት ያግኙ።",
      "👤 Profile & Account": "የመለያዎን መረጃ Mini App ውስጥ ይመልከቱ።",
      "🆘 Support": "እርዳታ ከፈለጉ የጉዳይዎን መልዕክት ይላኩ።",
    };
    if (text === "🎮 Play Bingo") {
      await sendTelegramMessage(token, chatId, {
        text: "75 ቢንጎ ይጫወቱ።",
        reply_markup: gameMenu(miniAppUrl),
      });
    } else if (text === "📝 Register") {
      await sendTelegramMessage(token, chatId, { text: responses[text], reply_markup: contactRequestMenu() });
    } else if (text === "💰 Deposit" && message.from?.id) {
      depositSteps.set(message.from.id, { step: "amount" });
      await sendTelegramMessage(token, chatId, {
        text: "🏦 ባንክ: TeleBirr\n\n⚠️ ከ TeleBirr ወደ TeleBirr ብቻ ያስገቡ።\n\nእባክዎ ብሩን ወደዚህ አካውንት ያስገቡ:\n👤 ስም: tsedey\n👉 ቁጥር: 0933638022\n\nከዚያ ያስገቡትን የብር መጠን ብቻ ይላኩ።\nምሳሌ: 100",
        reply_markup: mainMenu(),
      });
    } else if (text === "💸 Withdraw" && message.from?.id) {
      withdrawalSteps.set(message.from.id, { step: "amount" });
      await sendTelegramMessage(token, chatId, { text: "💸 Withdraw\n\nለማውጣት የሚፈልጉትን የብር መጠን ያስገቡ።" });
    } else if (message.from?.id && withdrawalSteps.get(message.from.id)?.step === "amount") {
      const amount = Number(text.replace(/[, ]/g, ""));
      if (!Number.isFinite(amount) || amount <= 0) await sendTelegramMessage(token, chatId, { text: "እባክዎ ትክክለኛ መጠን ያስገቡ።" });
      else { withdrawalSteps.set(message.from.id, { step: "account", amount }); await sendTelegramMessage(token, chatId, { text: "የሚላክበትን TeleBirr/Bank account ቁጥር ያስገቡ።" }); }
    } else if (message.from?.id && withdrawalSteps.get(message.from.id)?.step === "account") {
      const state = withdrawalSteps.get(message.from.id)!;
      withdrawalSteps.set(message.from.id, { ...state, step: "owner", account: text.trim() });
      await sendTelegramMessage(token, chatId, { text: "የaccount ባለቤት ሙሉ ስም ያስገቡ።" });
    } else if (message.from?.id && withdrawalSteps.get(message.from.id)?.step === "owner") {
      const state = withdrawalSteps.get(message.from.id)!;
      try {
        const transaction = await createWithdrawalRequest(message.from.id, state.amount!, state.account!, text.trim());
        withdrawalSteps.delete(message.from.id);
        const adminChatId = Number(process.env.TELEGRAM_ADMIN_CHAT_ID);
        if (Number.isSafeInteger(adminChatId)) await sendTelegramMessage(token, adminChatId, { text: `🔔 አዲስ Withdraw ጥያቄ\nUser: ${message.from.id}\nAmount: ${transaction.amount} ETB\nAccount: ${state.account}\nOwner: ${text.trim()}\nTransaction ID: ${transaction.id}\nStatus: Pending`, reply_markup: { inline_keyboard: [[{ text: "✅ Approve", callback_data: `withdraw_approve:${transaction.id}` }, { text: "❌ Reject", callback_data: `withdraw_reject:${transaction.id}` }]] } });
        await sendTelegramMessage(token, chatId, { text: `✅ Withdraw ጥያቄዎ ተቀብሏል።\nመጠን: ${transaction.amount} ETB\nሁኔታ: Pending`, reply_markup: mainMenu() });
      } catch (error) { withdrawalSteps.delete(message.from.id); await sendTelegramMessage(token, chatId, { text: error instanceof Error && error.message === "Insufficient main balance" ? "በቂ Main Balance የለዎትም።" : "Withdraw ጥያቄውን ማስመዝገብ አልተቻለም።", reply_markup: mainMenu() }); }
    } else if (message.from?.id && depositSteps.get(message.from.id)?.step === "amount") {
      const amount = Number(text.replace(/[, ]/g, ""));
      if (!Number.isFinite(amount) || amount <= 0) {
        await sendTelegramMessage(token, chatId, { text: "እባክዎ ትክክለኛ የብር መጠን ያስገቡ። ምሳሌ: 100" });
      } else {
        depositSteps.set(message.from.id, { step: "reference", amount });
        await sendTelegramMessage(token, chatId, { text: `✅ መጠን: ${amount.toFixed(2)} ETB\n\nእባክዎ የTeleBirr SMS ማረጋገጫ ሙሉ ጽሑፍ (Tx Ref ያለበት) አሁን ይላኩ።` });
      }
    } else if (message.from?.id && depositSteps.get(message.from.id)?.step === "reference") {
      const deposit = depositSteps.get(message.from.id)!;
      if (text.trim().length < 6) {
        await sendTelegramMessage(token, chatId, { text: "እባክዎ የትክክለኛውን TeleBirr SMS ሙሉ ጽሑፍ ይላኩ።" });
      } else {
        try {
          const transaction = await createDepositRequest(message.from.id, deposit.amount!, text.trim());
          depositSteps.delete(message.from.id);
          const adminChatId = Number(process.env.TELEGRAM_ADMIN_CHAT_ID);
          if (Number.isSafeInteger(adminChatId)) {
            await sendTelegramMessage(token, adminChatId, {
              text: `🔔 አዲስ Deposit ጥያቄ\n\nተጠቃሚ ID: ${message.from.id}\nመጠን: ${transaction.amount} ETB\nTx Ref/SMS:\n${text.trim()}\n\nTransaction ID: ${transaction.id}\nሁኔታ: Pending`,
              reply_markup: { inline_keyboard: [[{ text: "✅ Approve", callback_data: `deposit_approve:${transaction.id}` }, { text: "❌ Reject", callback_data: `deposit_reject:${transaction.id}` }]] },
            });
          }
          await sendTelegramMessage(token, chatId, { text: `✅ የDeposit ጥያቄዎ ተቀብሏል።\n\nመጠን: ${transaction.amount} ETB\nሁኔታ: Pending\n\nአስተዳዳሪ ካረጋገጠ በኋላ ባላንስዎ ይጨምራል።`, reply_markup: mainMenu() });
        } catch (error) {
          console.error("Telegram deposit request failed", error);
          await sendTelegramMessage(token, chatId, { text: "Deposit ጥያቄውን ማስመዝገብ አልተቻለም። /start ይላኩና እንደገና ይሞክሩ።", reply_markup: mainMenu() });
        }
      }
    } else if (text === "↩️ Back to Menu") {
      await sendTelegramMessage(token, chatId, { text: "ዋና ምናሌ።", reply_markup: mainMenu() });
    } else if (text === "🔗 Invite & Earn" && message.from?.id) {
      const botUsername = process.env.TELEGRAM_BOT_USERNAME;
      const inviteLink = botUsername ? `https://t.me/${botUsername}?start=ref_${message.from.id}` : null;
      await sendTelegramMessage(token, chatId, {
        text: inviteLink
          ? `🔗 የእርስዎ የInvite Link:\n\n${inviteLink}\n\n5 ሰዎች ሲመዘገቡ 10 ብር Player Balance ያገኛሉ።\nይህን link ለጓደኞችዎ ያጋሩ።`
          : "የInvite Link ለማመንጨት TELEGRAM_BOT_USERNAME በserver environment ውስጥ ያስገቡ።",
        reply_markup: mainMenu(),
      });
    } else if (text === "👤 Profile & Account" && message.from?.id) {
      try {
        const profile = await getTelegramProfile(message.from.id);
        if (!profile) {
          await sendTelegramMessage(token, chatId, { text: "መለያዎ አልተመዘገበም። /start ይላኩ።", reply_markup: mainMenu() });
        } else {
          await sendTelegramMessage(token, chatId, {
            text: `👤 የእኔ ፕሮፋይል\n\nስም: ${profile.display_name}\nUsername: ${profile.username ? `@${profile.username}` : "—"}\nTelegram ID: ${profile.telegram_id}\nስልክ: ${profile.phone ?? "—"}\nPlayer Balance: ${profile.player_balance} ብር\nMain Balance: ${profile.main_balance} ብር\nየተያዙ ካርዶች: ${profile.card_count}`,
            reply_markup: mainMenu(),
          });
        }
      } catch {
        await sendTelegramMessage(token, chatId, { text: "ፕሮፋይልዎን ማምጣት አልተቻለም።", reply_markup: mainMenu() });
      }
    } else if (responses[text]) {
      await sendTelegramMessage(token, chatId, { text: responses[text], reply_markup: mainMenu() });
    }
  }

  res.sendStatus(200);
};

export async function registerTelegramWebhook() {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const appUrl = process.env.APP_URL ?? process.env.RENDER_EXTERNAL_URL;
  if (!token || !appUrl) {
    console.log("Telegram webhook registration skipped", {
      missingBotToken: !token,
      missingAppUrl: !appUrl,
    });
    return;
  }

  const normalizedUrl = appUrl.replace(/\/$/, "");
  const webhookUrl = `${normalizedUrl}/api/telegram/webhook`;
  const webhookInfoResponse = await fetch(`https://api.telegram.org/bot${token}/getWebhookInfo`);
  if (!webhookInfoResponse.ok) {
    throw new Error(`Telegram getWebhookInfo failed (${webhookInfoResponse.status})`);
  }

  const webhookInfo = await webhookInfoResponse.json() as {
    ok?: boolean;
    result?: { url?: string };
  };
  if (!webhookInfo.ok) throw new Error("Telegram getWebhookInfo returned an unsuccessful response");

  if (webhookInfo.result?.url === webhookUrl) {
    console.log("Telegram webhook already configured", { url: webhookUrl });
  } else {
    const response = await fetch(`https://api.telegram.org/bot${token}/setWebhook`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ url: webhookUrl }),
    });

    if (!response.ok) throw new Error(`Telegram webhook registration failed (${response.status})`);
    console.log("Telegram webhook registered", { url: webhookUrl });
  }

  const miniAppUrl = process.env.MINI_APP_URL ?? normalizedUrl;
  const menuResponse = await fetch(`https://api.telegram.org/bot${token}/setChatMenuButton`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ menu_button: { type: "web_app", text: "🎮 Play Bingo", web_app: { url: miniAppUrl } } }),
  });

  if (!menuResponse.ok) console.error("Telegram Mini App menu button setup failed", menuResponse.status);
}
