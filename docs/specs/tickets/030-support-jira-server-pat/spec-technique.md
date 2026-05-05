# Spec technique — Support Jira Server / Data Center (PAT auth)

## Impact fichiers

| Fichier | Modification |
|---|---|
| `src/jira/client.ts` | `JiraConfig` : `email`/`apiToken` optionnels + `personalAccessToken?` ; constructeur conditionnel |
| `src/main.ts` | `JiraFileConfig.jira` : mêmes champs optionnels + validation dans `loadJiraConfig` |
| `src/sync.ts` | `SyncConfig.jira` : idem (cohérence de type) |
| `config.example.yaml` | Ajouter bloc commenté mode PAT |

---

## 1. `src/jira/client.ts` — JiraConfig + constructeur

### Interface (lignes 14–20 actuelles)

```typescript
interface JiraConfig {
  baseUrl: string;
  email?: string;
  apiToken?: string;
  personalAccessToken?: string;
  projectKey: string;
  boardId: number;
}
```

### Constructeur (lignes 26–33 actuelles)

```typescript
constructor(config: JiraConfig) {
  this.boardId = config.boardId;

  const usePat = config.personalAccessToken && config.personalAccessToken.length > 0;

  this.http = axios.create({
    baseURL: config.baseUrl,
    ...(usePat
      ? { headers: { Authorization: `Bearer ${config.personalAccessToken}`, "Content-Type": "application/json" } }
      : { auth: { username: config.email!, password: config.apiToken! }, headers: { "Content-Type": "application/json" } }),
  });
}
```

---

## 2. `src/main.ts` — JiraFileConfig + validation

### Interface (lignes 111–121 actuelles)

```typescript
export interface JiraFileConfig {
  jira: {
    baseUrl: string;
    frontendUrl?: string;
    email?: string;
    apiToken?: string;
    personalAccessToken?: string;
    projectKey: string;
    boardId: number;
  };
  db: { path: string };
}
```

### Validation dans `loadJiraConfig` (ligne 135)

```typescript
export function loadJiraConfig(configPath: string): JiraFileConfig {
  const cfg = yaml.parse(fs.readFileSync(configPath, "utf-8")) as JiraFileConfig;
  const j = cfg.jira;
  const hasPat = j.personalAccessToken && j.personalAccessToken.length > 0;
  const hasBasic = j.email && j.apiToken;
  if (!hasPat && !hasBasic) {
    console.error("config.yaml : fournir soit personalAccessToken, soit email + apiToken");
    process.exit(1);
  }
  return cfg;
}
```

---

## 3. `src/sync.ts` — SyncConfig

### Interface (lignes 5–13 actuelles)

```typescript
interface SyncConfig {
  jira: {
    baseUrl: string;
    email?: string;
    apiToken?: string;
    personalAccessToken?: string;
    projectKey: string;
    boardId: number;
  };
  db: { path: string };
}
```

Pas d'autre changement dans `sync.ts` — `JiraClient` reçoit `config.jira` directement.

---

## 4. `config.example.yaml`

Ajouter sous le bloc `apiToken` existant :

```yaml
  # Pour Jira Server / Data Center avec PAT (Personal Access Token) :
  # Remplacer email + apiToken par :
  # personalAccessToken: "votre-PAT-server"
  # (email et apiToken peuvent être omis en mode PAT)
```

---

## Ordre d'implémentation

1. Modifier `JiraConfig` dans `client.ts` + constructeur conditionnel — tests unitaires d'abord (TDD)
2. Modifier `JiraFileConfig` dans `main.ts` + validation dans `loadJiraConfig`
3. Modifier `SyncConfig` dans `sync.ts`
4. Mettre à jour `config.example.yaml`
