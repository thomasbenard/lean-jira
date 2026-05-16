# Rapport HTML

[← Index](../spec-fonctionnelle.md)

Fichier autonome (aucune dépendance serveur). Prérequis :

```bash
npm run sync       # Données fraîches
npm run snapshots  # Historique à jour
npm run report     # Génère ./report.html
```

## En-tête

La ligne de métadonnées affiche :
```
Généré le {YYYY-MM-DD HH:MM} · Données Jira du {YYYY-MM-DD HH:MM} · Dernière fenêtre hebdo : {YYYY-MM-DD}
```

- La date « Données Jira » est lue depuis `MAX(sync_log.synced_at)` filtré sur le `project_key` courant.
- Si aucun sync n'a jamais été effectué : `Données Jira : jamais synchronisé`.
- Si le dernier sync date de plus de 7 jours calendaires (seuil strict `>`), un bandeau pleine largeur s'affiche sous l'en-tête : fond `#fff3cd`, bordure `#f59e0b`, texte `#92400e`. Le bandeau est permanent (pas de bouton fermer). Il s'affiche également si aucun sync n'a jamais été effectué.

## Contenu

Le rapport est organisé en 4 sections thématiques H2, dans cet ordre :

### 1. Livraison

- **KPIs** (4, dernière fenêtre) : lead time médian, cycle time médian, throughput (7j), WIP. Si `metrics.healthThresholds` est configuré dans `board.yaml`, chaque KPI concerné affiche un point coloré (●) avant sa valeur : vert (zone saine), orange (à surveiller), rouge (dégradé). Signal absent si le seuil n'est pas configuré pour ce KPI ou si la valeur est `null`.
- **Graphes principaux** (5) : lead time, cycle time, throughput, throughput pondéré, WIP. Chaque graphique affiche une courbe de tendance superposée calculée par moyenne mobile sur une fenêtre de 4 semaines (gris ardoise `#64748b88`, pointillé `[6,4]`, label "Tendance"). Les 3 premiers points ne sont pas tracés (fenêtre insuffisante).
- **Distribution cycle time** : histogramme avec lignes P50/P85/P95.
- **Par taille** : tableaux statiques lead time et cycle time par bucket (dernière snapshot : count/médiane/P85).
- **Métriques avancées** (accordéon `<details>`, fermé par défaut, fond grisé) : lead normalisé, cycle normalisé, flow efficiency + deux graphiques de séries temporelles by-size (lead time et cycle time par bucket sélectionnable). Chaque graphique by-size affiche P50/P85/P95 pour le bucket actif avec courbe de tendance sur la médiane. Bucket par défaut : celui avec le plus grand count. Sélecteur interactif côté client, sans rechargement. Un seul bucket disponible → bouton non cliquable.

### 2. Bugs & dette qualité

- **KPIs** (3) : bugs livrés (7j), bug cycle time médian, bug ratio moyen. Bug cycle time médian et bug ratio moyen affichent également le signal de santé si configuré.
- **Graphes** (4) : bug throughput, bug cycle time, allocation dev features vs bugs, bug backlog. Le graphe **Bug Backlog** est double-axe : barres hebdomadaires `netFlow` (vert si ≥ 0, rouge si < 0) sur l'axe droit, courbe `openCount` sur l'axe gauche.

### 3. Capacité & prévision

- **Forecast Monte Carlo** : table P15/P50/P85/P95 par horizon.
- **Aging WIP** : scatter (statut × âge) avec seuils P50/P85/P95 + table top 15 par âge avec classification de risque. Les clés d'issues dans la table sont des liens cliquables ouvrant la page Jira correspondante (`{baseUrl}/browse/{key}`) dans un nouvel onglet.

### 4. Flux par rôle

Toujours visible (pas dans un accordéon). Affiche les 5 métriques role-aware issues des tickets 021–025.

- **Stage time breakdown** : 3 KPI cards (médiane dev/qa/po), graphique barres groupées P50+P85 par rôle, donut de répartition moyenne du cycle time (dernière snapshot).
- **WIP par rôle** : 3 KPI cards (WIP dev/qa/po), courbe WIP par rôle sur le temps.
- **Stage throughput gap** : graphique barres groupées flux net (entrées − sorties) par rôle ; axe Y peut être négatif.
- **Handoff rework** : 2 KPI cards (% tickets avec rework, reworks/ticket), courbe taux de rework, graphique barres reworks par type (qaToDev/poToQa/poDev).
- **First-time-right rate** : 3 KPI cards (FTR dev/qa/po en %), courbe FTR par rôle.

Si aucune colonne `role:` n'est configurée dans `board.yaml`, aucune snapshot role-aware n'existe → graphiques vides sans erreur.

### Transverse

- **Popovers d'aide** au survol pour chaque métrique (bouton `?` inline).

## Rapport adaptatif selon la méthode d'estimation

Le rapport adapte son contenu en fonction de `metrics.estimation.method` dans `board.yaml` :

| Section | `none` | `t-shirt` | `story-points` | `numeric` | `time` |
|---|---|---|---|---|---|
| Throughput pondéré | masqué | masqué | visible (SP) | visible (pts) | visible (j-h) |
| Lead/Cycle normalisé | masqué | masqué | masqué | masqué | visible |
| By-size (tableaux + graphiques) | masqué | visible | visible | visible | visible |

Un bandeau `estimation-context` est toujours présent sous l'en-tête, indiquant la méthode active et ses paramètres (seuils de taille pour story-points, etc.).

Quand les métriques normalisées sont visibles (`method: time`), une note explicative signale que ces métriques sont basées sur le ratio temps réel / temps estimé et qu'il est préférable de se fier aux métriques de flux (lead time, cycle time).

En l'absence de section `estimation` dans `board.yaml`, la méthode `time` est appliquée implicitement.
