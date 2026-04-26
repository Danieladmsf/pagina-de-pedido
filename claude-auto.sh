#!/usr/bin/env bash
# ============================================================================
# Claude Auto - Inicia Claude com Auto-Switch de Portas
# ============================================================================
# Script que:
#   1. Garante N sessões com portas em ~/.claude/tmux-sessions/sessions.json
#   2. Sorteia porta inicial e exporta CLAUDE_CODE_SSE_PORT
#   3. Mantém um switcher em background que atualiza um arquivo de estado
#      (current_port) a cada SWITCH_INTERVAL segundos, com health-check
#   4. Inicia o Claude CLI
#
# Nota: exportar env var de um subshell em background NÃO afeta o processo
# pai já em execução. Por isso o switcher grava em `current_port` — qualquer
# wrapper/consumidor pode reler esse arquivo. A porta inicial passada ao
# Claude é aplicada via export antes do exec.

set -euo pipefail

# ---------------------------------------------------------------------------
# Adiciona o diretório do script ao PATH (para encontrar jq.exe local)
# ---------------------------------------------------------------------------
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
export PATH="${SCRIPT_DIR}:${HOME}/bin:${PATH}"

# ---------------------------------------------------------------------------
# Configuração (sobrescrevível por env)
# ---------------------------------------------------------------------------
# Detecta HOME correto no Windows (WSL usa /mnt/c, Git Bash usa /c)
if [[ -d "/mnt/c/Users/Administrador" ]]; then
    WIN_HOME="/mnt/c/Users/Administrador"
elif [[ -d "/c/Users/Administrador" ]]; then
    WIN_HOME="/c/Users/Administrador"
else
    WIN_HOME="$HOME"
fi
SESSIONS_DIR="${CLAUDE_SESSIONS_DIR:-${WIN_HOME}/.claude/tmux-sessions}"
STATE_FILE="${SESSIONS_DIR}/sessions.json"
CURRENT_PORT_FILE="${SESSIONS_DIR}/current_port"
LOG_FILE="${SESSIONS_DIR}/auto_switch.log"
LOCK_FILE="${SESSIONS_DIR}/.auto_switcher.lock"
PID_FILE="${SESSIONS_DIR}/.auto_switcher.pid"
LAST_PORT_FILE="${SESSIONS_DIR}/.last_port"

BASE_PORT="${CLAUDE_BASE_PORT:-62608}"
NUM_SESSIONS="${CLAUDE_NUM_SESSIONS:-3}"
SWITCH_INTERVAL="${CLAUDE_SWITCH_INTERVAL:-60}"
LOG_MAX_BYTES="${CLAUDE_LOG_MAX_BYTES:-1048576}"   # 1 MiB
HEALTH_TIMEOUT="${CLAUDE_HEALTH_TIMEOUT:-1}"

# Cores (desabilitadas se não for TTY)
if [[ -t 1 ]]; then
    CYAN='\033[0;36m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'
    PURPLE='\033[0;35m'; RED='\033[0;31m'; NC='\033[0m'
else
    CYAN=''; GREEN=''; YELLOW=''; PURPLE=''; RED=''; NC=''
fi

# ---------------------------------------------------------------------------
# Dependências
# ---------------------------------------------------------------------------
# No Windows (WSL/Git Bash), tenta localizar binários se não estiverem no PATH
_find_cmd() {
    local cmd="$1"; shift
    if ! command -v "$cmd" >/dev/null 2>&1; then
        for _candidate in "$@"; do
            if [[ -x "$_candidate" ]]; then
                eval "$cmd() { \"$_candidate\" \"\$@\"; }"
                return 0
            fi
        done
    fi
}
_find_cmd jq \
    "${SCRIPT_DIR}/jq.exe" \
    "${SCRIPT_DIR}/jq" \
    "/mnt/c/Users/Administrador/bin/jq.exe" \
    "/c/Users/Administrador/bin/jq.exe"
_find_cmd claude \
    "/mnt/c/Users/Administrador/.local/bin/claude.exe" \
    "/c/Users/Administrador/.local/bin/claude.exe" \
    "/c/Users/Administrador/.local/bin/claude"

require() {
    for cmd in "$@"; do
        command -v "$cmd" >/dev/null 2>&1 || type "$cmd" >/dev/null 2>&1 || {
            echo -e "${RED}Dependência faltando: $cmd${NC}" >&2
            exit 1
        }
    done
}
require jq claude

# ---------------------------------------------------------------------------
# Estado das sessões
# ---------------------------------------------------------------------------
ensure_sessions() {
    mkdir -p "$SESSIONS_DIR"
    if [[ ! -s "$STATE_FILE" ]] || [[ "$(jq 'length' "$STATE_FILE")" -eq 0 ]]; then
        echo -e "${CYAN}Criando ${NUM_SESSIONS} sessões...${NC}"
        jq -n \
            --argjson base "$BASE_PORT" \
            --argjson n "$NUM_SESSIONS" \
            '[range(1; $n + 1) | {id: ., port: ($base + .), tmux_session: "claude-\(.)"}]' \
            > "$STATE_FILE"
        echo -e "${GREEN}✓ ${NUM_SESSIONS} sessões criadas${NC}"
    fi
}

# Todas as portas, uma por linha
list_ports() {
    jq -r '.[].port' "$STATE_FILE"
}

# Sorteia uma porta saudável, evitando repetir a anterior quando possível
pick_port() {
    local last=""
    [[ -f "$LAST_PORT_FILE" ]] && last=$(<"$LAST_PORT_FILE")

    mapfile -t ports < <(list_ports | shuf)
    local fallback=""
    for p in "${ports[@]}"; do
        [[ -z "$fallback" ]] && fallback="$p"
        [[ "$p" == "$last" ]] && continue
        if curl -sf -m "$HEALTH_TIMEOUT" "http://127.0.0.1:${p}/" >/dev/null 2>&1; then
            echo "$p"; return 0
        fi
    done
    # Nenhuma respondeu ao health-check: devolve uma aleatória mesmo assim
    echo "${fallback:-${ports[0]}}"
}

# ---------------------------------------------------------------------------
# Log rotativo simples
# ---------------------------------------------------------------------------
log_line() {
    local msg="$1"
    if [[ -f "$LOG_FILE" ]]; then
        local size
        size=$(stat -c%s "$LOG_FILE" 2>/dev/null || stat -f%z "$LOG_FILE" 2>/dev/null || echo 0)
        (( size > LOG_MAX_BYTES )) && mv -f "$LOG_FILE" "${LOG_FILE}.1"
    fi
    printf '%s %s\n' "$(date '+%F %T')" "$msg" >> "$LOG_FILE"
}

# ---------------------------------------------------------------------------
# Auto-switcher em background (com lock para evitar concorrência)
# ---------------------------------------------------------------------------
start_auto_switcher() {
    # Mata switcher anterior, se vivo
    if [[ -f "$PID_FILE" ]]; then
        local old; old=$(<"$PID_FILE")
        if [[ -n "$old" ]] && kill -0 "$old" 2>/dev/null; then
            kill "$old" 2>/dev/null || true
        fi
        rm -f "$PID_FILE"
    fi

    (
        exec 9>"$LOCK_FILE"
        flock -n 9 || exit 0
        while true; do
            sleep "$SWITCH_INTERVAL"
            local new_port
            new_port=$(pick_port)
            printf '%s' "$new_port" > "$CURRENT_PORT_FILE"
            printf '%s' "$new_port" > "$LAST_PORT_FILE"
            log_line "auto-switch -> $new_port"
        done
    ) &
    echo $! > "$PID_FILE"
}

stop_auto_switcher() {
    if [[ -f "$PID_FILE" ]]; then
        local pid; pid=$(<"$PID_FILE")
        if [[ -n "$pid" ]] && kill -0 "$pid" 2>/dev/null; then
            kill "$pid" 2>/dev/null || true
        fi
        rm -f "$PID_FILE"
    fi
}

# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------
main() {
    ensure_sessions

    local initial_port
    initial_port=$(pick_port)
    export CLAUDE_CODE_SSE_PORT="$initial_port"
    printf '%s' "$initial_port" > "$CURRENT_PORT_FILE"
    printf '%s' "$initial_port" > "$LAST_PORT_FILE"

    clear
    echo -e "${CYAN}╔════════════════════════════════════════════════════════════╗${NC}"
    echo -e "${CYAN}║${NC}  ${PURPLE}🎲 Claude Auto - Randomização Ativa${NC}                   ${CYAN}║${NC}"
    echo -e "${CYAN}╚════════════════════════════════════════════════════════════╝${NC}"
    echo
    echo -e "  ${GREEN}🔌 Porta Inicial:${NC} ${YELLOW}${initial_port}${NC}"
    echo -e "  ${GREEN}🔄 Auto-Switch:${NC}   ${YELLOW}${SWITCH_INTERVAL}s${NC}"
    echo -e "  ${GREEN}📋 Sessões:${NC}      ${YELLOW}${NUM_SESSIONS}${NC} (base ${BASE_PORT})"
    echo -e "  ${GREEN}📝 Estado:${NC}       ${CURRENT_PORT_FILE}"
    echo
    echo -e "${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    echo

    start_auto_switcher
    trap stop_auto_switcher EXIT INT TERM

    # Sem `exec`: garante que o trap dispare ao sair do Claude
    claude "$@"
}

main "$@"
