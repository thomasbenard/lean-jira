# Example Mapping — Template Handlebars pour override HTML complet

## Règle 1 — Comportement par défaut inchangé

**Sans `--template`, le rapport produit est identique à celui du ticket 028 (rendu TS interne).**

```gherkin
Scenario: Rapport sans --template → rendu TS interne
  Given board.yaml sans section report:
  When npm run report est lancé sans --template
  Then le rapport HTML produit est identique au comportement pré-029
  And aucune dépendance handlebars n'est invoquée

Scenario: templatePath dans board.yaml + --export-template → export a priorité
  Given board.yaml contient report: { templatePath: "./my.hbs" }
  When npm run report -- --export-template ./dir est lancé
  Then le template est exporté dans ./dir/ sans tenter de générer le rapport
```

---

## Règle 2 — Export du template par défaut

**`--export-template` copie les fichiers de template sans écraser l'existant.**

```gherkin
Scenario: Export dans répertoire vide
  Given le répertoire ./my-template n'existe pas
  When npm run report -- --export-template ./my-template est lancé
  Then ./my-template/ est créé
  And ./my-template/report.hbs existe et est un template Handlebars valide
  And ./my-template/context.schema.json existe

Scenario: Export dans répertoire contenant déjà report.hbs → erreur
  Given ./my-template/report.hbs existe déjà
  When npm run report -- --export-template ./my-template est lancé
  Then le processus sort avec code d'erreur non nul
  And ./my-template/report.hbs n'est pas modifié
```

---

## Règle 3 — Rendu avec template custom

**Le template custom reçoit le contexte complet et produit un HTML self-contained.**

```gherkin
Scenario: Template custom identique au défaut → output identique
  Given --export-template a produit ./my-template/report.hbs (non modifié)
  And board.yaml contient report: { templatePath: "./my-template/report.hbs" }
  When npm run report est lancé
  Then le rapport produit est fonctionnellement identique au rapport par défaut

Scenario: Template custom vide → HTML vide produit, pas d'erreur
  Given board.yaml contient report: { templatePath: "./empty.hbs" }
  And ./empty.hbs est un fichier vide
  When npm run report est lancé
  Then le processus sort avec code 0
  And le fichier de sortie est vide (ou minimal)

Scenario: templatePath inexistant → erreur explicite
  Given board.yaml contient report: { templatePath: "./inexistant.hbs" }
  When npm run report est lancé
  Then le processus sort avec code d'erreur non nul
  And le message cite le chemin absolu du fichier manquant

Scenario: Template avec syntaxe Handlebars invalide → erreur avec numéro de ligne
  Given board.yaml contient report: { templatePath: "./broken.hbs" }
  And ./broken.hbs contient "{{#if" sans fermeture
  When npm run report est lancé
  Then le processus sort avec code d'erreur non nul
  And le message contient "Erreur de compilation du template Handlebars"
```

---

## Règle 4 — Compatibilité avec options ticket 028

**`--template` et les options de personnalisation (`report:` dans board.yaml) sont compatibles.**

```gherkin
Scenario: Template custom + logo configuré dans board.yaml
  Given board.yaml contient report: { templatePath: "./my.hbs", logoUrl: "./logo.png" }
  And ./logo.png existe
  And le template custom utilise {{{headerLogoHtml}}}
  When npm run report est lancé
  Then le rapport contient un <img src="data:image/png;base64,...">

Scenario: Template custom + excludeTabs dans board.yaml
  Given board.yaml contient report: { templatePath: "./my.hbs", excludeTabs: [roles] }
  And le template utilise {{#each tabs}} pour itérer les onglets
  When npm run report est lancé
  Then le tableau tabs dans le contexte ne contient pas l'onglet "roles"
```
