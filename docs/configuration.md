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
