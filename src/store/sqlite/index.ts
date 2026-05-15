import type Database from "better-sqlite3";
import type { Store } from "../types";
import { IssuesSqlite } from "./issues";
import { TransitionsSqlite } from "./transitions";
import { SprintsSqlite } from "./sprints";
import { StatusesSqlite } from "./statuses";
import { IssueFieldChangesSqlite } from "./issueFieldChanges";
import { IssueSprintsSqlite } from "./issueSprints";
import { SnapshotsSqlite } from "./snapshots";
import { AppConfigSqlite } from "./appConfig";
import { SyncLogSqlite } from "./syncLog";

export class SqliteStore implements Store {
  readonly issues: IssuesSqlite;
  readonly transitions: TransitionsSqlite;
  readonly sprints: SprintsSqlite;
  readonly statuses: StatusesSqlite;
  readonly issueFieldChanges: IssueFieldChangesSqlite;
  readonly issueSprints: IssueSprintsSqlite;
  readonly snapshots: SnapshotsSqlite;
  readonly appConfig: AppConfigSqlite;
  readonly syncLog: SyncLogSqlite;

  constructor(private readonly db: Database.Database) {
    this.issues = new IssuesSqlite(db);
    this.transitions = new TransitionsSqlite(db);
    this.sprints = new SprintsSqlite(db);
    this.statuses = new StatusesSqlite(db);
    this.issueFieldChanges = new IssueFieldChangesSqlite(db);
    this.issueSprints = new IssueSprintsSqlite(db);
    this.snapshots = new SnapshotsSqlite(db);
    this.appConfig = new AppConfigSqlite(db);
    this.syncLog = new SyncLogSqlite(db);
  }

  transaction<T>(fn: () => T): T {
    return this.db.transaction(fn)();
  }
}

export { openDb } from "./schema";
