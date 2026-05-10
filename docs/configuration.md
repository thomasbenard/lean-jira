# Guide de configuration lean-jira

> **Objectif :** configurer lean-jira depuis zéro et générer un premier rapport en moins de 15 minutes.

**Lien rapide :** si tu es déjà configuré → [Référence complète](#5-référence-complète)

---

## Table des matières

1. [Pré-requis — ce qu'il faut récupérer dans Jira](#1-pré-requis--ce-quil-faut-récupérer-dans-jira)
2. [config.yaml — connexion Jira](#2-configyaml--connexion-jira)
3. [board.yaml — définition du board](#3-boardyaml--définition-du-board)
4. [Valider et premier lancement](#4-valider-et-premier-lancement)
5. [Référence complète](#5-référence-complète)
6. [Cas avancés](#6-cas-avancés)
7. [Troubleshooting](#7-troubleshooting)

---

## 1. Pré-requis — ce qu'il faut récupérer dans Jira

Avant de créer les fichiers de config, récupérer ces 3 informations depuis Jira :

| Information | Où la trouver | Exemple |
|---|---|---|
| `projectKey` | URL du board : `.../jira/software/projects/**PROJ**/boards` | `PROJ` |
| `boardId` | URL du board : `...?rapidView=**42**` ou dans l'URL de configuration du board | `42` |
| Token d'authentification | Voir encadré ci-dessous | — |

### Quel type d'auth choisir ?

```
Mon instance Jira est...
│
├── Jira Cloud (*.atlassian.net)
│   ├── Auth Basic fonctionne ?
│   │   └── OUI → email + apiToken  (→ Section 2, Bloc 1)
│   └── Domaine custom / Basic bloqué ?
│       └── OUI → gateway Atlassian  (→ Section 2, Bloc 2)
│
└── Jira Server ou Data Center
    ├── Version ≥ 8.14 ?
    │   └── OUI → PAT recommandé     (→ Section 2, Bloc 3)
    └── Version < 8.14
        └── Basic uniquement         (→ Section 2, Bloc 1)
```

**Créer un token API (Jira Cloud) :**
1. Jira → icône profil → **Gérer le compte**
2. **Sécurité** → **Créer et gérer des tokens d'API**
3. Créer un token, copier la valeur (non récupérable après fermeture)

**Créer un PAT (Jira Server/DC) :**
1. Jira → icône profil → **Profil**
2. **Personal Access Tokens** → **Créer un token**

---

## 2. `config.yaml` — connexion Jira

```bash
cp config.example.yaml config.yaml
# puis éditer config.yaml avec vos valeurs
```

> `config.yaml` est gitignoré — ne jamais le versionner (il contient vos secrets).

---

### Bloc 1 — Jira Cloud, auth Basic

```yaml
jira:
  baseUrl: "https://your-company.atlassian.net"
  email: "you@company.com"
  apiToken: "YOUR_API_TOKEN"
  projectKey: "PROJ"
  boardId: 42
  name: "Ma Squad"          # Optionnel — titre dans le rapport

db:
  path: "./lean-jira.db"
```

---

### Bloc 2 — Jira Cloud, domaine custom (gateway Atlassian)

À utiliser si votre domaine custom bloque l'auth Basic (erreur 401 avec le Bloc 1).

```yaml
jira:
  baseUrl: "https://api.atlassian.com/ex/jira/YOUR_CLOUD_ID/"
  frontendUrl: "https://your-company.com"   # obligatoire ici — sert aux liens du rapport
  email: "you@company.com"
  apiToken: "YOUR_API_TOKEN"
  projectKey: "PROJ"
  boardId: 42

db:
  path: "./lean-jira.db"
```

**Récupérer `YOUR_CLOUD_ID` :**
```bash
curl https://your-company.com/_edge/tenant_info
# Réponse : {"cloudId":"xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx", ...}
```

---

### Bloc 3 — Jira Server / Data Center (PAT)

```yaml
jira:
  baseUrl: "https://jira.your-company.com"
  personalAccessToken: "YOUR_PAT"
  projectKey: "PROJ"
  boardId: 42

db:
  path: "./lean-jira.db"
```

> `email` et `apiToken` sont ignorés si `personalAccessToken` est présent et non vide.

---

✓ **Config.yaml prête.** Passer à la section suivante.

---
