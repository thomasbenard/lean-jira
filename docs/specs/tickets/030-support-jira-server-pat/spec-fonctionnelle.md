# Spec fonctionnelle — Support Jira Server / Data Center (PAT auth)

## Contexte

lean-jira utilise actuellement l'authentification Basic avec `email` + `apiToken`. Cette combinaison fonctionne pour Jira Cloud (API token Atlassian) et pour Jira Server avec basic auth (username + password). En revanche, les instances Server/Data Center configurées pour n'accepter que des Personal Access Tokens (PAT) — introduits en Server 8.14 et DC — ne peuvent pas s'authentifier avec ce schéma.

## Comportement attendu

### Configuration

L'utilisateur peut choisir entre deux modes dans `config.yaml` :

**Mode Basic (existant, inchangé) :**
```yaml
jira:
  baseUrl: "https://jira.company.com"
  email: "user@company.com"
  apiToken: "mot-de-passe-ou-api-token"
  projectKey: "PROJ"
  boardId: 1
```

**Mode PAT (nouveau) :**
```yaml
jira:
  baseUrl: "https://jira.company.com"
  personalAccessToken: "mon-PAT-server"
  projectKey: "PROJ"
  boardId: 1
```

### Détection du mode

- Si `personalAccessToken` est présent et non vide → mode PAT ; `email` et `apiToken` ignorés.
- Si `personalAccessToken` absent → mode Basic ; `email` et `apiToken` requis.

### Validation au démarrage

Si la config est incohérente, `loadJiraConfig` lève une erreur explicite avant toute requête :

- `personalAccessToken` absent ET (`email` absent OU `apiToken` absent) → message :
  `"config.yaml : fournir soit personalAccessToken, soit email + apiToken"`

### Comportement réseau

Mode Basic : `Authorization: Basic <base64(email:apiToken)>` (comportement Axios `auth:` actuel).
Mode PAT : header `Authorization: Bearer <personalAccessToken>`, sans `auth:`.

Aucun autre changement de requête (endpoints identiques entre Cloud et Server).

## Cas limites

- `personalAccessToken: ""` (chaîne vide) → traité comme absent → mode Basic requis.
- Les deux présents (`personalAccessToken` + `email` + `apiToken`) → PAT prioritaire, Basic ignoré.
- `baseUrl` se termine par `/` → comportement inchangé (géré par Axios).

## Limitations connues

- **Jira Server ≥ 8.x uniquement.** Server < 8.x sérialise `customfield_10020` (sprint) en chaîne Java brute (`com.atlassian.greenhopper.service.sprint.Sprint@…`) plutôt qu'un objet JSON. `sync.ts` ne gère pas ce format : la table `sprints` resterait vide et les métriques sprint-scoped (`wip`) seraient faussées sans erreur explicite. Tout Data Center (DC) est supporté.
- PAT introduit en Server 8.14 — les versions 8.0–8.13 ne supportent pas PAT mais supportent basic auth (username + password via les champs `email`/`apiToken` existants).

## Ce qui ne change pas

- Endpoints REST (`/rest/agile/1.0/`, `/rest/api/2/`) : identiques, non modifiés.
- Logique de sync, métriques, snapshots, rapport : aucun changement.
- Comportement pour les utilisateurs Cloud existants : aucune régression possible (PAT absent → chemin Basic existant).
- Le champ `frontendUrl` reste optionnel et indépendant du mode d'auth.
