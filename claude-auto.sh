#!/usr/bin/env bash
# ============================================================================
# Claude Round-Robin Load Balancer (Agressive Mode)
# ============================================================================
# Arquitetura de Alto Desempenho:
#   1. Sobe N instâncias do Claude em background (Worker Pool).
#   2. Sobe um Proxy Reverso TCP em Python (Round-Robin) na porta 8080.
#   3. Todas as requisições são divididas igualmente entre as instâncias.
#   4. Auto-Healing: Se um worker cair, ele é reiniciado.
#   5. Kill cirúrgico sem deixar órfãos no Windows.
# ============================================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
export PATH="${SCRIPT_DIR}:${HOME}/bin:${PATH}"

# --- Configurações ---
if [[ -d "/c/Users/Administrador" ]]; then
    WIN_HOME="/c/Users/Administrador"
elif [[ -d "/mnt/c/Users/Administrador" ]]; then
    WIN_HOME="/mnt/c/Users/Administrador"
else
    WIN_HOME="$HOME"
fi

SESSIONS_DIR="${WIN_HOME}/.claude/balancer"
STATE_FILE="${SESSIONS_DIR}/workers.json"
PID_DIR="${SESSIONS_DIR}/pids"
mkdir -p "$SESSIONS_DIR" "$PID_DIR"

FRONTEND_PORT="${CLAUDE_FRONTEND_PORT:-8080}"
BASE_PORT="${CLAUDE_BASE_PORT:-62608}"
NUM_WORKERS="${CLAUDE_NUM_WORKERS:-3}"

# --- Cores ---
if [[ -t 1 ]]; then
    CYAN='\033[0;36m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'
    PURPLE='\033[0;35m'; RED='\033[0;31m'; NC='\033[0m'
else
    CYAN=''; GREEN=''; YELLOW=''; PURPLE=''; RED=''; NC=''
fi

# --- Dependências ---
require() {
    for cmd in "$@"; do
        command -v "$cmd" >/dev/null 2>&1 || {
            echo -e "${RED}Dependência faltando: $cmd${NC}" >&2
            exit 1
        }
    done
}
require jq

# Detecção agressiva de Python (Ignora o alias da Microsoft Store)
PYTHON_BIN=""
for cmd in python3 python py; do
    path=$(command -v "$cmd" 2>/dev/null || true)
    if [[ -n "$path" ]] && [[ "$path" != *"WindowsApps"* ]]; then
        PYTHON_BIN="$cmd"
        break
    fi
done
if [[ -z "$PYTHON_BIN" ]]; then
    echo -e "${RED}Python real não encontrado. Instale do python.org${NC}" >&2
    exit 1
fi

# Encontra o executável do claude
CLAUDE_BIN="claude"
if ! command -v "$CLAUDE_BIN" >/dev/null 2>&1; then
    CLAUDE_BIN="${WIN_HOME}/.local/bin/claude.exe"
    [[ -x "$CLAUDE_BIN" ]] || { echo -e "${RED}Claude CLI não encontrado${NC}"; exit 1; }
fi

# ============================================================================
# MOTOR 1: Spawner e Auto-Healer dos Workers
# ============================================================================
spawn_workers() {
    echo -e "${CYAN}Spawnando ${NUM_WORKERS} Workers Claude...${NC}"
    jq -n --argjson base "$BASE_PORT" --argjson n "$NUM_WORKERS" \
        '[range(1; $n + 1) | {id: ., port: ($base + . - 1)}]' | tr -d '\r' > "$STATE_FILE"

    while IFS=$'\t' read -r id port; do
        id=$(echo "$id" | tr -d '\r'); port=$(echo "$port" | tr -d '\r')
        local pid_file="${PID_DIR}/worker_${id}.pid"
        local out_log="${SESSIONS_DIR}/worker_${id}.log"
        
        # Inicia em background
        CLAUDE_CODE_SSE_PORT=$port "$CLAUDE_BIN" > "$out_log" 2>&1 &
        echo $! > "$pid_file"
        echo -e "  ${GREEN}✓${NC} Worker $id ativo na porta $port"
    done < <(jq -r '.[] | [.id, .port] | @tsv' "$STATE_FILE")
}

# ============================================================================
# MOTOR 2: Proxy Reverso Round-Robin (Em Python Embutido)
# ============================================================================
start_load_balancer() {
    "$PYTHON_BIN" - "$FRONTEND_PORT" "$STATE_FILE" "$PID_DIR" "$CLAUDE_BIN" "$BASE_PORT" <<'PYEOF'
import socket
import threading
import json
import os
import time
import sys
import shutil
import subprocess

FRONTEND_PORT = int(sys.argv[1])
STATE_FILE = sys.argv[2]
PID_DIR = sys.argv[3]
CLAUDE_BIN = sys.argv[4]
BASE_PORT = int(sys.argv[5])

# CreateProcess do Windows não resolve "claude" -> claude.cmd/claude.exe como o
# Git Bash faz (WinError 2). Resolve o caminho real uma vez, no boot.
def resolve_claude():
    exts = ('.exe', '.cmd', '.bat')
    if CLAUDE_BIN.lower().endswith(exts) and os.path.isfile(CLAUDE_BIN):
        return CLAUDE_BIN
    for ext in exts:
        found = shutil.which(CLAUDE_BIN + ext)
        if found:
            return found
    return shutil.which(CLAUDE_BIN) or CLAUDE_BIN

CLAUDE_EXE = resolve_claude()

def claude_argv():
    # Scripts .cmd/.bat só rodam via interpretador cmd.exe
    if CLAUDE_EXE.lower().endswith(('.cmd', '.bat')):
        return ["cmd.exe", "/c", CLAUDE_EXE]
    return [CLAUDE_EXE]

def get_workers():
    try:
        with open(STATE_FILE, 'r') as f:
            return json.load(f)
    except:
        return []

def restart_worker(worker_id):
    port = BASE_PORT + worker_id - 1
    pid_file = os.path.join(PID_DIR, f"worker_{worker_id}.pid")
    out_log = os.path.join(os.path.dirname(PID_DIR), f"worker_{worker_id}.log")
    
    # Mata o velho (// é escape do Git Bash; direto no Windows é /F /T /PID)
    if os.path.exists(pid_file):
        with open(pid_file, 'r') as f:
            old_pid = f.read().strip()
        if old_pid:
            if os.name == 'nt':
                try: subprocess.run(["taskkill", "/F", "/T", "/PID", old_pid], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
                except: pass
            else:
                try: os.kill(int(old_pid), 15)
                except: pass

    # Sobe o novo
    env = os.environ.copy()
    env["CLAUDE_CODE_SSE_PORT"] = str(port)
    proc = subprocess.Popen(claude_argv(), stdin=subprocess.DEVNULL,
                            stdout=open(out_log, 'a'), stderr=subprocess.STDOUT, env=env)
    with open(pid_file, 'w') as f:
        f.write(str(proc.pid))
    print(f"[Auto-Healer] Worker {worker_id} reiniciado na porta {port}")

def check_port(port):
    s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    s.settimeout(0.5)
    try:
        s.connect(('127.0.0.1', port))
        s.close()
        return True
    except:
        return False

def health_check_loop():
    while True:
        time.sleep(10)
        workers = get_workers()
        for w in workers:
            if not check_port(w['port']):
                print(f"[Health-Check] Worker {w['id']} caiu! Reiniciando...")
                # Falha no restart não pode derrubar a thread do Auto-Healer
                try:
                    restart_worker(w['id'])
                except Exception as e:
                    print(f"[Auto-Healer] Falha ao reiniciar Worker {w['id']}: {e}")

def forward(src, dst):
    try:
        while True:
            data = src.recv(8192)
            if not data: break
            dst.sendall(data)
    except: pass
    finally:
        try: src.close()
        except: pass
        try: dst.close()
        except: pass

def handle_client(client_sock):
    workers = get_workers()
    if not workers: return
    
    # Round-Robin Simples (Tenta achar um vivo)
    for _ in range(len(workers)):
        global rr_index
        rr_index = (rr_index + 1) % len(workers)
        target = workers[rr_index]
        
        if check_port(target['port']):
            try:
                backend = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
                backend.connect(('127.0.0.1', target['port']))
                t1 = threading.Thread(target=forward, args=(client_sock, backend))
                t2 = threading.Thread(target=forward, args=(backend, client_sock))
                t1.daemon = True; t2.daemon = True
                t1.start(); t2.start()
                t1.join()
                return
            except: pass
    
    client_sock.close()

rr_index = -1
server = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
server.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
server.bind(('0.0.0.0', FRONTEND_PORT))
server.listen(5)

# Inicia o Auto-Healer em background
t_hc = threading.Thread(target=health_check_loop)
t_hc.daemon = True
t_hc.start()

print(f"[Load Balancer] Escutando na porta {FRONTEND_PORT} - Modo Round-Robin")

while True:
    client, addr = server.accept()
    t = threading.Thread(target=handle_client, args=(client,))
    t.daemon = True
    t.start()
PYEOF
}

# ============================================================================
# SISTEMA DE LIMPEZA CIRÚRGICO (Sem Órfãos)
# ============================================================================
cleanup() {
    echo -e "\n${RED}🛑 Desligando o Cluster...${NC}"
    
    # Mata os Workers usando o PID salvo e Taskkill
    if [[ -f "$STATE_FILE" ]]; then
        while IFS=$'\t' read -r id port; do
            id=$(echo "$id" | tr -d '\r')
            local pid_file="${PID_DIR}/worker_${id}.pid"
            if [[ -f "$pid_file" ]]; then
                local pid=$(cat "$pid_file" | tr -d '\r')
                # No Git Bash, matamos a árvore do processo
                kill "$pid" 2>/dev/null || true
                taskkill //F //PID "$pid" >/dev/null 2>&1 || true
                rm -f "$pid_file"
            fi
        done < <(jq -r '.[] | [.id, .port] | @tsv' "$STATE_FILE" 2>/dev/null)
    fi
    echo -e "${GREEN}✓ Cluster desligado. Nenhum órfão deixado.${NC}"
}
trap cleanup EXIT INT TERM

# ============================================================================
# MAIN
# ============================================================================
main() {
    clear
    echo -e "${RED}╔════════════════════════════════════════════════════════════╗${NC}"
    echo -e "${RED}║${NC}  ${PURPLE}⚡ CLAUDE ROUND-ROBIN LOAD BALANCER ⚡${NC}                ${RED}║${NC}"
    echo -e "${RED}╚════════════════════════════════════════════════════════════╝${NC}"
    echo
    
    spawn_workers
    echo
    
    echo -e "  ${GREEN}🌐 Proxy Frontal:${NC}       ${YELLOW}127.0.0.1:${FRONTEND_PORT}${NC}"
    echo -e "  ${GREEN}⚙️ Algoritmo:${NC}           ${YELLOW}Round-Robin (Paralelo)${NC}"
    echo -e "  ${GREEN}🩺 Auto-Healing:${NC}        ${YELLOW}Ativado (10s check)${NC}"
    echo
    echo -e "${YELLOW}>>> Conecte suas ferramentas/scripts na porta ${FRONTEND_PORT} <<<${NC}"
    echo -e "${YELLOW}>>> Pressione Ctrl+C para desligar tudo <<<${NC}"
    echo
    
    # Inicia o Proxy e prende o terminal
    start_load_balancer
}

main "$@"