export type SnapshotImage = {
  src?: string;
  alt?: string;
  unavailableReason?: string;
};

export type SnapshotTurn = {
  kind?: string;
  role?: string;
  name?: string;
  turn?: number;
  text?: string;
  html?: string;
  images?: SnapshotImage[];
  timestamp?: string;
};

export type SnapshotRisk = {
  severity: "low" | "medium" | "high" | string;
  label: string;
  count: number;
  turns: number[];
};

export type SnapshotNotice = {
  severity?: "low" | "medium" | "high" | string;
  label?: string;
  text?: string;
};

export type Snapshot = {
  id?: string;
  ref?: string;
  title?: string;
  engine?: string;
  engineLabel?: string;
  sourceDetail?: string;
  goalObjective?: string;
  cwd?: string;
  displayCwd?: string;
  filePath?: string;
  displayFilePath?: string;
  generatedAt?: string;
  redacted?: boolean;
  size?: number;
  turnCount?: number;
  turns?: SnapshotTurn[];
  risks?: SnapshotRisk[];
  notices?: SnapshotNotice[];
  safetyChecks?: boolean;
};

export type PublicShare = {
  id: string;
  title?: string;
  engine?: string;
  engineLabel?: string;
  goalObjective?: string;
  createdAt?: string;
  updatedAt?: string;
  expiresAt?: string | null;
  redacted?: boolean;
  turnCount?: number;
  owner?: {
    id: string;
    login: string;
    avatarUrl?: string;
    profileUrl?: string;
  } | null;
};

export type SnapshotSharePayload = {
  schemaVersion?: number;
  share?: PublicShare;
  snapshot?: Snapshot;
};
