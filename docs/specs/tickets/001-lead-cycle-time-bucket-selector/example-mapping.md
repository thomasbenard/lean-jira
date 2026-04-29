# Example Mapping — Séries temporelles lead/cycle time par bucket

## Règle 1 : Affichage des boutons de sélection

**Seuls les buckets ayant au moins un snapshot sont affichés.**

```gherkin
Scenario: Buckets disponibles → boutons visibles
  Given les snapshots contiennent des données pour les buckets XS, M, L, BUG
  And aucune donnée pour S, XL, UNESTIMATED
  When le rapport est chargé
  Then les boutons XS, M, L, BUG sont affichés
  And les boutons S, XL, UNESTIMATED sont absents

Scenario: Aucun snapshot par-taille
  Given la table metric_snapshots ne contient aucune ligne pour "lead-time-by-size"
  When le rapport est chargé
  Then le graphique "Lead time par taille" n'est pas rendu
  And aucun bouton n'est affiché pour ce graphique
```

---

## Règle 2 : Sélection par défaut

**Le bucket avec le plus de snapshots (points temporels) est sélectionné au chargement.**

```gherkin
Scenario: Bucket le plus représenté sélectionné par défaut
  Given les snapshots contiennent M sur 20 semaines et XS sur 8 semaines
  When le rapport est chargé
  Then le bouton M est actif
  And le graphique affiche les courbes P50/P85/P95 de M

Scenario: Égalité de couverture temporelle
  Given les buckets S et M ont chacun 12 semaines de données
  When le rapport est chargé
  Then l'un des deux est sélectionné (le premier dans l'ordre BUCKET_ORDER)
```

---

## Règle 3 : Changement de bucket

**Clic sur un bouton → graphique mis à jour immédiatement, bouton actif changé.**

```gherkin
Scenario: Sélection d'un autre bucket
  Given le bucket M est sélectionné par défaut
  When l'utilisateur clique sur le bouton L
  Then le bouton L devient actif
  And le bouton M n'est plus actif
  And le graphique affiche P50/P85/P95 pour le bucket L

Scenario: Double-clic sur le bucket actif
  Given le bucket M est sélectionné
  When l'utilisateur clique à nouveau sur M
  Then rien ne change (M reste actif, graphique inchangé)
```

---

## Règle 4 : Données manquantes sur certaines semaines

**Un bucket peut ne pas avoir de données sur toutes les semaines — pas d'interpolation à zéro.**

```gherkin
Scenario: Gaps dans les données d'un bucket
  Given le bucket XL a des données semaines 2024-01, 2024-03 mais pas 2024-02
  When l'utilisateur sélectionne XL
  Then le graphique affiche deux points reliés directement (saut de semaine)
  And aucun point à zéro n'est interpolé pour 2024-02

Scenario: P95 absent sur certaines semaines (trop peu d'issues)
  Given une semaine où le bucket XS n'a que 2 issues (P95 non significatif)
  When l'utilisateur sélectionne XS
  Then P95 peut ne pas être tracé pour cette semaine
  And P50 et P85 restent tracés si disponibles
```

---

## Règle 5 : Indépendance des deux graphiques

**Lead time et cycle time ont des sélecteurs indépendants.**

```gherkin
Scenario: Sélections différentes sur chaque graphique
  Given le rapport est chargé (M sélectionné par défaut sur les deux)
  When l'utilisateur sélectionne L sur le graphique Lead time
  Then le graphique Lead time affiche les courbes de L
  And le graphique Cycle time affiche toujours les courbes de M
```
