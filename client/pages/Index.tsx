import { useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowLeft,
  Bell,
  Gamepad2,
  Home,
  MoreVertical,
  Star,
  Users,
  Wallet,
} from "lucide-react";
import { io } from "socket.io-client";
import type { BingoWinner } from "@shared/api";

type Cell = number | null;
type Card = { card_number: number; rows: Cell[][] };
type User = {
  id: number;
  telegram_id: string | number;
  username: string | null;
  display_name: string;
  balance: number | string;
};
type GameType = "75";
type GameState = {
  calledNumbers: number[];
  currentBall: number | null;
  playerCount: number;
  prizeAmount: number;
  status: string;
  winners: BingoWinner[];
  selectionEndsAt: string | null;
  gameId: string;
};
declare global {
  interface Window {
    Telegram?: { WebApp?: { initData?: string; ready?: () => void } };
  }
}

function CardView({
  card,
  selected,
  called,
  onClick,
  gameType = "75",
}: {
  card: Card;
  selected: boolean;
  called: Set<number>;
  onClick: () => void;
  gameType?: GameType;
}) {
  return (
    <article
      className={`ticket-card ${selected ? "selected" : ""}`}
      onClick={onClick}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") onClick();
      }}
    >
      <header className="ticket-title">
        <span>✦ {gameType} BINGO</span>
        <b>#{card.card_number}</b>
      </header>
      {gameType === "75" && (
        <div className="ticket-columns" aria-hidden="true">
          {['B', 'I', 'N', 'G', 'O'].map((letter) => <b key={letter}>{letter}</b>)}
        </div>
      )}
      <div className="ticket-grid">
        {card.rows.flatMap((row, rowIndex) =>
          row.map((number, columnIndex) => (
            <span
              key={`${rowIndex}-${columnIndex}`}
              className={number === 0 || (number !== null && called.has(number)) ? "marked" : ""}
            >
              {number === 0 ? "FREE" : number}
            </span>
          )),
        )}
      </div>
      {selected && <small>✓ የተመረጠ</small>}
    </article>
  );
}

export default function Index() {
  const gameType: GameType = "75";
  const [screen, setScreen] = useState<"landing" | "selection">("landing");
  // The gateway selects the configured game service from the gameType query parameter.
  // Empty bases preserve the local same-origin development fallback.
  const apiBase = "";
  const socketBase = "";
  const [user, setUser] = useState<User | null>(null);
  const [authLoaded, setAuthLoaded] = useState(false);
  const [cards, setCards] = useState<Card[]>([]);
  const [selected, setSelected] = useState<number[]>([]);
  const selectionLoaded = useRef(false);

  const selectionScope = user ? String(user.telegram_id) : "anonymous";
  const selectionKey = `neon-${gameType}-selected-cards-${selectionScope}`;
  const readSelected = (key: string) => {
    try {
      const saved = JSON.parse(localStorage.getItem(key) ?? "[]");
      return Array.isArray(saved)
        ? saved.filter((id): id is number => Number.isInteger(id) && id >= 1 && id <= 400).slice(0, 2)
        : [];
    } catch {
      return [];
    }
  };
  const [called, setCalled] = useState<Set<number>>(new Set());
  const [currentBall, setCurrentBall] = useState<number | null>(null);
  const [game, setGame] = useState<GameState | null>(null);
  const [countdown, setCountdown] = useState<number | null>(null);
  const [selectionEndsAt, setSelectionEndsAt] = useState<string | null>(null);
  const [selectionGameStatus, setSelectionGameStatus] = useState<string | null>(null);
  const [gameId, setGameId] = useState<string | null>(null);
  const currentGameId = useRef<string | null>(null);
  const [occupiedCardIds, setOccupiedCardIds] = useState<Set<number>>(new Set());
  const [playing, setPlaying] = useState(false);
  const [finalizing, setFinalizing] = useState(false);
  const [notice, setNotice] = useState("ካርዶች እየተጫኑ ነው...");
  const [panel, setPanel] = useState<"profile" | "wallet" | null>(null);
  const [wallet, setWallet] = useState<{ profile: User; transactions: Array<{ id: number; type: string; amount: string | number; status: string; external_reference?: string; created_at: string }> } | null>(null);
  const [walletForm, setWalletForm] = useState({ amount: "", reference: "", account: "", owner: "" });
  const [walletBusy, setWalletBusy] = useState(false);
  const loadWallet = async () => {
    if (!initData) return;
    const response = await fetch(`${apiBase}/api/wallet`, { headers: { "x-telegram-init-data": initData } });
    if (!response.ok) throw new Error("Wallet unavailable");
    const data = await response.json();
    setWallet(data); setUser(data.profile);
  };
  useEffect(() => {
    if (!authLoaded) return;
    selectionLoaded.current = false;
    setSelected(readSelected(selectionKey));
    selectionLoaded.current = true;
  }, [authLoaded, selectionKey]);
  useEffect(() => {
    if (!authLoaded || !selectionLoaded.current) return;
    localStorage.setItem(selectionKey, JSON.stringify(selected));
  }, [authLoaded, selected, selectionKey]);
  const initData =
    window.Telegram?.WebApp?.initData ||
    new URLSearchParams(window.location.hash.replace(/^#/, "")).get(
      "tgWebAppData",
    ) ||
    new URLSearchParams(window.location.search).get("tgWebAppData") ||
    "";

  useEffect(() => {
    window.Telegram?.WebApp?.ready?.();
    if (!initData) {
      setNotice("ጨዋታውን ለመጫወት Telegram ውስጥ ይክፈቱ።");
      setAuthLoaded(true);
      return;
    }
    fetch(`${apiBase}/api/me`, { headers: { "x-telegram-init-data": initData } })
      .then(async (r) => {
        if (!r.ok)
          throw new Error(
            r.status === 401
              ? "Telegram authentication አልተረጋገጠም።"
              : "Telegram authentication ላይ ስህተት ተፈጥሯል።",
          );
        setUser(await r.json());
      })
      .catch((e) => setNotice(e.message))
      .finally(() => setAuthLoaded(true));
  }, [initData, apiBase]);
  useEffect(() => { if (panel === "wallet") loadWallet().catch((error) => setNotice(error.message)); }, [panel]);
  useEffect(() => {
    const url = `${apiBase}/api/game?gameType=${gameType}${user ? `&userId=${user.id}` : ""}`;
    const applyGameInfo = (activeGame: { id?: string | number; status?: string; selectionEndsAt?: string | null; occupiedCardNumbers?: unknown } | null) => {
      if (!activeGame) return;
      if (activeGame.id !== undefined) {
        const nextGameId = String(activeGame.id);
        if (currentGameId.current && currentGameId.current !== nextGameId) {
          setSelected([]);
          setOccupiedCardIds(new Set());
        }
        currentGameId.current = nextGameId;
        setGameId(nextGameId);
      }
      setSelectionGameStatus(activeGame.status ?? null);
      if (activeGame.selectionEndsAt) {
        setSelectionEndsAt(activeGame.selectionEndsAt);
      } else {
        setSelectionEndsAt(null);
      }
      if (activeGame.status === "finalizing") {
        setFinalizing(true);
        setPlaying(false);
        setCountdown(null);
      }
      if (activeGame.status === "playing") {
        setFinalizing(false);
        setCountdown(null);
        if (selected.length) {
          setPlaying(true);
        } else {
          setPlaying(false);
          setNotice("ይህን ጨዋታ ለመጫወት ቢያንስ አንድ ካርድ ይግዙ። የሚቀጥለውን ዙር ይጠብቁ።");
        }
      }
      setOccupiedCardIds(new Set(Array.isArray(activeGame.occupiedCardNumbers) ? activeGame.occupiedCardNumbers.filter((id): id is number => Number.isInteger(id) && id >= 1 && id <= 400) : []));
    };
    fetch(url).then((r) => r.ok ? r.json() : null).then(applyGameInfo).catch(() => { setSelectionGameStatus(null); setOccupiedCardIds(new Set()); });
    const statusTimer = window.setInterval(() => fetch(url).then((r) => r.ok ? r.json() : null).then(applyGameInfo).catch(() => undefined), 2000);
    return () => window.clearInterval(statusTimer);
  }, [gameType, apiBase, user, selected.length]);
  useEffect(() => {
    fetch(`${apiBase}/api/game/cards?gameType=${gameType}`)
      .then(async (r) => {
        if (!r.ok) throw new Error("Card catalog unavailable");
        setCards(await r.json());
        setNotice("");
      })
      .catch((e) => setNotice(e.message));
  }, [gameType, apiBase]);
  useEffect(() => {
    if (playing || !selectionEndsAt) return;
    const update = () => setCountdown(Math.max(0, Math.ceil((Date.parse(selectionEndsAt) - Date.now()) / 1000)));
    update();
    const timer = window.setInterval(update, 250);
    return () => window.clearInterval(timer);
  }, [selectionEndsAt, playing]);
  useEffect(() => {
    if (!user || !selected.length) return;
    const socket = io(socketBase || undefined, {
      transports: ["polling", "websocket"],
      upgrade: false,
      query: { gameType },
      auth: { initData },
    });
    socket.on("connect", () => {
      setNotice("");
      socket.emit("game:join", { playerId: user.id, cardNumbers: selected, gameType });
    });
    socket.on("connect_error", () => setNotice("የጨዋታ ሰርቨር አይገናኝም።"));
    socket.on("game:error", (e: { message?: string }) =>
      setNotice(e.message || "ወደ ጨዋታው መግባት አልተቻለም።"),
    );
    socket.on("cards:occupied", (cardNumbers: unknown) => {
      if (!Array.isArray(cardNumbers)) return;
      setOccupiedCardIds(new Set(cardNumbers.filter((id): id is number => Number.isInteger(id) && id >= 1 && id <= 400)));
    });
    socket.on("game:announcement", ({ message }: { message?: string }) => setNotice(message || "Game started"));
    socket.on("game:state", (state: GameState) => {
      setGame(state);
      setFinalizing(state.status === "finalizing");
      // Keep the completed round mounted so its winner payload can be shown
      // before the next-round reset runs. Previously `complete` immediately
      // unmounted the playing view and made the winner modal unreachable.
      setPlaying((state.status === "active" || state.status === "complete") && selected.length > 0);
      setCalled(new Set(state.calledNumbers));
      setCurrentBall(state.currentBall);
    });
    return () => {
      socket.emit("game:leave");
      socket.disconnect();
    };
  }, [user, selected, gameType, socketBase]);
  const cardIdentifiers = useMemo(
    () => Array.from({ length: 400 }, (_, index) => index + 1),
    [],
  );
  const cardForId = (id: number) => {
    const visibleId = gameType === "75" && id > 400 ? id - 400 : id;
    return cards.find((card) => card.card_number === visibleId);
  };
  const selectionLocked = selectionGameStatus === "playing";
  const toggle = (id: number) => {
    if (selectionLocked || occupiedCardIds.has(id)) return;
    setSelected((old) =>
      old.includes(id)
        ? old.filter((x) => x !== id)
        : old.length < 2
          ? [...old, id]
          : old,
    );
  };
  const start = () => {
    if (selectionLocked) return setNotice("ጨዋታ እየተካሄደ ነው");
    if (!user) return setNotice("Telegram authentication is required.");
    if (!selected.length) return setNotice("");
    setNotice("ጨዋታው ይጀምራል...");
  };
  const winningLines = (card: Card | undefined) => {
    if (!card) return [];
    const complete = (values: Cell[]) =>
      values.every((cell) => cell === null || cell === 0 || called.has(cell));
    const rows = card.rows
      .map((row, index) => (complete(row) ? index + 1 : null))
      .filter((line): line is number => line !== null);
    const columns = card.rows[0]
      ?.map((_, columnIndex) =>
        complete(card.rows.map((row) => row[columnIndex])) ? columnIndex + 6 : null,
      )
      .filter((line): line is number => line !== null) ?? [];
    const diagonals = [
      complete(card.rows.map((row, index) => row[index])) ? 11 : null,
      complete(card.rows.map((row, index) => row[4 - index])) ? 12 : null,
    ].filter((line): line is number => line !== null);
    const corners = [card.rows[0]?.[0], card.rows[0]?.[4], card.rows[4]?.[0], card.rows[4]?.[4]]
      .every((cell) => cell !== undefined && (cell === 0 || called.has(cell)));
    return [...rows, ...columns, ...diagonals, ...(corners ? [13] : [])];
  };
  const winners = game?.winners ?? [];
  const winner = winners.length > 0;
  const winnerCardIds = winners.map((winner) => winner.cardNumber);
  const winnerCardId = winnerCardIds[0] ?? null;
  useEffect(() => {
    if (!winner || !playing) return;
    const resetTimer = window.setTimeout(() => {
      setPlaying(false);
      setScreen("selection");
      setGame(null);
      setCalled(new Set());
      setCurrentBall(null);
      setSelected([]);
      setGameId(null);
      currentGameId.current = null;
      setOccupiedCardIds(new Set());
      setSelectionEndsAt(null);
      setCountdown(50);
      setNotice("");
    }, 8000);
    return () => window.clearTimeout(resetTimer);
  }, [winner, playing]);
  const winningRows = winningLines(cardForId(winnerCardId ?? -1));
  if (screen === "landing")
    return (
      <main className="app-shell landing-shell">
        <div className="landing-glow landing-glow-one" />
        <div className="landing-glow landing-glow-two" />
        <section className="landing-content">
          <span className="landing-kicker">WELCOME TO</span>
          <h2>
            <span>NEON</span> <strong>{gameType}</strong>
            <br />
            <em>BINGO</em>
          </h2>
          <p>የ75 ቢንጎ ጨዋታን ይጫወቱ።</p>
          <div className="landing-highlights">
            <span>400 ካርዶች</span>
            <i /> <span>እስከ 2 ካርዶች</span>
            <i /> <span>{gameType} ቁጥሮች</span>
          </div>
        </section>
        <button
          className="landing-start"
          onClick={() => {
            setScreen("selection");
            setNotice("");
          }}
        >
          ጨዋታ ጀምር <b>→</b>
        </button>
        <small className="landing-note">ካርድዎን ለመምረጥ ይቀጥሉ</small>
      </main>
    );
  if (finalizing)
    return (
      <main className="app-shell finalizing-shell" aria-live="polite">
        <div className="finalizing-orb" aria-hidden="true" />
        <h1>ጨዋታው እየተዘጋጀ ነው</h1>
        <p>ካርዶች ተረጋግጠዋል። ጨዋታው በቅርቡ ይጀምራል...</p>
      </main>
    );
  if (playing)
    return (
      <main className="app-shell playing-shell">
        <header className="topbar">
          <button
            className="icon-button"
            onClick={() => { setPlaying(false); setCountdown(50); }}
            aria-label="Back"
          >
            <ArrowLeft />
          </button>
          <h1 className="brand">
            <span>NEON</span> <strong>{gameType}</strong> <em>BINGO</em>
          </h1>
          <span className="game-id">Game ID: {game?.gameId ?? gameId ?? "—"}</span>
        </header>
        <section className="stats-row">
          <div className="stat purple">
            <Users />
            <span>
              <small>ተጫዋቾች</small>
              <b>{game?.playerCount ?? 0}/200</b>
            </span>
          </div>
          <div className="stat blue">
            <Wallet />
            <span>
              <small>የሽልማት ፈንድ</small>
              <b>{game?.prizeAmount ?? 0} ብር</b>
            </span>
          </div>
          <div className="stat gold">
            <Star />
            <span>
              <small>የተጠሩ</small>
              <b>{called.size}/75</b>
            </span>
          </div>
        </section>
        <section className="draw">
          <p>የአሁኑ ቁጥር</p>
          <div className="current-ball-layout">
            <strong className="ball-letter">{currentBall === null ? "—" : currentBall <= 15 ? "B" : currentBall <= 30 ? "I" : currentBall <= 45 ? "N" : currentBall <= 60 ? "G" : "O"}</strong>
            <div className="orb">{currentBall ?? "—"}</div>
            <span className="called-count">{called.size}/75</span>
          </div>
        </section>
        <section className="ball-history" aria-label="Called ball history">
          <h2>የኳስ ማሽን</h2>
          <div className="ball-history-list">
            {(game?.calledNumbers ?? []).slice(-45).reverse().map((number, index) => (
              <span key={`${number}-${index}`} className={`ball-cell ${number === currentBall ? "latest" : ""}`} style={{ animationDelay: `${index * 35}ms` }}>{number}</span>
            ))}
            {!game?.calledNumbers?.length && <small>እስካሁን ኳስ አልተጠራም</small>}
          </div>
        </section>
        <section className="tickets">
          {selected.map((id) => {
            const card = cardForId(id);
            return (
              card && (
                <CardView
                  key={id}
                  card={card}
                  selected
                  called={called}
                  onClick={() => undefined}
                  gameType={gameType}
                />
              )
            );
          })}
        </section>
        {winner && (
          <>
            <div className="confetti" aria-label="Winner celebration">
              {Array.from({ length: 28 }, (_, index) => (
                <i key={index} style={{ left: `${(index * 37) % 100}%`, animationDelay: `${-(index % 9) / 3}s` }} />
              ))}
            </div>
            <div className="winner-modal" role="status">
              <div className="winner-crown" aria-hidden="true">♛</div>
              <div className="winner-badge"><span>🎉</span> BINGO! <span>🎉</span></div>
              <h2>{winners.length > 1 ? "አሸናፊዎች ተገኝተዋል" : "አሸናፊ ተገኝቷል"}</h2>
              <div className="winner-prize">{((game?.prizeAmount ?? 0) / winners.length).toFixed(2)} ብር / እያናቸው</div>
              <p>የአሸናፊው ስም: <b>{winners.map((item) => item.displayName).join(", ")}</b></p>
              <p>የአሸናፊ ካርዶች: <b>{winnerCardIds.map((id) => id > 400 ? id - 400 : id).join(", ")}</b></p>
              <p>የተዘጉ መስመሮች: <b>{winners.map((item) => item.rows.map((row) => row <= 5 ? `መስመር ${row}` : row === 13 ? "አራት ማዕዘኖች" : row === 11 ? "ዲያጎናል 1" : row === 12 ? "ዲያጎናል 2" : `አምድ ${row - 5}`).join(", ")).join("; ")}</b></p>
              <div className="winner-card-preview">
                {winnerCardIds.slice(0, 1).map((id, index) => { const card = cardForId(id); return card && <div className="winner-card-item" key={id}><small>ካርድ #{id > 400 ? id - 400 : id}</small><CardView card={card} selected called={called} onClick={() => undefined} gameType={gameType} /><span>የዘጋው: {winners[index]?.rows.map((row) => row <= 5 ? `መስመር ${row}` : row === 13 ? "አራት ማዕዘኖች" : row === 11 || row === 12 ? "ዲያጎናል" : `አምድ ${row - 5}`).join(", ")}</span></div>; })}
              </div>
              <small>አዲስ ጨዋታ በቅርቡ ይጀምራል...</small>
            </div>
          </>
        )}
        {panel && <aside className="account-panel" role="dialog" aria-label={panel === "profile" ? "Profile" : "Wallet"}><button className="icon-button" onClick={() => setPanel(null)} aria-label="Close"><ArrowLeft /></button><h2>{panel === "profile" ? "መገለጫ" : "Wallet"}</h2>{panel === "profile" ? <p>{user?.display_name || "Telegram player"}</p> : <><p>ቀሪ ሂሳብ: <strong>{wallet?.profile.balance ?? user?.balance ?? 0} ብር</strong></p><form onSubmit={async (event) => { event.preventDefault(); setWalletBusy(true); try { const response = await fetch(`${apiBase}/api/wallet/deposit`, { method: "POST", headers: { "content-type": "application/json", "x-telegram-init-data": initData }, body: JSON.stringify({ amount: walletForm.amount, reference: walletForm.reference }) }); if (!response.ok) throw new Error((await response.json()).error || "Deposit failed"); setWalletForm({ ...walletForm, amount: "", reference: "" }); await loadWallet(); } catch (error) { setNotice(error instanceof Error ? error.message : "Deposit failed"); } finally { setWalletBusy(false); } }}><h3>Deposit request</h3><input required type="number" min="1" step="0.01" placeholder="Amount" value={walletForm.amount} onChange={(e) => setWalletForm({ ...walletForm, amount: e.target.value })} /><input required placeholder="Payment reference" value={walletForm.reference} onChange={(e) => setWalletForm({ ...walletForm, reference: e.target.value })} /><button disabled={walletBusy}>Submit deposit</button></form><form onSubmit={async (event) => { event.preventDefault(); setWalletBusy(true); try { const response = await fetch(`${apiBase}/api/wallet/withdraw`, { method: "POST", headers: { "content-type": "application/json", "x-telegram-init-data": initData }, body: JSON.stringify({ amount: walletForm.amount, account: walletForm.account, owner: walletForm.owner }) }); if (!response.ok) throw new Error((await response.json()).error || "Withdrawal failed"); setWalletForm({ ...walletForm, amount: "", account: "", owner: "" }); await loadWallet(); } catch (error) { setNotice(error instanceof Error ? error.message : "Withdrawal failed"); } finally { setWalletBusy(false); } }}><h3>Withdraw</h3><input required type="number" min="1" step="0.01" placeholder="Amount" value={walletForm.amount} onChange={(e) => setWalletForm({ ...walletForm, amount: e.target.value })} /><input required placeholder="Account" value={walletForm.account} onChange={(e) => setWalletForm({ ...walletForm, account: e.target.value })} /><input required placeholder="Account owner" value={walletForm.owner} onChange={(e) => setWalletForm({ ...walletForm, owner: e.target.value })} /><button disabled={walletBusy}>Submit withdrawal</button></form><h3>Recent transactions</h3>{wallet?.transactions.map((transaction) => <p key={transaction.id}><b>{transaction.type === "deposit" ? "+" : "-"}{transaction.amount} ብር</b> · {transaction.status} · {new Date(transaction.created_at).toLocaleDateString()}</p>)}</>}</aside>}
      </main>
    );
  return (
    <main className="app-shell">
      <header className="topbar">
        <button
          className="icon-button"
          onClick={() => history.back()}
          aria-label="Back"
        >
          <ArrowLeft />
        </button>
        <h1 className="brand">
          <span>NEON</span> <strong>{gameType}</strong> <em>BINGO</em>
        </h1>
        <div className="top-actions">
          <button
            onClick={() => setNotice("ማሳወቂያ የለም።")}
            aria-label="Notifications"
          >
            <Bell />
          </button>
          <button aria-label="More" onClick={() => setPanel("profile")}>
            <MoreVertical />
          </button>
        </div>
      </header>
      <section className="stats-row">
        <div className="stat purple">
          <Users />
          <span>
            <small>ተጫዋቾች</small>
            <b>{game?.playerCount ?? 0}/200</b>
          </span>
        </div>
        <div className="stat blue">
          <Wallet />
          <span>
            <small>ቀሪ ሂሳብ</small>
            <b>{user?.balance ?? 0} ብር</b>
          </span>
        </div>
        <div className="stat gold">
          <Star />
          <span>
            <small>የተመረጡ ካርዶች</small>
            <b>{selected.length}/2</b>
          </span>
        </div>
      </section>
      <div className="game-id selection-game-id">Game ID: {game?.gameId ?? gameId ?? "—"}</div>
      <div className="selection-countdown" aria-live="polite">
        <span>{selectionLocked ? "ጨዋታ እየተካሄደ ነው" : "ጨዋታው ይጀምራል"}</span>
        <b>{selectionLocked ? "00" : countdown ?? 50}</b>
        <small>ሰከንድ</small>
      </div>
      <section className="number-grid" aria-label="Card identifiers">
        {cardIdentifiers.map((id) => (
          <button
            key={id}
            className={`${selected.includes(id) ? "active" : ""} ${occupiedCardIds.has(id) ? "occupied" : ""}`}
            onClick={() => toggle(id)}
            disabled={selectionLocked || occupiedCardIds.has(id)}
            aria-pressed={selected.includes(id)}
            aria-label={occupiedCardIds.has(id) ? `Card ${id}, occupied` : `Card ${id}`}
          >
            {id}
          </button>
        ))}
      </section>
      <section
        className="selected-previews"
        aria-label="Selected card previews"
      >
        <h2>
          የተመረጡ ካርዶች <span>{selected.length}/2</span>
        </h2>
        <div className="tickets">
          {selected.map((id) => {
            const card = cardForId(id);
            return (
              card && (
                <CardView
                  key={id}
                  card={card}
                  selected
                  called={called}
                  onClick={() => toggle(id)}
                  gameType={gameType}
                />
              )
            );
          })}
        </div>
      </section>
      {notice && (
        <div className="notice" role="status">
          {notice}
        </div>
      )}
      <button
        className="start-button"
        disabled={selectionLocked || !selected.length || countdown !== null}
        onClick={start}
      >
        {countdown !== null ? `ይጀምራል ${countdown}` : "ጨዋታ ጀምር"}
      </button>
      <nav className="bottom-nav">
        <button className="lobby" onClick={() => { setScreen("landing"); setCountdown(null); setSelected([]); setNotice(""); }}>
          <Home />
          <span>Lobby</span>
        </button>
        <button
          className="game-tab"
          onClick={() => {
            setScreen("selection");
            setPanel(null);
            setNotice("");
            if (selectionGameStatus === "playing") {
              setFinalizing(false);
              setCountdown(null);
              setPlaying(true);
            } else if (selectionGameStatus === "finalizing") {
              setPlaying(false);
              setFinalizing(true);
              setCountdown(null);
            } else {
              setPlaying(false);
              setFinalizing(false);
            }
          }}
          aria-current="page"
        >
          <Gamepad2 />
          <span>Game</span>
        </button>
        <button onClick={() => setPanel("wallet")}>
          <Wallet />
          <span>Wallet</span>
        </button>
      </nav>
    </main>
  );
}
