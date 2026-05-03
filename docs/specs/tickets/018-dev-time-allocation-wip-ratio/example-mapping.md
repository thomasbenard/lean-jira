# Example Mapping — dev-time-allocation : WIP et ratio pondéré

## Règle 1 — WIP contribue au byWeek

**Une issue en cours (non livrée) distribue son cycle-time partiel sur les semaines écoulées depuis son démarrage.**

```gherkin
Scenario: bug WIP en cours depuis 2 semaines
  Given une issue de type "Bug" démarrée il y a 2 semaines ISO
  And aucune transition vers doneStatuses
  When on calcule dev-time-allocation aujourd'hui
  Then byWeek contient des bugDays sur les 2 semaines écoulées
  And avgBugRatio > 0

Scenario: feature WIP en cours depuis 1 semaine
  Given une issue de type "Story" démarrée cette semaine
  And aucune transition vers doneStatuses
  When on calcule dev-time-allocation aujourd'hui
  Then byWeek contient des featureDays sur la semaine courante

Scenario: issue livrée et WIP coexistent dans la même semaine
  Given une Story livrée cette semaine (3j cycle-time)
  And un Bug WIP démarré cette semaine (2j écoulés)
  When on calcule dev-time-allocation
  Then la semaine courante a featureDays >= 3 et bugDays >= 2
```

## Règle 2 — WIP exclu si livré avant today

**Une issue livrée avant `today` ne doit pas apparaître en double (livrée ET WIP).**

```gherkin
Scenario: issue livrée hier n'est pas comptée comme WIP
  Given une Story avec done_at = hier
  When on calcule dev-time-allocation avec windowEndDate = aujourd'hui
  Then la Story contribue uniquement via la requête "livrées"
  And elle n'apparaît pas dans la requête WIP
```

## Règle 3 — Snapshot historique : windowEndDate joue le rôle de today

**Pour les snapshots passés, le WIP est calculé par rapport à la date du snapshot, pas à la date réelle.**

```gherkin
Scenario: snapshot à une date passée D
  Given une issue démarrée avant D et livrée après D
  When on calcule dev-time-allocation avec windowEndDate = D
  Then l'issue est comptée comme WIP (done_at fictif = D)
  And elle n'apparaît pas dans les issues livrées (done_at > D)

Scenario: snapshot à une date passée D, issue déjà livrée avant D
  Given une issue livrée 3 jours avant D
  When on calcule dev-time-allocation avec windowEndDate = D
  Then l'issue est comptée comme livrée uniquement
  And elle n'apparaît pas dans le WIP
```

## Règle 4 — avgBugRatio pondéré par volume

**Une semaine avec peu de jours ne tire pas le ratio global à la même force qu'une semaine chargée.**

```gherkin
Scenario: ratio pondéré vs non pondéré
  Given semaine A : 1 bugDay, 0 featureDay  (ratio = 1.0)
  And semaine B : 2 bugDays, 8 featureDays  (ratio = 0.2)
  When on calcule avgBugRatio
  Then avgBugRatio = (1 + 2) / (1 + 0 + 2 + 8) = 0.273
  And NOT avgBugRatio = (1.0 + 0.2) / 2  -- ancienne formule = 0.6
```
