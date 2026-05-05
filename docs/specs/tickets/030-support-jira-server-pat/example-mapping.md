# Example Mapping — Support Jira Server / Data Center (PAT auth)

## Règle 1 — Mode PAT actif si `personalAccessToken` présent et non vide

**Si `personalAccessToken` est fourni, le header `Authorization: Bearer` est utilisé à la place de Basic auth.**

```gherkin
Scenario: config PAT valide
  Given config.yaml contient personalAccessToken: "mon-token-server"
  When JiraClient est instancié
  Then les requêtes HTTP portent le header "Authorization: Bearer mon-token-server"
  And aucune propriété "auth" Basic n'est configurée sur l'instance Axios

Scenario: personalAccessToken vide → fallback Basic
  Given config.yaml contient personalAccessToken: "" et email: "u@c.com" et apiToken: "tok"
  When JiraClient est instancié
  Then les requêtes HTTP utilisent Basic auth avec username "u@c.com"
```

## Règle 2 — Validation de la config au chargement

**loadJiraConfig échoue avec un message clair si ni PAT ni Basic ne sont fournis.**

```gherkin
Scenario: config incomplète sans PAT ni Basic
  Given config.yaml contient jira.baseUrl mais pas personalAccessToken, email, ni apiToken
  When loadJiraConfig est appelé
  Then le processus s'arrête avec le message "config.yaml : fournir soit personalAccessToken, soit email + apiToken"

Scenario: les deux présents → PAT prioritaire
  Given config.yaml contient personalAccessToken: "pat" ET email: "u@c.com" ET apiToken: "tok"
  When JiraClient est instancié
  Then les requêtes HTTP portent "Authorization: Bearer pat"
  And Basic auth n'est pas utilisé
```
