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
