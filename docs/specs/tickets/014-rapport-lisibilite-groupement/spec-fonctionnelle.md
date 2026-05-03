# Spec fonctionnelle — Rapport : lisibilité par groupement thématique

## Contexte

Le rapport actuel présente 10 graphes dans un seul bloc "Tendances hebdomadaires" sans
hiérarchie, mêlant métriques de livraison, bugs et métriques avancées au même niveau visuel.
Un lead technique qui consulte le rapport pour un standup doit scroller l'intégralité de la
page pour voir les signaux essentiels. Les métriques normalisées et by-size sont utiles mais
ne font pas partie de la lecture quotidienne.

## Comportement attendu

### Structure des sections

Le rapport se divise en 3 sections thématiques H2, dans cet ordre :

**1. Livraison**
- KPIs : lead time médian, cycle time médian, throughput (7j), WIP
- Graphes principaux : lead time, cycle time, throughput, throughput pondéré, WIP
- Distribution cycle time
- Par taille (tables médiane / P85 par bucket)
- [Avancé — accordéon fermé par défaut] : lead normalisé, cycle normalisé, flow efficiency,
  by-size trends (lead + cycle avec bucket selector)

**2. Bugs & dette qualité**
- KPIs : bugs livrés (7j), bug cycle time médian, bug ratio moyen
- Graphes : bug throughput, bug cycle time, allocation dev features vs bugs

**3. Capacité & prévision**
- Forecast Monte Carlo (table)
- Aging WIP (scatter + table top items)

### Accordéon "Avancé"

- Élément HTML natif `<details>` avec `<summary>` libellé "Métriques avancées ▾"
- Fermé (`open` absent) au chargement initial
- Contient : graphes lead normalisé, cycle normalisé, flow efficiency, by-size trends
- S'ouvre/ferme au clic sans JS — comportement natif du navigateur
- Stylistiquement distinct de la section principale (fond légèrement grisé, bordure)

### KPIs

La grille de KPIs principale (section Livraison) affiche uniquement les 4 métriques de
livraison. Les 4 KPIs bugs migrent en tête de la section "Bugs & dette qualité" dans leur
propre grille.

## Cas limites

- Snapshots absents pour une métrique → le graphe reste absent (comportement actuel inchangé)
- Accordéon ouvert puis page rechargée → revient fermé (état non persisté)
- Viewport mobile → accordéon reste fonctionnel (layout 1 colonne déjà géré par media query)

## Ce qui ne change pas

- Aucune logique TypeScript modifiée (pas de nouveaux exports, pas de changement de types)
- Aucun calcul de métrique, snapshot, ou DB
- Contenu des graphes identique — seul leur emplacement dans le DOM change
- Textes d'aide (`HELP_TEXTS`) inchangés
- Bannière sync stale inchangée
- Lien Jira, forecast, aging WIP inchangés dans leur comportement
