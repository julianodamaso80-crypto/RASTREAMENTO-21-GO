export interface SyncResultDto {
  created: number;
  updated: number;
  skipped: number;
  errors: number;
  duration: string;
  startedAt: string;
  finishedAt: string;
}

export interface SyncStatusDto {
  lastSync: string | null;
  nextSync: string | null;
  lastResult: SyncResultDto | null;
  isRunning: boolean;
}
