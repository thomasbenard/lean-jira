# Ticket Index Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Create `docs/specs/tickets/INDEX.md` (référence centrale des tickets) + script bash `scripts/update-ticket.sh` qui maintient l'index et les `description.md` en cohérence ; modifier les skills `/ticket-spec` et `/implement-ticket` pour appeler le script automatiquement.

**Architecture:** Script bash avec deux commandes (`add` / `status`). `add` insère une ligne triée dans INDEX.md. `status` met à jour la cellule statut dans INDEX.md **et** la ligne `**valeur**` dans description.md. Les skills locaux SKILL.md sont modifiés pour appeler ce script à la fin de leur workflow respectif.

**Tech Stack:** Bash (GNU sed + awk — disponibles via Git Bash), Markdown.

---

## Fichiers concernés

| Action | Fichier |
|---|---|
| Créer | `scripts/update-ticket.sh` |
| Créer | `docs/specs/tickets/INDEX.md` |
| Modifier | `.claude/skills/implement-ticket/SKILL.md` (ligne 135) |
| Modifier | `.claude/skills/ticket-spec/SKILL.md` (après ligne 316) |

---

## Task 1 : Créer `scripts/update-ticket.sh`

**Files:**
- Create: `scripts/update-ticket.sh`

- [ ] **Étape 1 : Écrire le script**

```bash
#!/usr/bin/env bash
# Maintient docs/specs/tickets/INDEX.md et description.md en cohérence.
#
# Usage:
#   bash scripts/update-ticket.sh add <num> <slug> "<description>"
#   bash scripts/update-ticket.sh status <num> <statut>
#
# <statut> : "à faire" | "en cours" | "livré"
set -euo pipefail

INDEX="docs/specs/tickets/INDEX.md"

die() { echo "Erreur: $*" >&2; exit 1; }

cmd_add() {
  local num="$1" slug="$2" desc="$3"
  local folder="${num}-${slug}"
  local link="[${num}](${folder}/description.md)"
  local new_line="| ${link} | ${desc} | à faire |"

  [ -f "$INDEX" ] || die "INDEX.md introuvable : $INDEX"

  # Idempotent : ne rien faire si déjà présent
  if grep -qF "[${num}](" "$INDEX" 2>/dev/null; then
    echo "Ticket ${num} déjà dans l'index, aucune modification."
    exit 0
  fi

  # Insérer en position triée (comparaison lexicographique — fonctionne car
  # numéros zero-paddés sur 3 chiffres + suffixe lettre optionnel)
  awk -v num="$num" -v line="$new_line" '
    BEGIN { inserted = 0 }
    /^\| \[/ && !inserted {
      s = $0
      sub(/^\| \[/, "", s)
      sub(/\].*$/, "", s)
      if (s > num) {
        print line
        inserted = 1
      }
    }
    { print }
    END { if (!inserted) print line }
  ' "$INDEX" > "${INDEX}.tmp" && mv "${INDEX}.tmp" "$INDEX"

  echo "Ticket ${num} ajouté à l'index (statut: à faire)."
}

cmd_status() {
  local num="$1" statut="$2"

  [ -f "$INDEX" ] || die "INDEX.md introuvable : $INDEX"

  # Trouver le dossier du ticket
  local folder
  folder=$(ls -d "docs/specs/tickets/${num}-"*/ 2>/dev/null | head -1)
  [ -n "$folder" ] || die "Dossier ${num}-* introuvable dans docs/specs/tickets/"

  local desc_file="${folder}description.md"
  [ -f "$desc_file" ] || die "description.md introuvable : $desc_file"

  # Mettre à jour description.md
  # Format : ## Statut\n\n**valeur**  (la valeur est sur sa propre ligne)
  sed -i -E 's/^\*\*(à faire|en cours|livré)\*\*$/'"**${statut}**"'/' "$desc_file"

  # Mettre à jour la cellule statut dans INDEX.md
  # Ligne : | [NUM](...) | desc | old_status |
  sed -i -E "/^\| \[${num}\]\(/s/\| [^|]+\|$/\| ${statut} \|/" "$INDEX"

  echo "Ticket ${num} → statut \"${statut}\" (description.md + INDEX.md)."
}

case "${1:-}" in
  add)
    [ $# -ge 4 ] || die "Usage: $0 add <num> <slug> \"<description>\""
    cmd_add "$2" "$3" "$4"
    ;;
  status)
    [ $# -ge 3 ] || die "Usage: $0 status <num> <statut>"
    cmd_status "$2" "$3"
    ;;
  *)
    echo "Usage:"
    echo "  $0 add <num> <slug> \"<description>\""
    echo "  $0 status <num> <statut>"
    exit 1
    ;;
esac
```

- [ ] **Étape 2 : Rendre exécutable**

```bash
chmod +x scripts/update-ticket.sh
```

- [ ] **Étape 3 : Vérifier syntaxe bash**

```bash
bash -n scripts/update-ticket.sh
```

Attendu : aucune sortie (0 erreur).

---

## Task 2 : Créer `docs/specs/tickets/INDEX.md`

**Files:**
- Create: `docs/specs/tickets/INDEX.md`

- [ ] **Étape 1 : Écrire le fichier avec les 41 tickets**

Créer `docs/specs/tickets/INDEX.md` avec ce contenu exact :

```markdown
# Index des tickets

| N° | Description | Statut |
|---|---|---|
| [001](001-lead-cycle-time-bucket-selector/description.md) | Lead/cycle time par taille : séries temporelles avec sélecteur de bucket | livré |
| [002](002-automatisation-pipeline-refresh/description.md) | Automatisation du pipeline refresh | livré |
| [003](003-rapport-liens-jira-cliquables/description.md) | Rapport : liens Jira cliquables sur les clés d'issues | livré |
| [004](004-rapport-indicateur-fraicheur/description.md) | Rapport : indicateur de fraîcheur des données | livré |
| [005](005-onboarding-config-validate/description.md) | Onboarding : config example + commande validate-config | livré |
| [006](006-config-board-column-centric/description.md) | Config board centré sur les colonnes | livré |
| [007](007-rapport-courbe-tendance/description.md) | Rapport : courbe de tendance sur les graphes | livré |
| [008](008-dev-time-allocation/description.md) | Dev time allocation (features vs bugs) | livré |
| [009](009-sync-incremental/description.md) | Sync incrémental | livré |
| [010](010-autoconfig-board-depuis-api-jira/description.md) | Autoconfiguration du board depuis l'API Jira | livré |
| [011](011-legacy-statuses-par-colonne/description.md) | legacyStatuses par colonne | livré |
| [012](012-inference-queue-par-mots-cles/description.md) | Inférence active/queue par mots-clés sur nom de colonne | livré |
| [013](013-bug-backlog/description.md) | Métrique bug-backlog | livré |
| [014](014-rapport-lisibilite-groupement/description.md) | Rapport : lisibilité par groupement thématique | livré |
| [015](015-kpi-signaux-sante/description.md) | KPIs : signaux de santé statiques | livré |
| [016](016-autoconfig-preserve-config-existant/description.md) | autoconfig : préserver le config existant | livré |
| [017](017-split-config-jira-board/description.md) | Split config : séparation credentials Jira / config board | livré |
| [018](018-dev-time-allocation-wip-ratio/description.md) | dev-time-allocation : inclure WIP et corriger avgBugRatio | livré |
| [019](019-role-column-config/description.md) | Role column config | livré |
| [020](020-time-in-status-infra/description.md) | Time-in-status infra | livré |
| [021](021-stage-time-breakdown/description.md) | Stage Time Breakdown | livré |
| [022](022-wip-per-role/description.md) | WIP par rôle | livré |
| [023](023-stage-throughput-gap/description.md) | Stage Throughput Gap | livré |
| [024](024-handoff-rework-detection/description.md) | Handoff Rework Detection | livré |
| [025](025-first-time-right-rate/description.md) | First-Time-Right Rate | livré |
| [026](026-rapport-metriques-role-aware/description.md) | Rapport : métriques role-aware | livré |
| [027](027-rapport-cockpit-refonte/description.md) | Refonte rapport HTML vers design Cockpit | livré |
| [028](028-rapport-personnalisation-config/description.md) | Rapport HTML personnalisable via config YAML | à faire |
| [029](029-rapport-template-handlebars/description.md) | Template Handlebars pour override HTML complet du rapport | à faire |
| [030](030-support-jira-server-pat/description.md) | Support Jira Server / Data Center (PAT auth) | à faire |
| [031](031-scope-change-db-sync/description.md) | Infra DB + sync : changements de champs Jira | livré |
| [032](032-scope-change-metric/description.md) | Métrique : détection de changement de périmètre | livré |
| [033](033-scope-change-report/description.md) | Rapport : graphe scope change + alerte | livré |
| [034](034-scope-change-fix-denominator/description.md) | Corriger le dénominateur de scope-change-rate | livré |
| [035](035-scope-change-description-only/description.md) | scope-change-rate : détection description uniquement | livré |
| [036](036-scope-change-reduce-false-positives/description.md) | scope-change-rate : réduire les faux positifs | livré |
| [037](037-bottleneck-analysis/description.md) | Bottleneck Analysis | à faire |
| [038](038-fake-jira-connector/description.md) | Connecteur Jira fake (mode local sans accès Jira) | livré |
| [039a](039a-estimation-data-model/description.md) | Modèle de données estimation brute | à faire |
| [039b](039b-estimation-bucketize/description.md) | Bucketize par méthode d'estimation | à faire |
| [039c](039c-estimation-throughput-weighted/description.md) | Throughput pondéré adapté à la méthode d'estimation | à faire |
| [039d](039d-estimation-rapport-adaptatif/description.md) | Rapport adaptatif selon méthode d'estimation | à faire |
| [040](040-autoconfig-estimation/description.md) | Autoconfig détection de la méthode d'estimation | à faire |
| [041a](041a-i18n-infra-cli/description.md) | i18n infrastructure + traduction messages CLI | à faire |
| [041b](041b-i18n-report-html/description.md) | Traduction rapport HTML (labels + help texts) | à faire |
| [041c](041c-i18n-readme/description.md) | Réécriture README en anglais | à faire |
```

- [ ] **Étape 2 : Vérifier nombre de lignes de tickets**

```bash
grep -c "^\| \[" docs/specs/tickets/INDEX.md
```

Attendu : `46` (001 → 041c, dont les multi-lettre 039a/b/c/d et 041a/b/c).

- [ ] **Étape 3 : Commit**

```bash
git add scripts/update-ticket.sh docs/specs/tickets/INDEX.md
git commit -m "feat: index tickets + script update-ticket.sh"
```

---

## Task 3 : Tester le script manuellement

**Files:** (aucun fichier permanent modifié dans cette tâche)

- [ ] **Étape 1 : Tester `status` sur ticket 028**

Avant :
```bash
grep "028" docs/specs/tickets/INDEX.md
```
Attendu : `| [028](...) | ... | à faire |`

Commande :
```bash
bash scripts/update-ticket.sh status 028 "en cours"
```
Attendu : `Ticket 028 → statut "en cours" (description.md + INDEX.md).`

Vérifier :
```bash
grep "028" docs/specs/tickets/INDEX.md
grep -A2 "## Statut" docs/specs/tickets/028-rapport-personnalisation-config/description.md
```
Attendu INDEX.md : `| en cours |` en dernière cellule.  
Attendu description.md : `**en cours**`

- [ ] **Étape 2 : Remettre le statut à `à faire`**

```bash
bash scripts/update-ticket.sh status 028 "à faire"
```

Vérifier :
```bash
grep "028" docs/specs/tickets/INDEX.md
```
Attendu : `| à faire |`

- [ ] **Étape 3 : Tester `add` avec un ticket fictif**

```bash
bash scripts/update-ticket.sh add "042" "test-fictif" "Ticket de test temporaire"
```
Attendu : `Ticket 042 ajouté à l'index (statut: à faire).`

Vérifier insertion et position :
```bash
grep -n "042\|041c" docs/specs/tickets/INDEX.md
```
Attendu : ligne 042 après ligne 041c.

- [ ] **Étape 4 : Vérifier idempotence**

```bash
bash scripts/update-ticket.sh add "042" "test-fictif" "Ticket de test temporaire"
```
Attendu : `Ticket 042 déjà dans l'index, aucune modification.`

- [ ] **Étape 5 : Retirer le ticket de test de INDEX.md**

Supprimer manuellement la ligne `| [042]...` dans `docs/specs/tickets/INDEX.md` (Edit tool, supprimer la ligne).

---

## Task 4 : Modifier `.claude/skills/implement-ticket/SKILL.md`

**Files:**
- Modify: `.claude/skills/implement-ticket/SKILL.md` (ligne 135)

Remplacer dans Phase 8 :

```
1. Mettre à jour `description.md` du ticket : `Statut: **livré**`
```

par :

```
1. Appeler le script de clôture (met à jour `description.md` ET `INDEX.md` atomiquement) :
   ```bash
   bash scripts/update-ticket.sh status <NNN> livré
   ```
   où `<NNN>` est le numéro du ticket (ex: `028`, `039a`).
```

- [ ] **Étape 1 : Appliquer la modification**

Utiliser l'outil Edit sur `.claude/skills/implement-ticket/SKILL.md`.

`old_string` exact :
```
1. Mettre à jour `description.md` du ticket : `Statut: **livré**`
```

`new_string` :
```
1. Appeler le script de clôture (met à jour `description.md` ET `INDEX.md` atomiquement) :
   ```bash
   bash scripts/update-ticket.sh status <NNN> livré
   ```
   où `<NNN>` est le numéro du ticket (ex: `028`, `039a`).
```

- [ ] **Étape 2 : Vérifier**

```bash
grep -A5 "Phase 8" .claude/skills/implement-ticket/SKILL.md
```

Attendu : la ligne `bash scripts/update-ticket.sh status` apparaît dans le bloc Phase 8.

---

## Task 5 : Modifier `.claude/skills/ticket-spec/SKILL.md`

**Files:**
- Modify: `.claude/skills/ticket-spec/SKILL.md` (après `## Output confirmation`)

Ajouter une section `## Step 7 — Enregistrer dans INDEX.md` après le bloc `## Output confirmation` (fin du fichier, après la ligne "afficher chaque ticket sur sa propre ligne avec son bucket").

- [ ] **Étape 1 : Appliquer la modification**

Utiliser l'outil Edit sur `.claude/skills/ticket-spec/SKILL.md`.

`old_string` exact (fin du fichier) :
```
Si plusieurs sous-tickets ont été générés suite à un découpage XL, afficher chaque ticket sur
sa propre ligne avec son bucket.
```

`new_string` :
```
Si plusieurs sous-tickets ont été générés suite à un découpage XL, afficher chaque ticket sur
sa propre ligne avec son bucket.

## Step 7 — Enregistrer dans INDEX.md

Après l'output confirmation, appeler le script pour ajouter le ticket à l'index :

```bash
bash scripts/update-ticket.sh add <NNN> <slug> "<description one-line>"
```

- `<NNN>` : numéro zero-paddé (ex: `042`, `039e`)
- `<slug>` : même slug que le dossier créé (kebab-case, sans accents)
- `<description one-line>` : première phrase de la user story condensée (max 80 chars)

Si découpage XL → plusieurs sous-tickets : appeler `add` pour chaque sous-ticket généré.
```

- [ ] **Étape 2 : Vérifier**

```bash
grep -n "Step 7\|update-ticket" .claude/skills/ticket-spec/SKILL.md
```

Attendu : les deux termes apparaissent dans le fichier.

- [ ] **Étape 3 : Commit final**

```bash
git add .claude/skills/implement-ticket/SKILL.md .claude/skills/ticket-spec/SKILL.md
git commit -m "feat(skills): appeler update-ticket.sh depuis ticket-spec et implement-ticket"
```

---

## Notes d'implémentation

- Le script utilise GNU sed (disponible via Git Bash). Ne pas utiliser BSD sed.
- `sed -i` sans suffixe = in-place sans backup (GNU sed). Correct sur Windows Git Bash.
- Tri lexicographique des numéros : fonctionne car numéros zero-paddés sur 3+ chars.
- Script idempotent sur `add` (skip si déjà présent). Pas de garde sur `status` (intentionnel : corrections manuelles possibles).
