import { describe, it, expectTypeOf } from "vitest";
import type {
  ReadStore, WriteStore, Store,
  IssueRecord, TransitionRecord, SprintRecord,
  StatusRecord, IssueFieldChangeRecord, IssueSprintRecord,
  SnapshotRecord, SyncLogRecord,
} from "../../src/store/types";

describe("Store types", () => {
  it("Store extends both ReadStore and WriteStore", () => {
    expectTypeOf<Store>().toMatchTypeOf<ReadStore>();
    expectTypeOf<Store>().toMatchTypeOf<WriteStore>();
  });

  it("ReadStore.issues.byKey returns nullable", () => {
    expectTypeOf<ReadStore["issues"]["byKey"]>().returns.toEqualTypeOf<IssueRecord | null>();
  });

  it("WriteStore.transitions.replaceForIssues accepts items without id", () => {
    type Arg = Parameters<WriteStore["transitions"]["replaceForIssues"]>[0];
    expectTypeOf<Arg[number]["rows"][number]>().toEqualTypeOf<Omit<TransitionRecord, "id">>();
  });

  it("WriteStore.transaction returns the callback's return value", () => {
    // pourquoi : la syntaxe `S["transaction"]<number>` du plan est un parse error TS
    // (on ne peut pas appliquer des type-args à un index access). On exerce le générique
    // en l'appelant via une déclaration jamais exécutée — équivalent sémantique.
    const tx = ((): WriteStore["transaction"] => { throw new Error("type-only"); })();
    const result = tx<number>(() => 42);
    expectTypeOf(result).toEqualTypeOf<number>();
  });
});
