import type { SnapshotTurn } from "../core/snapshot";

export type StatusState = "checking" | "ready" | "error";

export type SiteConfig = {
  apiUrl?: string;
};

export type PublicShare = {
  id: string;
  title?: string;
  engine?: string;
  engineLabel?: string;
  goalObjective?: string;
  createdAt?: string;
  updatedAt?: string;
  redacted?: boolean;
  turnCount?: number;
};

export type { SnapshotImage, SnapshotTurn } from "../core/snapshot";

export type SnapshotPayload = {
  share?: PublicShare;
  snapshot?: {
    id?: string;
    title?: string;
    engineLabel?: string;
    goalObjective?: string;
    redacted?: boolean;
    turns?: SnapshotTurn[];
  };
};

declare global {
  interface Window {
    CODEX_SNAPSHOTS_CONFIG?: SiteConfig;
  }
}
