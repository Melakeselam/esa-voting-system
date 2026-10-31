export interface Member {
  id: string;
  org_id: string; // the organisation (assembly) this invitation belongs to
  token_id: string;
  password_hash: string;
  full_name: string | null;
  region: string | null;
  telegram_user_id: number | null;
  registered_at: string | null;
  failed_attempts: number;
  locked_until: string | null;
  is_active: boolean;
  council_id: string | null;
  seat_no: number | null;
  vote_weight: number;
  phone: string | null; // international form, e.g. +251911234567
}

export interface Council {
  id: string;
  name: string;
  code: string;
  seats: number;
  vote_weight: number; // votes carried by each delegate
  created_at: string;
}

export type ResolutionStatus = "draft" | "open" | "closed";

export type Threshold = "simple" | "two_thirds";

export interface Resolution {
  id: string;
  org_id: string;
  code: string;
  title: string;
  description: string | null;
  options: string[];
  anonymous: boolean;
  quorum: number | null; // % of eligible members who must cast a ballot (1–100); null = no quorum
  eligible_count: number | null; // active members when voting closed; null while open
  activation_required: boolean; // voters must enter the 4-digit code shown in the meeting
  activation_code: string | null; // set when voting opens (if required); never sent to members
  awaiting_quorum_since: string | null; // deadline passed without quorum; still open, admins decide
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
