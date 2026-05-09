import { describe, it, expect, vi, afterEach } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import yaml from "yaml";
import { loadJiraConfig, loadBoardConfig, loadConfigs } from "../../src/main";

function writeTmpYaml(obj: unknown): string {
  const file = path.join(os.tmpdir(), `lean-jira-test-${Math.random().toString(36).slice(2)}.yaml`);
  fs.writeFileSync(file, yaml.stringify(obj), "utf-8");
  return file;
}

const jiraPayload = {
  jira: { baseUrl: "https://jira.example.com", email: "u@example.com", apiToken: "tok", projectKey: "PROJ", boardId: 42 },
  db: { path: "./test.db" },
};

const boardPayload = {
  board: {
    columns: [
      { name: "Todo", type: "todo", statuses: ["To Do"] },
      { name: "Dev", type: "active", devStart: true, statuses: ["In Progress"] },
      { name: "Done", type: "done", statuses: ["Done"] },
    ],
  },
  metrics: { cutoffDate: "2025-01-01", bugIssueTypes: ["Bug"] },
};

afterEach(() => {
  vi.restoreAllMocks();
});

describe("loadJiraConfig", () => {
  it("charge jira + db depuis un fichier YAML valide", () => {
    const file = writeTmpYaml(jiraPayload);
    const config = loadJiraConfig(file);
    expect(config.jira.baseUrl).toBe("https://jira.example.com");
    expect(config.jira.boardId).toBe(42);
    expect(config.db.path).toBe("./test.db");
  });

  it("mode Basic complet (email + apiToken) → valide sans erreur", () => {
    const file = writeTmpYaml(jiraPayload);
    expect(() => loadJiraConfig(file)).not.toThrow();
  });

  it("mode PAT seul (sans email ni apiToken) → valide sans erreur", () => {
    const payload = {
      jira: { baseUrl: "https://jira.example.com", personalAccessToken: "mon-pat", projectKey: "PROJ", boardId: 42 },
      db: { path: "./test.db" },
    };
    const file = writeTmpYaml(payload);
    expect(() => loadJiraConfig(file)).not.toThrow();
  });

  it("ni PAT ni email+apiToken → exit(1) avec message explicite", () => {
    const payload = {
      jira: { baseUrl: "https://jira.example.com", projectKey: "PROJ", boardId: 42 },
      db: { path: "./test.db" },
    };
    const file = writeTmpYaml(payload);
    const exitSpy = vi.spyOn(process, "exit").mockImplementation((code) => {
      throw new Error(`process.exit:${code}`);
    });
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);

    expect(() => loadJiraConfig(file)).toThrow("process.exit:1");
    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(errSpy).toHaveBeenCalledWith(expect.stringContaining("personalAccessToken"));
    expect(errSpy).toHaveBeenCalledWith(expect.stringContaining("email + apiToken"));
  });

  it("PAT vide (\"\") + sans email → exit(1)", () => {
    const payload = {
      jira: { baseUrl: "https://jira.example.com", personalAccessToken: "", projectKey: "PROJ", boardId: 42 },
      db: { path: "./test.db" },
    };
    const file = writeTmpYaml(payload);
    vi.spyOn(process, "exit").mockImplementation((code) => {
      throw new Error(`process.exit:${code}`);
    });
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    expect(() => loadJiraConfig(file)).toThrow("process.exit:1");
  });

  it("PAT + email + apiToken → PAT prioritaire, config retournée contient le PAT", () => {
    const payload = {
      jira: { ...jiraPayload.jira, personalAccessToken: "mon-pat" },
      db: jiraPayload.db,
    };
    const file = writeTmpYaml(payload);
    const config = loadJiraConfig(file);
    expect(config.jira.personalAccessToken).toBe("mon-pat");
  });

  it("frontendUrl optionnel : absent → undefined", () => {
    const file = writeTmpYaml(jiraPayload);
    const config = loadJiraConfig(file);
    expect(config.jira.frontendUrl).toBeUndefined();
  });

  it("frontendUrl optionnel : présent → propagé tel quel", () => {
    const payload = {
      ...jiraPayload,
      jira: { ...jiraPayload.jira, frontendUrl: "https://jira.cloud.example.com" },
    };
    const file = writeTmpYaml(payload);
    const config = loadJiraConfig(file);
    expect(config.jira.frontendUrl).toBe("https://jira.cloud.example.com");
  });
});

describe("loadBoardConfig", () => {
  it("charge board + metrics depuis un fichier YAML valide", () => {
    const file = writeTmpYaml(boardPayload);
    const config = loadBoardConfig(file);
    expect(config.board.columns).toHaveLength(3);
    expect(config.board.columns[0].type).toBe("todo");
    expect(config.metrics?.cutoffDate).toBe("2025-01-01");
  });

  it("board.yaml absent → exit(1) avec message d'aide", () => {
    const exitSpy = vi.spyOn(process, "exit").mockImplementation((code) => {
      throw new Error(`process.exit:${code}`);
    });
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);

    expect(() => loadBoardConfig(path.join(os.tmpdir(), "absent-board-xyz.yaml"))).toThrow("process.exit:1");
    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(errSpy).toHaveBeenCalledWith(expect.stringContaining("board.yaml introuvable"));
    expect(errSpy).toHaveBeenCalledWith(expect.stringContaining("npm run autoconfig -- --apply"));
  });
});

describe("loadConfigs", () => {
  it("fusionne jira+db et board+metrics en une seule AppConfig", () => {
    const jiraFile = writeTmpYaml(jiraPayload);
    const boardFile = writeTmpYaml(boardPayload);
    const config = loadConfigs(jiraFile, boardFile);
    expect(config.jira.projectKey).toBe("PROJ");
    expect(config.board.columns).toHaveLength(3);
    expect(config.metrics?.cutoffDate).toBe("2025-01-01");
    expect(config.db.path).toBe("./test.db");
  });

  it("board.yaml absent → exit(1)", () => {
    const jiraFile = writeTmpYaml(jiraPayload);
    vi.spyOn(process, "exit").mockImplementation((code) => {
      throw new Error(`process.exit:${code}`);
    });
    vi.spyOn(console, "error").mockImplementation(() => undefined);

    expect(() => loadConfigs(jiraFile, path.join(os.tmpdir(), "absent-board-xyz.yaml"))).toThrow("process.exit:1");
  });
});
