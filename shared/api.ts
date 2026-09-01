/**
 * Shared code between client and server
 * Useful to share types between client and server
 * and/or small pure JS functions that can be used on both client and server
 */

/**
 * Example response type for /api/demo
 */
export interface DemoResponse {
  message: string;
}

export type BingoGameType = "75";

export interface BingoWinner {
  userId: number;
  displayName: string;
  cardNumber: number;
  rows: number[];
  prizeAmount: number;
}

export type WalletBalanceType = "player" | "main";

export interface WalletProfile {
  id: number;
  telegram_id: string | number;
  username: string | null;
  display_name: string;
  phone?: string | null;
  player_balance: number | string;
  main_balance: number | string;
  balance: number | string;
  card_count: number;
}

export interface WalletTransaction {
  id: number;
  type: string;
  amount: number | string;
  balance_type: WalletBalanceType;
  status: string;
  external_reference?: string | null;
  created_at: string;
}

export interface WalletResponse {
  profile: WalletProfile;
  transactions: WalletTransaction[];
}
