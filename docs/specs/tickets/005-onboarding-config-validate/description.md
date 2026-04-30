# Ticket 005 — Onboarding : config example + commande validate-config

## User story

En tant que développeur configurant lean-jira sur un nouveau projet Jira, je veux disposer d'un fichier de configuration d'exemple et d'une commande de validation, afin de ne pas avoir à deviner les noms de statuts exacts et de détecter immédiatement toute erreur de configuration avant le premier run de métriques.

## Solution retenue

Deux livrables indépendants :

1. **`config.example.yaml`** à la racine du projet : copie de la structure complète de `config.yaml` avec tous les champs documentés par des commentaires YAML, des valeurs fictives réalistes, et une explication de chaque section.

2. **Commande `validate-config`** dans `src/main.ts` : vérifie que chaque statut listé dans `todoStatuses`, `devStartStatuses`, `inProgressStatuses`, `doneStatuses`, `activeStatuses`, `queueStatuses` existe dans la table `statuses` de la DB (peuplée par `sync`). Affiche un rapport : statuts valides ✓, statuts introuvables ✗, et liste complète des statuts disponibles en DB pour aider à corriger.

## Statut

**To be implemented**
