export type StatusState = "checking" | "ready" | "error";

export type SiteConfig = {
  apiUrl?: string;
};

export type PublicShare = {
  id: string;
  title?: string;
  engine?: string;
  engineLabel?: string;
  createdAt?: string;
  updatedAt?: string;
  redacted?: boolean;
  turnCount?: number;
};

export type SnapshotImage = {
  src?: string;
  alt?: string;
  unavailableReason?: string;
};

export type SnapshotTurn = {
  kind?: string;
  role?: string;
  name?: string;
  text?: string;
  html?: string;
  images?: SnapshotImage[];
  timestamp?: string;
};

export type SnapshotPayload = {
  share?: PublicShare;
  snapshot?: {
    id?: string;
    title?: string;
    engineLabel?: string;
    redacted?: boolean;
    turns?: SnapshotTurn[];
  };
};

declare global {
  interface Window {
    CODEX_SNAPSHOTS_CONFIG?: SiteConfig;
  }
}
