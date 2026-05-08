# Ticket 041a — i18n infrastructure + traduction messages CLI

## User story

En tant que développeur ou utilisateur international souhaitant utiliser lean-jira en anglais,
je veux que les messages CLI (sync, metrics, snapshots, report, validate-config, autoconfig,
list-metrics) s'affichent en anglais par défaut avec une option `--lang fr` pour retrouver
le comportement actuel, afin de pouvoir intégrer lean-jira dans un workflow international
sans être bloqué par les messages en français.

## Solution retenue

Créer `src/i18n/` avec trois fichiers : `index.ts` (fonction `t(key, vars?)` + `initLocale(lang)`),
`en.ts` et `fr.ts` (objets typés `LocaleShape`). TypeScript impose à la compilation que toutes
les clés existent dans les deux locales — aucune clé manquante silencieuse.

Ajouter `--lang <code>` (défaut `en`) sur les 7 commandes Commander.js. La première ligne de
chaque `.action()` appelle `initLocale(opts.lang)`. Toutes les chaînes `console.log/error/warn`
de `main.ts` et `sync.ts` sont remplacées par `t(key, vars?)`.

Ce ticket couvre uniquement les messages CLI. Les chaînes du rapport HTML sont traitées en 041b.

## Estimation

**Bucket** : M

**Justification** : 3 nouveaux fichiers (`src/i18n/index.ts`, `en.ts`, `fr.ts`) + modifications
`main.ts` (~40 strings françaises, 7 commandes à patcher) + `sync.ts` (~6 strings). Pattern
simple, aucune migration DB, aucune dépendance externe. 5-7 scénarios de test.

## Statut

**à faire**
