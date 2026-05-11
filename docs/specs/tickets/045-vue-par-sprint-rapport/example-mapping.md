# Example Mapping — Vue par sprint dans le rapport

## Règle 1 — Toggle absent si aucun sprint disponible

**Si la table `sprints` ne contient aucune ligne avec `start_date` non nulle, le toggle n'apparaît pas.**

```gherkin
Scenario: Aucun sprint en base
  Given la table sprints est vide
  When le rapport est généré
  Then le toggle "Semaines / Sprints" est absent du HTML
  And les graphes throughput affichent uniquement la vue hebdomadaire

Scenario: Sprints présents sans start_date
  Given la table sprints contient 3 sprints avec start_date NULL
  When le rapport est généré
  Then le toggle est absent
```

## Règle 2 — Vue initiale = Semaines

**Au chargement du rapport, la vue semaines est active par défaut.**

```gherkin
Scenario: Chargement initial du rapport
  Given des sprints et des snapshots existent en DB
  When le rapport est ouvert dans un navigateur
  Then le bouton "Semaines" a la classe "active"
  And les graphes affichent les données hebdomadaires des snapshots

Scenario: Bascule vers Sprints puis retour
  Given le rapport est ouvert avec vue Semaines active
  When l'utilisateur clique "Sprints"
  Then le bouton "Sprints" a la classe "active"
  And les graphes affichent les données par sprint
  When l'utilisateur clique "Semaines"
  Then les graphes reviennent aux données hebdomadaires
```

## Règle 3 — Sprint actif affiché en valeur partielle

**Le sprint actif (state='active') est inclus avec une valeur partielle et distingué visuellement.**

```gherkin
Scenario: Sprint actif présent
  Given un sprint actif démarré il y a 5 jours avec end_date NULL
  And 3 issues livrées depuis le début du sprint
  When la vue Sprints est activée
  Then le sprint actif apparaît en dernier sur l'axe X
  And son libellé contient "(en cours)"
  And sa barre est visuellement distincte (transparence ou hachures)
  And sa valeur = 3 (issues livrées depuis start_date jusqu'à aujourd'hui)

Scenario: Aucune issue livrée dans le sprint actif
  Given un sprint actif démarré aujourd'hui
  When la vue Sprints est activée
  Then le sprint actif apparaît avec une valeur de 0
```

## Règle 4 — Toggle synchronisé sur les 3 graphes

**Basculer la vue change simultanément throughput, bug-throughput et throughput-weighted.**

```gherkin
Scenario: Synchronisation des 3 graphes
  Given le rapport avec les 3 graphes de débit visibles
  When l'utilisateur clique "Sprints"
  Then les 3 graphes basculent simultanément vers la vue sprint
  And aucun des 3 graphes ne reste en vue semaines
```
