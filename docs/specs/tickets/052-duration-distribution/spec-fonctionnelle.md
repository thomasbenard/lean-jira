# Spec fonctionnelle — Distribution PDF + CDF lead-time / cycle-time

## Contexte

Le rapport actuel n'expose que des **agrégats** des durées (médiane, P85, P95, moyenne) et un seul histogramme cycle-time global (`cycleHistogram`). Or :

- ces agrégats cachent la **forme** de la distribution (multi-modale, asymétrique, queue lourde) ;
- les buckets `by-size` n'affichent que les stats agrégées, pas la distribution interne ;
- lire « P(durée ≤ X j) » nécessite aujourd'hui un calcul mental imprécis depuis le P50/P85.

Ce ticket ajoute deux visualisations PDF + CDF qui répondent directement à ces questions.

## Comportement attendu

### Zone d'affichage

Onglet **`advanced`** du rapport. Deux nouvelles sections, l'une sous l'autre :

1. **Distribution cycle-time** — `id=cycleDistributionChart`
2. **Distribution lead-time** — `id=leadDistributionChart`

Chaque section contient :
- titre + tooltip d'aide (`?` button, contenu i18n) ;
- sélecteur de bucket horizontal `[Global] [XS] [S] [M] [L] [XL]` (boutons cliquables, exclusifs ; `Global` actif par défaut) ;
- canvas Chart.js avec **deux axes Y** :
  - Y gauche : densité (PDF discrète en bars + KDE en line) ;
  - Y droit : probabilité cumulative (CDF en line, 0–1 affiché en % avec ticks 0/25/50/75/100) ;
- légende en bas avec les 3 séries.

### Interactions

- Clic sur un bucket : ré-affiche les 3 séries en remplaçant uniquement leurs données (pas de re-création du chart). Bouton actif visuellement marqué (`.active`).
- Hover sur une barre PDF : tooltip affiche `[start–end] j ouvrés · N issues · P(durée ≤ end) = XX %`.
- Hover sur la courbe KDE : tooltip densité à la valeur curseur.
- Hover sur la CDF : tooltip percentile.

### État initial

Au chargement de la page, le bucket `Global` est sélectionné pour les deux charts.

### Bins / bandwidth

- **Largeur de bin** : reprend exactement la formule de `buildHistogram` (`max ≤ 5 ⇒ 0.5`, `max ≤ 20 ⇒ 1`, sinon `Math.ceil(max / 20)`). Cohérence avec l'histogramme cycle-time existant.
- **KDE** : kernel gaussien, bandwidth via **règle de Silverman** : `h = 1.06 · σ · n^(-1/5)`. Évaluation sur **50 points** uniformément répartis entre `0` et `max(values)`.
- **CDF** : empirique stricte, évaluée sur les **mêmes 50 points** que la KDE pour permettre un alignement axe X exact.

## Cas limites

- **Population vide pour le bucket sélectionné** → masquer le canvas, afficher message `« Aucune donnée pour ce bucket »` à la place. Le sélecteur reste actif (l'utilisateur peut basculer).
- **n = 1** sur le bucket → afficher la PDF (1 bar à count=1), masquer la KDE (bandwidth dégénéré), afficher la CDF en marche unique (0 → 1).
- **n < 4** sur le bucket → afficher la PDF + CDF, masquer la KDE (échantillon trop petit pour être lissé, σ peu fiable).
- **Bucket BUG ou UNESTIMATED** → boutons absents du sélecteur. Ces issues sont **comptées dans le global** mais pas exposées comme bucket individuel (cohérent avec `lead-time-by-size` / `cycle-time-by-size`).
- **Toutes valeurs identiques** (σ = 0) → KDE masquée (bandwidth invalide), PDF + CDF affichées.
- **max = 0** (tous les samples à 0j) → 1 seul bin `[0,0]`, comportement n=1 ou plus.

## Ce qui ne change pas

- L'histogramme existant `cycleHistogramChart` (onglet `quality`) reste inchangé — il sert d'aperçu rapide ; la nouvelle vue distribution est l'outil d'analyse complète.
- Aucune modification des métriques `lead-time`, `cycle-time`, `lead-time-by-size`, `cycle-time-by-size`, `lead-time-normalized`, `cycle-time-normalized`.
- Aucune modification du schéma DB ni de `metric_snapshots`.
- Pas de nouvel onglet, pas de modification de la navigation, pas de KPI ajouté en en-tête.
- Pas d'ajout dans le résumé textuel automatique (le ticket cible la visualisation, pas la synthèse).
