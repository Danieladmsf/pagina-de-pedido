#!/usr/bin/env bash
# ============================================================================
# Claude Hybrid Engine (CLI Interativo + Servidor Paralelo)
# ============================================================================
# Arquitetura:
#   1. Sobe um Servidor HTTP (Python) em background na porta 8080.
#      - Recebe POST /run e processa jobs em paralelo (fila FIFO).
#   2. Sobe o Claude CLI interativo no Foreground para você usar normalmente.
#   3. Quando você sai do Claude, o servidor em background é morto (sem órfãos).
# ============================================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
export PATH="${SCRIPT_DIR}:${HOME}/bin:${PATH}"

# --- Configurações de Caminhos ---
if [[ -d "/c/Users/Administrador" ]]; then
    WIN_HOME="/c/Users/Administrador"
elif [[ -d "/mnt/c/Users/Administrador" ]]; then
    WIN_HOME="/mnt/c/Users/Administrador"
else
    WIN_HOME="$HOME"
fi

SESSIONS_DIR="${WIN_HOME}/.claude/balancer"
PID_DIR="${SESSIONS_DIR}/pids"
mkdir -p "$SESSIONS_DIR" "$PID_DIR"
rm -f "${PID_DIR}"/*.pid 2>/dev/null || true

# --- Configurações de Rede e Motor ---
BASE_PORT="${CLAUDE_BASE_PORT:-62608}"
FRONTEND_PORT="${CLAUDE_FRONTEND_PORT:-8080}"
BIND_ADDR="${CLAUDE_LB_BIND:-127.0.0.1}"
NUM_WORKERS="${CLAUDE_NUM_WORKERS:-3}"
JOB_TIMEOUT="${CLAUDE_LB_TIMEOUT:-600}"
AUTH_TOKEN="${CLAUDE_LB_TOKEN:-}"

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
# MOTOR: Servidor de Inferência Paralela (Background)
# ============================================================================
start_dispatcher() {
    local out_log="${SESSIONS_DIR}/dispatcher.log"
    
    # Inicia o Python em background (&) e redireciona a saída para um log
    PYTHONIOENCODING=utf-8 PYTHONUNBUFFERED=1 \
    "$PYTHON_BIN" - "$FRONTEND_PORT" "$BIND_ADDR" "$NUM_WORKERS" "$CLAUDE_BIN" \
        "$JOB_TIMEOUT" "$PID_DIR" "$PWD" "$AUTH_TOKEN" <<'PYEOF' > "$out_log" 2>&1 &
import json
import os
import queue
import re
import shutil
import subprocess
import sys
import threading
import time
import uuid
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

FRONTEND_PORT = int(sys.argv[1])
BIND_ADDR = sys.argv[2]
NUM_WORKERS = int(sys.argv[3])
CLAUDE_BIN = sys.argv[4]
JOB_TIMEOUT = int(sys.argv[5])
PID_DIR = sys.argv[6]
LAUNCH_DIR = sys.argv[7]
AUTH_TOKEN = sys.argv[8] if len(sys.argv) > 8 else ""

MAX_BODY = 10_000_000
MAX_TIMEOUT = 3600

def resolve_claude():
    exts = ('.exe', '.cmd', '.bat')
    base = CLAUDE_BIN if (CLAUDE_BIN.lower().endswith(exts) and os.path.isfile(CLAUDE_BIN)) else None
    if base is None:
        for ext in exts + ('',):
            found = shutil.which(CLAUDE_BIN + ext)
            if found:
                base = found
                break
    if base is None:
        return None
    native = os.path.join(os.path.dirname(base), 'node_modules',
                          '@anthropic-ai', 'claude-code', 'bin', 'claude.exe')
    if os.name == 'nt' and os.path.isfile(native):
        return [native]
    if base.lower().endswith(('.cmd', '.bat')):
        return ["cmd.exe", "/c", base]
    return [base]

CLAUDE_ARGV = resolve_claude()
if not CLAUDE_ARGV:
    print(f"[FATAL] Não achei o executável do claude ({CLAUDE_BIN})")
    sys.exit(1)

slots = queue.Queue()
for i in range(1, NUM_WORKERS + 1):
    slots.put(i)

stats_lock = threading.Lock()
stats = {"done": 0, "errors": 0, "waiting": 0, "started_at": time.time()}
live_procs = set()
procs_lock = threading.Lock()

RE_MODEL = re.compile(r'^[\w.:\-\[\]]{1,128}$')
RE_SESSION = re.compile(r'^[0-9a-fA-F\-]{8,64}$')
RE_TOOL = re.compile(r'^[\w()*:,.\s\-/]{1,200}$')
PERMISSION_MODES = {"default", "acceptEdits", "plan", "bypassPermissions"}

def kill_tree(proc):
    try:
        if os.name == 'nt':
            subprocess.run(["taskkill", "/F", "/T", "/PID", str(proc.pid)],
                           stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        else:
            proc.kill()
    except Exception:
        pass

def build_argv(p, stream):
    argv = list(CLAUDE_ARGV) + ["-p", "--output-format",
                                "stream-json" if stream else "json"]
    if stream:
        argv.append("--verbose")
    if p.get("model"):
        argv += ["--model", p["model"]]
    if p.get("system_prompt"):
        argv += ["--append-system-prompt", p["system_prompt"]]
    if p.get("session_id"):
        argv += ["--resume", p["session_id"]]
    if p.get("permission_mode"):
        argv += ["--permission-mode", p["permission_mode"]]
    if p.get("allowed_tools"):
        argv += ["--allowed-tools", ",".join(p["allowed_tools"])]
    if p.get("max_turns"):
        argv += ["--max-turns", str(p["max_turns"])]
    if p.get("dangerously_skip_permissions"):
        argv.append("--dangerously-skip-permissions")
    return argv

def validate(p):
    if not isinstance(p, dict): return "corpo deve ser um objeto JSON"
    prompt = p.get("prompt")
    if not isinstance(prompt, str) or not prompt.strip(): return "campo 'prompt' (string não vazia) é obrigatório"
    if p.get("model") is not None and not RE_MODEL.match(str(p["model"])): return "campo 'model' inválido"
    if p.get("session_id") is not None and not RE_SESSION.match(str(p["session_id"])): return "campo 'session_id' inválido"
    if p.get("permission_mode") is not None and p["permission_mode"] not in PERMISSION_MODES: return f"'permission_mode' deve ser um de {sorted(PERMISSION_MODES)}"
    if p.get("allowed_tools") is not None:
        if not isinstance(p["allowed_tools"], list) or not all(isinstance(t, str) and RE_TOOL.match(t) for t in p["allowed_tools"]): return "'allowed_tools' deve ser lista de strings simples"
    if p.get("max_turns") is not None and (not isinstance(p["max_turns"], int) or not 1 <= p["max_turns"] <= 1000): return "'max_turns' deve ser inteiro entre 1 e 1000"
    if p.get("cwd") is not None and not os.path.isdir(str(p["cwd"])): return "'cwd' não é um diretório existente"
    if p.get("timeout_s") is not None and (not isinstance(p["timeout_s"], (int, float)) or not 10 <= p["timeout_s"] <= MAX_TIMEOUT): return f"'timeout_s' deve estar entre 10 e {MAX_TIMEOUT}"
    if p.get("system_prompt") is not None and not isinstance(p["system_prompt"], str): return "'system_prompt' deve ser string"
    return None

def spawn_job(payload, stream):
    argv = build_argv(payload, stream)
    proc = subprocess.Popen(argv, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                            cwd=payload.get("cwd") or LAUNCH_DIR, text=True, encoding='utf-8', errors='replace')
    with procs_lock: live_procs.add(proc)
    pid_file = os.path.join(PID_DIR, f"job_{uuid.uuid4().hex}.pid")
    with open(pid_file, 'w') as f: f.write(str(proc.pid))
    return proc, pid_file

def reap_job(proc, pid_file, timer):
    if timer: timer.cancel()
    with procs_lock: live_procs.discard(proc)
    try: os.remove(pid_file)
    except OSError: pass

class Handler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"
    server_version = "ClaudeLB/2.0"
    def log_message(self, fmt, *args): pass

    def send_json(self, status, obj):
        body = json.dumps(obj, ensure_ascii=False).encode('utf-8')
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def authorized(self):
        if not AUTH_TOKEN: return True
        got = self.headers.get("Authorization", "")
        import hmac
        return hmac.compare_digest(got, f"Bearer {AUTH_TOKEN}")

    def do_GET(self):
        if self.path != "/health": return self.send_json(404, {"error": "use POST /run ou GET /health"})
        with stats_lock: snap = dict(stats)
        self.send_json(200, {"ok": True, "slots": NUM_WORKERS, "busy": NUM_WORKERS - slots.qsize(),
                             "waiting": snap["waiting"], "done": snap["done"], "errors": snap["errors"],
                             "uptime_s": round(time.time() - snap["started_at"], 1), "claude": CLAUDE_ARGV})

    def do_POST(self):
        if self.path != "/run": return self.send_json(404, {"error": "use POST /run"})
        if not self.authorized(): return self.send_json(401, {"error": "token inválido"})
        try: length = int(self.headers.get("Content-Length", 0))
        except ValueError: length = 0
        if not 0 < length <= MAX_BODY: return self.send_json(413, {"error": f"Content-Length obrigatório, máx {MAX_BODY}"})
        try: payload = json.loads(self.rfile.read(length).decode('utf-8'))
        except Exception: return self.send_json(400, {"error": "JSON inválido"})
        err = validate(payload)
        if err: return self.send_json(400, {"error": err})

        timeout = float(payload.get("timeout_s") or JOB_TIMEOUT)
        stream = bool(payload.get("stream"))

        with stats_lock: stats["waiting"] += 1
        slot = slots.get()
        with stats_lock: stats["waiting"] -= 1

        t0 = time.time()
        try:
            if stream: self.run_streaming(payload, slot, timeout, t0)
            else: self.run_buffered(payload, slot, timeout, t0)
        except Exception as e:
            with stats_lock: stats["errors"] += 1
            try: self.send_json(500, {"ok": False, "worker": slot, "error": f"{type(e).__name__}: {e}"})
            except Exception: pass
        finally: slots.put(slot)

    def run_buffered(self, payload, slot, timeout, t0):
        proc, pid_file = spawn_job(payload, stream=False)
        timer = None
        try:
            try: out, errout = proc.communicate(payload["prompt"], timeout=timeout)
            except subprocess.TimeoutExpired:
                kill_tree(proc); out, errout = proc.communicate()
                with stats_lock: stats["errors"] += 1
                return self.send_json(504, {"ok": False, "worker": slot, "error": f"timeout de {int(timeout)}s", "stdout_tail": out[-2000:], "stderr_tail": errout[-2000:]})
        finally: reap_job(proc, pid_file, timer)

        dur = round((time.time() - t0) * 1000)
        if proc.returncode != 0:
            with stats_lock: stats["errors"] += 1
            return self.send_json(502, {"ok": False, "worker": slot, "exit_code": proc.returncode, "duration_ms": dur, "stdout_tail": out[-2000:], "stderr_tail": errout[-2000:]})
        try: result = json.loads(out.strip().splitlines()[-1])
        except Exception: result = {"raw_stdout": out[-8000:]}
        with stats_lock: stats["done"] += 1
        self.send_json(200, {"ok": True, "worker": slot, "duration_ms": dur, "response": result})

    def run_streaming(self, payload, slot, timeout, t0):
        proc, pid_file = spawn_job(payload, stream=True)
        timer = threading.Timer(timeout, kill_tree, args=(proc,))
        timer.daemon = True; timer.start()
        self.send_response(200)
        self.send_header("Content-Type", "application/x-ndjson; charset=utf-8")
        self.send_header("Connection", "close"); self.end_headers(); self.close_connection = True
        try:
            proc.stdin.write(payload["prompt"]); proc.stdin.close()
            for line in proc.stdout:
                self.wfile.write(line.encode('utf-8')); self.wfile.flush()
            proc.wait()
        except (BrokenPipeError, ConnectionError, OSError):
            kill_tree(proc)
            try: proc.wait(timeout=10)
            except Exception: pass
        finally: reap_job(proc, pid_file, timer)
        dur = round((time.time() - t0) * 1000)
        ok = proc.returncode == 0
        with stats_lock: stats["done" if ok else "errors"] += 1
        try:
            tail = json.dumps({"type": "balancer", "worker": slot, "exit_code": proc.returncode, "duration_ms": dur})
            self.wfile.write((tail + "\n").encode('utf-8'))
        except OSError: pass

print(f"[Dispatcher] {NUM_WORKERS} slots paralelos | timeout {JOB_TIMEOUT}s/job")
print(f"[Load Balancer] Escutando em {BIND_ADDR}:{FRONTEND_PORT} - POST /run | GET /health")

server = ThreadingHTTPServer((BIND_ADDR, FRONTEND_PORT), Handler)
server.daemon_threads = True
try: server.serve_forever()
except KeyboardInterrupt: pass
finally:
    with procs_lock: pending = list(live_procs)
    for p in pending: kill_tree(p)
PYEOF
    PYTHON_PID=$!
    echo $PYTHON_PID > "${PID_DIR}/dispatcher.pid"
}

# ============================================================================
# LIMPEZA CIRÚRGICA (Sem Órfãos)
# ============================================================================
PYTHON_PID=""
CLEANUP_DONE=""
cleanup() {
    [[ -n "$CLEANUP_DONE" ]] && return 0
    CLEANUP_DONE=1
    echo -e "\n${RED}🛑 Desligando o Motor e o CLI...${NC}"
    
    # Mata o servidor Python e toda a árvore de jobs
    if [[ -n "$PYTHON_PID" ]]; then
        taskkill //F //T //PID "$PYTHON_PID" >/dev/null 2>&1 || kill "$PYTHON_PID" 2>/dev/null || true
    fi
    
    # Backstop: varre pidfiles de jobs que porventura sobraram
    for f in "${PID_DIR}"/*.pid; do
        [[ -f "$f" ]] || continue
        pid=$(tr -d '\r\n' < "$f")
        [[ -n "$pid" ]] && taskkill //F //T //PID "$pid" >/dev/null 2>&1 || true
        rm -f "$f"
    done
    echo -e "${GREEN}✓ Tudo desligado. Nenhum órfão deixado.${NC}"
}
trap cleanup EXIT INT TERM

# ============================================================================
# MAIN
# ============================================================================
main() {
    clear 2>/dev/null || true
    echo -e "${RED}╔════════════════════════════════════════════════════════════╗${NC}"
    echo -e "${RED}║${NC}  ${PURPLE}⚡ CLAUDE HYBRID ENGINE (CLI + PARALLEL API) ⚡${NC}     ${RED}║${NC}"
    echo -e "${RED}╚════════════════════════════════════════════════════════════╝${NC}"
    echo
    echo -e "  ${GREEN}🌐 API Paralela:${NC}     ${YELLOW}http://${BIND_ADDR}:${FRONTEND_PORT}/run${NC} (Rodando oculto)"
    echo -e "  ${GREEN}⚙️ Pool:${NC}            ${YELLOW}${NUM_WORKERS} jobs em paralelo${NC}"
    echo -e "  ${GREEN}⏱️ Timeout:${NC}         ${YELLOW}${JOB_TIMEOUT}s por job${NC}"
    echo
    
    # 1. Inicia o Servidor Python (Dispatcher) em BACKGROUND
    start_dispatcher
    
    # Dá 2 segundos pro Python subir e bindar na porta
    sleep 2
    
    echo -e "${YELLOW}Iniciando Claude CLI interativo...${NC}"
    echo -e "${YELLOW}(Para mandar comandos paralelos, use outra janela com curl)${NC}"
    echo -e "${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    echo
    
    # 2. Exporta a variável e INICIA O CLAUDE NO FOREGROUND (para você digitar)
    export CLAUDE_CODE_SSE_PORT="${BASE_PORT}"
    "$CLAUDE_BIN" "$@"
}

main "$@"