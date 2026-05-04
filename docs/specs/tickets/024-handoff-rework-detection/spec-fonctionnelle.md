# Spec fonctionnelle — Handoff Rework Detection

## Contexte

Un ticket qui part en QA, revient en dev, puis repart en QA représente du rework non tracé.
Aujourd'hui invisible dans les métriques. Un taux de rework QA→dev élevé signale soit une
qualité d'entrée insuffisante, soit une définition du "dev done" floue. Ce signal est
actionnable en retro.

## Comportement attendu

### Définition d'un rework

L'ordre naturel des rôles est `dev → qa → po`. Un rework = tout changement de rôle dans le
sens inverse (ou sautant des étapes en sens inverse) :
- `qa → dev` : rework le plus fréquent
- `po → qa`  : rework en validation PO
- `po → dev` : rework extrême (saut)

Les transitions `none → dev`, `dev → qa`, `qa → po` sont des handoffs normaux (non comptés).
Les transitions vers/depuis `none` (statut sans rôle, todo, done) ne sont pas des reworks.

### Unité de comptage

Par ticket : nombre de reworks = nombre de transitions de rôle en sens inverse. Un ticket
qui fait `dev → qa → dev → qa` a 1 rework (`qa → dev`).

### Sorties

- `count` : tickets analysés
- `reworkRatio` : part des tickets avec ≥ 1 rework (ex: 0.23 = 23%)
- `avgReworks` : moyenne de reworks par ticket (tous tickets inclus)
- `byReworkType` : `{ qaToDev, poToQa, poDev }` — nombre absolu d'occurrences chaque type
- `issues` : liste per-ticket `{ issueKey, reworkCount, reworkTypes[] }` pour les tickets
  avec rework (pour debug CLI)

### Sortie CLI

```
=== HANDOFF-REWORK ===
  Issues    : 45
  Rework %  : 22 % (10 tickets)
  Moy/ticket: 0.31
  qa → dev  : 12 occurrences
  po → qa   : 2 occurrences
  po → dev  : 0 occurrences

  Top rework :
    KECK-34  2 reworks  [qa→dev, qa→dev]
    KECK-12  1 rework   [po→qa]
    ...
```

## Cas limites

- Ticket `dev → qa → dev → qa → done` → 1 rework (qa→dev)
- Ticket `dev → qa → po → done` → 0 rework
- Rôle QA non configuré → `qaStatuses = []` → `qaToDev = 0`, rework détecté seulement sur `po → dev`
- Ticket jamais passé par un rôle configuré → 0 rework, inclus dans `count`
- Statut `none` entre deux mêmes rôles (`dev → none → dev`) → pas un rework, rôle inchangé

## Ce qui ne change pas

- Aucune métrique existante
- Population et filtres `cycle-time` inchangés (même base que ticket 021)
