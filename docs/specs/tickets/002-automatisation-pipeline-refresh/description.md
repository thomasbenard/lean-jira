# Ticket 002 — Automatisation du pipeline refresh

## User story

En tant que lead technique, je veux pouvoir rafraîchir toutes les données et régénérer le rapport en une seule commande, afin de ne pas avoir à mémoriser la séquence `sync → snapshots → report` et de pouvoir planifier cette mise à jour automatiquement.

## Solution retenue

Ajouter un script npm `refresh` qui enchaîne `sync`, `snapshots` et `report` via `ts-node src/main.ts`. Fournir en parallèle un fichier `.github/workflows/refresh.yml` (GitHub Actions, déclenchement hebdomadaire + manuel) et un commentaire `crontab` dans le README ou en header du workflow, prêts à être copiés. Aucune nouvelle logique applicative : c'est uniquement du chaînage et de la configuration CI.

## Statut

**To be implemented**
