# Example Mapping — Rapport HTML personnalisable

## Règle 1 — Logo local embarqué en base64

**Si `logoUrl` pointe vers un fichier local, le rapport résultant doit rester auto-suffisant
(le logo est intégré en base64, pas via un `src` relatif).**

```gherkin
Scenario: Logo PNG local embarqué
  Given board.yaml contient logoUrl: "./assets/logo.png"
  And le fichier "./assets/logo.png" existe
  When npm run report est lancé
  Then le HTML produit contient un <img src="data:image/png;base64,...">
  And aucun chemin local n'apparaît dans l'attribut src du logo

Scenario: Logo introuvable → erreur explicite
  Given board.yaml contient logoUrl: "./assets/inexistant.png"
  And le fichier n'existe pas
  When npm run report est lancé
  Then le processus sort avec un code d'erreur non nul
  And le message d'erreur cite le chemin absolu du fichier manquant

Scenario: Extension non reconnue → warning + logo ignoré
  Given board.yaml contient logoUrl: "./assets/logo.bmp"
  When npm run report est lancé
  Then un warning "[report] Extension logo non reconnue" est affiché
  And le rapport est généré sans balise <img>
```

---

## Règle 2 — Exclusion d'onglets

**Les onglets listés dans `excludeTabs` ne doivent apparaître ni dans la barre de navigation
ni dans le contenu — y compris leurs données embarquées.**

```gherkin
Scenario: Onglet roles exclu
  Given board.yaml contient excludeTabs: [roles]
  When npm run report est lancé
  Then le HTML ne contient pas <button ... data-tab="roles">
  And le HTML ne contient pas id="tab-roles"

Scenario: Tous les onglets exclus → pas de barre de navigation
  Given board.yaml contient excludeTabs: [delivery, quality, roles, forecast, advanced]
  When npm run report est lancé
  Then le HTML ne contient aucune balise <div class="tabs">
  And les KPIs et le top 3 sont toujours présents

Scenario: Premier onglet par défaut exclu → onglet actif décalé
  Given board.yaml contient excludeTabs: [delivery]
  When npm run report est lancé
  Then le premier bouton visible porte la classe "active"
  And le panneau correspondant porte la classe "active"
  And aucun bouton ou panneau pour "delivery" n'est présent

Scenario: Valeur inconnue dans excludeTabs → warning + ignorée
  Given board.yaml contient excludeTabs: [roles, inexistant]
  When npm run report est lancé
  Then un warning "[report] excludeTabs: onglet inconnu "inexistant" ignoré" est affiché
  And le rapport masque bien l'onglet "roles"
```

---

## Règle 3 — CSS custom injecté après le style défaut

**Les règles du fichier CSS custom doivent pouvoir surcharger les défauts sans `!important`
grâce à l'ordre de cascade.**

```gherkin
Scenario: CSS custom injecté après le bloc style défaut
  Given board.yaml contient customCssPath: "./my-report.css"
  And le fichier contient ":root { --bg: #ffffff; }"
  When npm run report est lancé
  Then le HTML contient un second bloc <style> après le premier
  And ce second bloc contient ":root { --bg: #ffffff; }"

Scenario: customCssPath introuvable → erreur explicite
  Given board.yaml contient customCssPath: "./inexistant.css"
  When npm run report est lancé
  Then le processus sort avec un code d'erreur non nul
```
