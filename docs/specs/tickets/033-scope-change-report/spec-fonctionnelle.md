# Spec fonctionnelle — Rapport : graphe scope change + alerte

## Contexte

Le rapport existant visualise toutes les métriques de flux mais n'a aucune indication sur la dérive de périmètre. Un lead technique ayant un sprint raté ne peut pas aujourd'hui distinguer "l'équipe a sous-performé" de "le périmètre a bougé sous ses pieds". Cette section comble ce manque.

## Comportement attendu

### Bannière d'alerte

Affichée en haut du rapport (avant les cartes KPI), visible immédiatement à l'ouverture :

- **Condition** : au moins 1 issue avec changement significatif dans le sprint actif (`state = "active"`) **ou** dans le sprint précédent (le sprint closed le plus récent)
- **Style** : bandeau orange, icône ⚠️, message : _"Dérive de périmètre détectée — X issue(s) modifiée(s) après entrée en sprint (sprint: [nom du sprint])"_
- Si aucun changement : pas de bannière (section silencieuse)

### Section graphe

Titre : **"Dérive de périmètre par sprint"**

Sous-titre help text :
> "Issues dont la description, l'estimation ou l'assignation de sprint a changé significativement après le début du sprint. Une dérive élevée corrèle avec des sprints ratés et un cycle time long."

**Graphe** : Chart.js bar chart, une barre par sprint (ordre chronologique, gauche = plus ancien)

- Barres empilées : 3 segments par sprint
  - Bleu foncé : issues avec changement de description
  - Ambre : issues avec changement de story points
  - Rouge : issues reprogrammées (sprint change)
  - (une issue peut contribuer à plusieurs segments)
- Axe Y gauche : nombre d'issues modifiées (entiers)
- Axe Y droit (ligne) : taux de changement `changeRatio` en % (même axe que le throughput dans d'autres graphes)
- Axe X : noms de sprints, rotation 45°

**Tableau associé** (sous le graphe) : liste des issues modifiées avec colonnes : Clé | Sprint | Types de changement | Résumé

### Dégradation gracieuse

- Si `issue_field_changes` n'existe pas en base (`PRAGMA table_info` retourne vide) → section entière omise, aucune erreur
- Si `bySprint` est vide (0 sprint avec changements) → section affichée avec message "Aucune dérive de périmètre détectée"
- Si `changedIssueKeys` est vide → tableau omis

## Cas limites

- Sprint sans `start_date` → exclu du graphe (cohérent avec ticket 032)
- Issue dans plusieurs sprints → comptée une seule fois par sprint (type `changedIssues`)
- Rapport généré avant le premier sync avec ticket 031 → dégradation gracieuse ci-dessus

## Ce qui ne change pas

- Aucune autre section du rapport n'est modifiée
- Les métriques de snapshots ne sont pas utilisées pour cette section (calcul live)
- Aucun paramètre de configuration `board.yaml` n'est ajouté dans ce ticket
