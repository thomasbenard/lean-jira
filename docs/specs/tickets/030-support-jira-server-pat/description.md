# Ticket 030 — Support Jira Server / Data Center (PAT auth)

## User story

En tant que lead technique sur une instance Jira auto-hébergée (Server ou Data Center), je veux configurer lean-jira avec un Personal Access Token, afin de synchroniser mes données sans passer par l'authentification Basic Cloud (email + API token Atlassian).

## Solution retenue

Ajouter un champ optionnel `personalAccessToken` dans `config.yaml`. Si ce champ est présent, `JiraClient` utilise `Authorization: Bearer <token>` au lieu de Basic auth. Les champs `email` et `apiToken` deviennent optionnels (l'un ou l'autre couple doit être fourni). Une validation au chargement de la config détecte les combinaisons invalides et affiche un message d'erreur clair.

L'API REST Jira (v2 + Agile v1) est identique entre Cloud et Server/DC — seul le mécanisme d'auth diffère. Aucun changement de requête n'est nécessaire au-delà du constructeur `JiraClient`.

> **Limitation** : Jira Server ≥ 8.x et tout Data Center uniquement. Server < 8.x retourne `customfield_10020` (sprint) sous forme de chaîne sérialisée Java (`com.atlassian.greenhopper...`) au lieu d'un objet JSON — le parsing côté `sync.ts` échouerait silencieusement (table `sprints` vide, WIP faussé). Pas de détection ni de workaround prévu dans ce ticket.

## Estimation

**Bucket** : S

**Justification** : 3 fichiers touchés (`client.ts`, `main.ts`, `sync.ts`) + `config.example.yaml`. Pattern simple : condition dans le constructeur. 3–4 scénarios de test. Aucune migration DB. Risque bas — Basic auth existant non modifié.

## Statut

**livré**
