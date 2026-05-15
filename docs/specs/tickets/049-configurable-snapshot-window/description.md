# Ticket 049 — Fenêtre rolling snapshot configurable

## User story

En tant que lead technique, je veux configurer la taille de la fenêtre glissante utilisée par
les snapshots de métriques de durée, afin d'adapter la sensibilité des graphes au volume de
livraisons réel de mon équipe (équipes à fort débit → fenêtre courte ; équipes à faible débit
→ fenêtre longue).

## Solution retenue

Ajouter `metrics.snapshotWindowDays` (entier, défaut `30`) dans `board.yaml`. Cette valeur
remplace `ROLLING_WINDOW_DAYS` dans `snapshots/compute.ts` et est propagée via `MetricConfig`.
Lors de l'exécution de `npm run snapshots`, si la valeur stockée dans `app_config` diffère de
la valeur courante, les snapshots sont purgés et recalculés intégralement avec la nouvelle
fenêtre — même mécanique que la détection de changement de `metrics.estimation.method`.

## Estimation

**Bucket** : S

**Justification** : 4 fichiers touchés, pattern `getStoredEstimationMethod`/`persistEstimationMethod`
à dupliquer quasi-identiquement, aucune migration DB (réutilise `app_config`), 3-4 scénarios
de test.

## Statut

**livré**
