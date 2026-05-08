# Ticket 039d — Rapport adaptatif selon méthode d'estimation

## User story

En tant que lead technique lisant le rapport lean-jira, je veux que les sections estimation-dépendantes (métriques normalisées, by-size, throughput pondéré) soient masquées ou adaptées selon la méthode d'estimation configurée, afin de ne pas afficher de graphiques vides ou trompeurs pour les équipes no-estimate.

## Solution retenue

`generateReport()` reçoit `EstimationConfig`. `estimationFlags()` dérive les règles de visibilité. `none` masque tout. `t-shirt` masque throughput-weighted et normalisés. `story-points`/`numeric` affichent les normalisés avec un message contextuel ("ratio élevé = estimations sans valeur prédictive — préférez le flow") plutôt que de les masquer, car ce ratio est un levier d'influence vers le no-estimate. Labels bucket selectors et titres adaptés via `getBucketLabels()` (039b). Bandeau de contexte en haut de rapport.

**Prérequis** : 039b (EstimationConfig dans MetricConfig), 039c (throughput-weighted adapté).

## Estimation

**Bucket** : S

**Justification** : 2 fichiers touchés (generate.ts, main.ts). Logique de masquage localisée dans le template HTML généré. Pas de modification de la logique de calcul.

## Statut

**à faire**
