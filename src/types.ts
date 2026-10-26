export interface Member {
  id: string;
  token_id: string;
  password_hash: string;
  full_name: string | null;
  region: string | null;
  telegram_user_id: number | null;
  registered_at: string | null;
  failed_attempts: number;
  locked_until: string | null;
  is_active: boolean;
}

export type ResolutionStatus = "draft" | "open" | "closed";

export type Threshold = "simple" | "two_thirds";

export interface Resolution {
  id: string;
  code: string;
  title: string;
  description: string | null;
  options: string[];
  anonymous: boolean;
  quorum: number | null;
  threshold: Threshold;
  status: ResolutionStatus;
  announce_chat_id: number | null;
  announce_thread_id: number | null;
  closes_at: string | null;
  opened_at: string | null;
  closed_at: string | null;
}

export type CastVoteResult =
  | "ok"
  | "changed"
  | "already_voted"
  | "not_open"
  | "not_found"
  | "bad_choice";

export interface TallyRow {
  choice_index: number;
  votes: number;
}
