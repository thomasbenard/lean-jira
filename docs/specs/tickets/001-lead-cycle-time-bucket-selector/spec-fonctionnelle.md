# Spec fonctionnelle — Séries temporelles lead/cycle time par bucket

## Contexte

Le rapport HTML affiche actuellement les métriques lead-time-by-size et cycle-time-by-size uniquement sous forme de tableau statique (dernière snapshot : count / médiane / P85). L'utilisateur ne peut pas observer les tendances historiques par taille de ticket.

## Comportement attendu

### Zone d'affichage

La section "Par taille" existante est enrichie : les tableaux statiques sont conservés (vue synthétique de la dernière snapshot), et deux graphiques de séries temporelles sont ajoutés en dessous.

### Graphiques

Deux graphiques indépendants :
- **Lead time par taille** — titre "Lead time par taille (jours)"
- **Cycle time par taille** — titre "Cycle time par taille (jours)"

Chaque graphique :
- Axe X : dates des snapshots hebdomadaires
- Axe Y : durée en jours ouvrés
- Affiche trois courbes pour le bucket sélectionné : **P50** (médiane), **P85**, **P95**

### Sélecteur de bucket

Au-dessus de chaque graphique, une rangée de boutons : un par bucket disponible dans les données (XS, S, M, L, XL, BUG, UNESTIMATED). Les buckets sans aucune donnée historique sont masqués. Le bucket actif est mis en évidence visuellement (style distinct). Clic sur un bouton → mise à jour immédiate du graphique sans rechargement.

### État initial

Au chargement : le bucket avec le plus grand nombre d'issues (stat "count") est sélectionné par défaut, indépendamment pour chaque graphique.

### Cas limites

- Bucket sans données sur certaines semaines → les points manquants ne sont pas tracés (pas de zéro interpolé)
- Un seul bucket disponible → bouton affiché mais non cliquable (toujours sélectionné)
- Aucune snapshot disponible → graphiques absents, message "Aucune donnée" (comportement identique aux autres charts)

## Ce qui ne change pas

- Les tableaux statiques "Par taille" existants restent en place
- La logique de snapshotting (cumulative depuis cutoffDate) est inchangée
- P95 est ajouté uniquement dans ces graphiques ; les tableaux gardent count/médiane/P85
