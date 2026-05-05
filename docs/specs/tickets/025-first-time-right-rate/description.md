# Ticket 025 — First-Time-Right Rate

## User story

En tant que lead technique mesurant la qualité du process, je veux savoir quel pourcentage
de tickets traversent chaque étape une seule fois sans retour en arrière, afin d'avoir un
KPI simple et lisible de la qualité d'entrée par rôle.

## Solution retenue

Nouvelle métrique `first-time-right`. Sur la population cycle-time, pour chaque ticket,
compter le nombre de "passages" dans chaque rôle (un passage = une séquence contiguë de
transitions dans le même rôle). FTR d'un rôle = proportion de tickets avec exactement 1
passage dans ce rôle. Complément naturel de `handoff-rework` : `handoff-rework` donne les
occurrences brutes, `first-time-right` donne le KPI % lisible par rôle.

## Estimation

**Bucket** : S

**Justification** : 1 nouveau fichier court (algorithme simple, découle directement du
comptage de segments de rôle déjà conçu pour 023/024), 2 fichiers modifiés (`index.ts`,
`compute.ts`). 4–5 scénarios test. Dépend de 019 + 020.

## Statut

**livré**
