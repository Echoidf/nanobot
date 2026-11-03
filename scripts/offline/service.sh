#!/usr/bin/env bash
# ============================================================
# nanodesk service manager (offline bundle companion)
#
# Manages the nanodesk gateway as a background process with
# nohup, so it keeps running after the terminal exits. No
# systemd/root required — suitable for air-gapped boxes.
#
# Usage:
#   bash service.sh start            # start gateway in background
#   bash service.sh stop             # stop gateway
#   bash service.sh restart          # stop + start
#   bash service.sh status           # show running state (exit 0/1)
#   bash service.sh logs [-n LINES]  # follow the gateway log
#   bash service.sh doctor           # diagnose ownership / identity problems
#
# Layout (relative to this script):
#   config.json.example  config template (first start bootstraps from it)
#   run/gateway.pid      pid file of the background process
#   logs/gateway.log     stdout/stderr of the background process
#
# The service binary is fixed at the shared system location below
# (installed centrally, not per-user):
#   /opt/nanodesk/.venv/bin/nanodesk
#
# Env overrides:
#   NANODESK_CONFIG    config file path (default: <effective user's home>/.nanodesk/config.json)
#   NANODESK_PORT      gateway port override (passed as --port)
#   NANODESK_PID_FILE  pid file path (default: <bundle>/run/gateway.pid)
#   NANODESK_LOG_FILE  log file path (default: <bundle>/logs/gateway.log)
#
# A note on ownership — please read if files ever became root-owned:
#   ~/.nanodesk must belong to the account that runs the gateway. That breaks
#   in three ways, all handled here:
#     1. sudo start: the gateway (and everything it rewrites: config.json,
#        sessions, logs) runs as root. A sudo start is now refused unless
#        NANODESK_ALLOW_ROOT=1, and when allowed the gateway is dropped back
#        to the invoking user (sudo -u) with HOME pinned to that user's home.
#     2. setuid launcher / privileged wrapper: the script runs as root but the
#        process was started by a normal user (no SUDO_USER). The launcher's
#        user is recovered from the launch context: getuid() is untouched by
#        the setuid exec bit, so $EUID != $(id -ru) identifies this case. The
#        gateway then runs as that user (via setpriv/su) with HOME pinned.
#     3. wrong HOME: HOME inherited by the gateway no longer decides where
#        config.json lives — the binary resolves ~ from its effective uid — but
#        the script pins HOME anyway so tools and child processes agree.
#   Data directories are created 0700 and the config file 0600, so keys are
#   never readable by other accounts on the box.
#   Already root-owned?  hand the files back as root (see doctor for the list):
#     chown -R <USER> /home/<USER>/.nanodesk
# ============================================================
set -uo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"
NANODESK_BIN="/opt/nanodesk/.venv/bin/nanodesk"

# ---- identity resolution (the ownership-safety core) ----
# EUID is the identity that owns every file the gateway creates. The script
# may run as root for two different reasons:
#   * sudo: SUDO_USER names the human who invoked it;
#   * a setuid launcher / privileged wrapper: no SUDO_USER, but the *real*
#     uid is still the invoking user's (the setuid exec bit only changes the
#     effective uid), so $EUID != $(id -ru) identifies this case.
CURRENT_USER="$(id -un)"
CURRENT_UID="$(id -u)"
REAL_UID="$(id -ru)"
REAL_USER="$(id -run)"

if [[ -n "${SUDO_USER:-}" && "${SUDO_USER}" != "root" ]]; then
  INVOKER_USER="$SUDO_USER"
elif [[ "$CURRENT_UID" -eq 0 && "$REAL_UID" -ne 0 ]]; then
  INVOKER_USER="$REAL_USER"
else
  INVOKER_USER="$CURRENT_USER"
fi

invoker_home() {
  local home
  home="$(getent passwd "$INVOKER_USER" 2>/dev/null | cut -d: -f6 || true)"
  if [[ -z "$home" && "$INVOKER_USER" == "$CURRENT_USER" ]]; then
    home="$HOME"
  fi
  if [[ -z "$home" ]]; then
    # getent is missing on some minimal boxes: fall back to tilde expansion.
    home="$(eval echo "~$INVOKER_USER" 2>/dev/null || true)"
  fi
  [[ -n "$home" ]] || home="$HOME"
  printf '%s' "$home"
}
INVOKER_HOME="$(invoker_home)"

# HOST_HOME is where the gateway will resolve ~/.nanodesk: its effective uid's
# home. It equals the invoking user's home unless the gateway really is root.
if [[ "$INVOKER_USER" != "$CURRENT_USER" ]]; then
  HOST_HOME="$INVOKER_HOME"
else
  HOST_HOME="${HOME:-$INVOKER_HOME}"
fi

if [[ -n "${NANODESK_CONFIG:-}" ]]; then
  CONFIG_FILE="$NANODESK_CONFIG"
else
  CONFIG_FILE="$HOST_HOME/.nanodesk/config.json"
fi
DATA_DIR="$(dirname "$CONFIG_FILE")"
EXAMPLE_FILE="$ROOT/config.json.example"
PID_FILE="${NANODESK_PID_FILE:-$ROOT/run/gateway.pid}"
LOG_FILE="${NANODESK_LOG_FILE:-$ROOT/logs/gateway.log}"

log() { printf '%s\n' "$*"; }
err() { printf '❌ %s\n' "$*" >&2; }

running_as_root() { [[ "$CURRENT_UID" -eq 0 ]]; }
ran_via_sudo() { running_as_root && [[ -n "${SUDO_USER:-}" && "${SUDO_USER}" != "root" ]]; }
# Root only because the shared launcher is setuid/setgid (or a wrapper raised
# the effective id) while a normal account started it.
ran_via_setuid_launcher() {
  running_as_root && [[ -z "${SUDO_USER:-}" && "$REAL_UID" -ne 0 ]]
}
# Any mode where the gateway must not run as the script's own identity.
must_drop_privileges() {
  ran_via_sudo || ran_via_setuid_launcher
}

# Hand newly created files back to the invoking user when the script itself
# runs privileged on their behalf. No-op for normal runs (already the right
# owner) and for true-root runs (root IS the intended owner there).
own_as_invoker() {
  if must_drop_privileges; then
    chown "$INVOKER_USER" "$@" 2>/dev/null || true
  fi
}

file_owner() {
  local f="$1" owner=""
  if command stat --version >/dev/null 2>&1; then
    owner="$(stat -c %U "$f" 2>/dev/null || true)"   # GNU/Linux
  else
    owner="$(stat -f %Su "$f" 2>/dev/null || true)"  # macOS/BSD
  fi
  printf '%s' "$owner"
}

# Numeric mode of a path (e.g. 600), for permission checks.
file_mode() {
  local f="$1" mode=""
  if command stat --version >/dev/null 2>&1; then
    mode="$(stat -c %a "$f" 2>/dev/null || true)"
  else
    mode="$(stat -f %Lp "$f" 2>/dev/null || true)"
  fi
  printf '%s' "$mode"
}

fix_hint() {
  # Print the manual repair for foreign-owned files. There is no fix-perms
  # subcommand: ownership repair needs root anyway, so print the exact chown
  # an operator can run from a root login.
  if running_as_root; then
    err "修复（root 登录后执行，<USER> 换成运行 nanodesk 的账号）:"
    err "  chown -R <USER>: /home/<USER>/.nanodesk"
    err "  chmod 700 /home/<USER>/.nanodesk"
    err "  chmod 600 /home/<USER>/.nanodesk/config.json"
    err "  chown -R <USER>: \"$(dirname "$PID_FILE")\" \"$(dirname "$LOG_FILE")\""
  else
    err "修复（请管理员以 root 登录执行）:"
    err "  chown -R $CURRENT_USER: \"$DATA_DIR\""
    err "  chmod 700 \"$DATA_DIR\" && chmod 600 \"$CONFIG_FILE\""
    err "  chown -R $CURRENT_USER: \"$(dirname "$PID_FILE")\" \"$(dirname "$LOG_FILE")\""
  fi
}

# Refuse to start when the files the gateway will write belong to somebody
# else (usually root leftovers from an earlier sudo run). Starting anyway —
# especially with sudo again — only makes the ownership mess worse.
check_ownership() {
  local expected="$INVOKER_USER" f owner
  # A true root install (root's own instance) is owned by root; that is fine.
  [[ "$INVOKER_USER" == "$CURRENT_USER" ]] && expected="$CURRENT_USER"
  for f in "$@"; do
    [[ -e "$f" ]] || continue
    owner="$(file_owner "$f")"
    if [[ -n "$owner" && "$owner" != "$expected" ]]; then
      err "文件 $f 属主为 ${owner}，应属于 ${expected}。"
      err "这通常是因为之前用 sudo 或特权启动方式运行过 gateway（它以 root 身份重写了它）。"
      err "不要用 sudo 绕过，否则会产生更多 root 所有文件。"
      fix_hint
      return 1
    fi
  done
}

resolve_bin() {
  [[ -x "$NANODESK_BIN" ]] || return 1
  printf '%s' "$NANODESK_BIN"
}

pid_alive() {
  [[ -n "${1:-}" ]] && kill -0 "$1" 2>/dev/null
}

current_pid() {
  [[ -f "$PID_FILE" ]] || return 1
  local pid
  pid="$(tr -d '[:space:]' < "$PID_FILE")"
  [[ "$pid" =~ ^[0-9]+$ ]] || return 1
  printf '%s' "$pid"
}

config_port_hint() {
  [[ -f "$CONFIG_FILE" ]] || return 0
  grep -o '"port"[[:space:]]*:[[:space:]]*[0-9]*' "$CONFIG_FILE" 2>/dev/null \
    | head -1 | grep -o '[0-9]*' || true
}

# Create the instance data directory. It holds config.json (API keys),
# sessions and pairing state, so it must never be group/world readable.
ensure_data_dir() {
  mkdir -p "$(dirname "$CONFIG_FILE")" \
    || { err "无法创建配置目录: $(dirname "$CONFIG_FILE")"; fix_hint; return 1; }
  own_as_invoker "$(dirname "$CONFIG_FILE")"
  # Do not widen an existing directory that the admin already restricted.
  [[ "$(file_mode "$(dirname "$CONFIG_FILE")")" == "700" ]] \
    || chmod 700 "$(dirname "$CONFIG_FILE")" 2>/dev/null || true
}

# First-install bootstrap: copy the example config into place and tell the
# user exactly which keys must be edited before the service can start.
ensure_config() {
  [[ -f "$CONFIG_FILE" ]] && return 0
  [[ -f "$EXAMPLE_FILE" ]] || { err "config template missing: $EXAMPLE_FILE"; return 1; }
  ensure_data_dir || return 1
  cp "$EXAMPLE_FILE" "$CONFIG_FILE" \
    || { err "无法写入配置文件: $CONFIG_FILE"; fix_hint; return 1; }
  chmod 600 "$CONFIG_FILE" 2>/dev/null || true
  own_as_invoker "$CONFIG_FILE"
  if must_drop_privileges; then
    log "ℹ️  已按模板生成配置，属主为 ${INVOKER_USER}（${CONFIG_FILE}）。"
    log "   日常请直接以 $INVOKER_USER 身份运行，不要加 sudo。"
  fi
  cat <<EOF

======================================================
✅ 已按模板生成配置文件:
   $CONFIG_FILE

⚠️  首次启动前请先修改以下关键配置 (vi $CONFIG_FILE):

   1. providers.<供应商>.apiKey   你的 LLM API Key
      (示例: providers.anthropic.apiKey)
   2. agents.defaults.model        默认模型
      agents.defaults.provider     供应商名, 或 auto 自动匹配
   3. gateway.host / gateway.port  网关监听地址和端口
      (内网模板默认 0.0.0.0，可直接被局域网访问，注意网段安全)
   4. channels.websocket.tokenIssueSecret
      WebUI 配对密钥, 请换成一串随机长字符串
   5. teamAssets.instanceId        团队资产实例名 (默认 team-main，可改)

改完后重新执行:  bash service.sh start
======================================================
EOF
  return 1
}

# Build the "run the gateway as $INVOKER_USER" wrapper into DROP_CMD, or leave
# it empty when the current identity already is the right one. HOME is pinned
# so the gateway, its tools and its children all resolve ~ consistently.
DROP_CMD=()
resolve_deescalation() {
  DROP_CMD=()
  if ran_via_sudo; then
    DROP_CMD=(sudo -u "$INVOKER_USER" -H --)
  elif ran_via_setuid_launcher; then
    local group
    group="$(id -gn "$INVOKER_USER" 2>/dev/null || true)"
    if command -v setpriv >/dev/null 2>&1; then
      DROP_CMD=(setpriv --reuid="$INVOKER_USER" --regid="$group" --init-groups)
    elif command -v runuser >/dev/null 2>&1; then
      DROP_CMD=(runuser -u "$INVOKER_USER" --)
    elif command -v su >/dev/null 2>&1; then
      # su -c runs its argument through a shell: keep it a plain exec.
      DROP_CMD=(su -s /bin/sh "$INVOKER_USER" -c "exec \"\$0\" \"\$@\"")
    else
      err "找不到可用的降权工具（setpriv/runuser/su），无法以 ${INVOKER_USER} 身份启动。"
      err "请改用该用户直接运行 service.sh，或安装 util-linux 后重试。"
      return 1
    fi
  fi
  return 0
}

cmd_start() {
  local bin
  bin="$(resolve_bin)" || {
    err "找不到 nanodesk 可执行文件: $NANODESK_BIN"
    err "请先在该公共路径安装 (或确认 /opt/nanodesk 已挂载/部署) 后再启动。"
    return 1
  }
  if must_drop_privileges; then
    log "ℹ️  检测到特权启动（sudo 或 setuid 启动器）：gateway 将以 ${INVOKER_USER} 身份运行 (HOME=${INVOKER_HOME})，文件属主保持为 ${INVOKER_USER}。"
  elif running_as_root; then
    # A plain root start would create root-owned files in /root/.nanodesk and
    # is almost always a mistake; opt in explicitly instead of doing damage.
    if [[ "${NANODESK_ALLOW_ROOT:-0}" != "1" ]]; then
      err "当前以 root 身份直接运行：配置文件会写入 ${CONFIG_FILE} 并属 root 所有。"
      err "普通用户将无法编辑它（也就是“config.json 属 root、无权修改”的来源）。"
      err "请以要使用 nanodesk 的普通用户运行本脚本；确实要以 root 常驻请设置 NANODESK_ALLOW_ROOT=1。"
      return 1
    fi
    log "⚠️  NANODESK_ALLOW_ROOT=1：以 root 常驻，生成的文件属 root 所有 (${CONFIG_FILE})。"
  fi
  ensure_config || return 1
  check_ownership "$CONFIG_FILE" "$PID_FILE" "$LOG_FILE" || return 1

  local pid
  if pid="$(current_pid)" && pid_alive "$pid"; then
    log "✅ gateway 已在运行 (pid $pid)"
    return 0
  fi
  # Drop a stale pid file left by a crash / kill -9.
  [[ -f "$PID_FILE" ]] && rm -f "$PID_FILE"

  mkdir -p "$(dirname "$PID_FILE")" "$(dirname "$LOG_FILE")" \
    || {
      err "无法创建运行目录: $(dirname "$PID_FILE")（离线包解压到了只读/无权目录？）"
      err "可将离线包解到可写目录，或用 NANODESK_PID_FILE / NANODESK_LOG_FILE 指定可写路径。"
      return 1
    }
  own_as_invoker "$(dirname "$PID_FILE")" "$(dirname "$LOG_FILE")"
  touch "$LOG_FILE" || { err "无法写入日志文件: $LOG_FILE"; fix_hint; return 1; }
  own_as_invoker "$LOG_FILE"

  local args=(gateway --config "$CONFIG_FILE")
  [[ -n "${NANODESK_PORT:-}" ]] && args+=(--port "$NANODESK_PORT")

  # Background mode: nohup + & keeps the gateway alive after logout. When the
  # script itself runs privileged, de-escalate FIRST so nothing the gateway
  # writes is created as root.
  resolve_deescalation || return 1
  local -a cmd=("${DROP_CMD[@]}")
  if [[ ${#DROP_CMD[@]} -gt 0 ]]; then
    cmd+=(env HOME="$INVOKER_HOME" USER="$INVOKER_USER" LOGNAME="$INVOKER_USER")
  fi
  cmd+=("$bin" "${args[@]}")

  nohup "${cmd[@]}" >>"$LOG_FILE" 2>&1 &
  local newpid=$!
  disown "$newpid" 2>/dev/null || true
  echo "$newpid" > "$PID_FILE" \
    || { err "无法写入 pid 文件: $PID_FILE"; fix_hint; return 1; }
  own_as_invoker "$PID_FILE"
  sleep 1
  if pid_alive "$newpid"; then
    local port
    port="${NANODESK_PORT:-$(config_port_hint)}"
    log "✅ gateway 已在后台启动 (pid $newpid)${port:+，端口 $port}"
    log "   二进制: $bin"
    log "   配置:   $CONFIG_FILE"
    log "   日志:   bash service.sh logs"
    return 0
  fi
  rm -f "$PID_FILE"
  err "gateway 启动后立即退出, 请查看日志: $LOG_FILE (tail -50 见下)"
  tail -50 "$LOG_FILE" 2>/dev/null || true
  return 1
}

cmd_stop() {
  # NOTE: stop only ever touches the pid file — it never reads or rewrites
  # the config file, so stopping cannot change config ownership.
  local pid
  if ! pid="$(current_pid)"; then
    [[ -f "$PID_FILE" ]] && rm -f "$PID_FILE" 2>/dev/null || true
    log "⚪ gateway 未运行"
    return 0
  fi
  if ! pid_alive "$pid"; then
    rm -f "$PID_FILE" 2>/dev/null || true
    log "⚪ gateway 未运行 (已清理残留 pid 文件)"
    return 0
  fi
  if ! kill "$pid" 2>/dev/null; then
    err "无权停止 pid ${pid}（它可能以 root 身份运行，而当前用户是 ${CURRENT_USER}）。"
    err "若该 gateway 是之前以 root/sudo 启动的，请先用 root 停掉："
    err "  kill \$(cat \"$(dirname "$PID_FILE")/gateway.pid\")"
    err "随后按上方 fix_hint 给出的 chown 命令交还文件属主。"
    return 1
  fi
  local waited=0
  while pid_alive "$pid" && [[ "$waited" -lt 10 ]]; do
    sleep 1
    waited=$((waited + 1))
  done
  if pid_alive "$pid"; then
    kill -9 "$pid" 2>/dev/null || true
    sleep 1
  fi
  if ! rm -f "$PID_FILE" 2>/dev/null; then
    err "gateway 已停，但无法删除 pid 文件 ${PID_FILE}（权限不足）。"
    fix_hint
    return 1
  fi
  pid_alive "$pid" && { err "无法停止 gateway (pid $pid)"; return 1; }
  log "✅ gateway 已停止"
  return 0
}

cmd_status() {
  local pid
  if pid="$(current_pid)" && pid_alive "$pid"; then
    local port bin
    port="${NANODESK_PORT:-$(config_port_hint)}"
    bin="$(resolve_bin 2>/dev/null)" || bin="?"
    log "✅ gateway 运行中 (pid $pid)${port:+，端口 $port}"
    log "   二进制: $bin"
    log "   配置: $CONFIG_FILE"
    log "   日志: $LOG_FILE"
    return 0
  fi
  [[ -f "$PID_FILE" ]] && rm -f "$PID_FILE" 2>/dev/null || true
  log "⚪ gateway 未运行"
  return 1
}

cmd_logs() {
  [[ -f "$LOG_FILE" ]] || { err "暂无日志: $LOG_FILE (服务可能从未启动)"; return 1; }
  if [[ ! -r "$LOG_FILE" ]]; then
    err "无权读取 $LOG_FILE (属主为 $(file_owner "$LOG_FILE"))。"
    fix_hint
    return 1
  fi
  if [[ "${1:-}" == "-n" && -n "${2:-}" ]]; then
    tail -n "$2" -f "$LOG_FILE"
  elif [[ $# -gt 0 ]]; then
    tail "$@" "$LOG_FILE"
  else
    tail -n 200 -f "$LOG_FILE"
  fi
}

# Report every ownership/identity problem that would make the gateway write
# files the operator cannot edit afterwards. Read-only; safe to run anytime.
cmd_doctor() {
  local problems=0
  log "=== nanodesk doctor ==="
  log "脚本身份:   $(id -un) (euid=${CURRENT_UID}, ruid=${REAL_UID})"
  log "目标属主:   ${INVOKER_USER} (home=${INVOKER_HOME})"
  log "配置目录:   ${DATA_DIR}"
  log "配置文件:   ${CONFIG_FILE}"
  log "二进制:     ${NANODESK_BIN}$( [[ -x "$NANODESK_BIN" ]] || printf ' (不存在或不可执行)')"
  if must_drop_privileges; then
    if ran_via_sudo; then
      log "特权来源:   sudo (SUDO_USER=${SUDO_USER})"
    else
      log "特权来源:   setuid/特权启动器 (ruid=${REAL_UID}, euid=${CURRENT_UID})"
    fi
    log "启动方式:   将以 ${INVOKER_USER} 身份启动 gateway，属主不会被改写"
  elif running_as_root; then
    log "特权来源:   以 root 直接运行"
    log "启动方式:   ${NANODESK_ALLOW_ROOT:-0} == 1 才允许，否则 start 会拒绝"
  else
    log "特权来源:   无（普通用户）"
  fi

  local f owner
  if [[ -e "$DATA_DIR" ]]; then
    owner="$(file_owner "$DATA_DIR")"
    if [[ -n "$owner" && "$owner" != "$INVOKER_USER" ]]; then
      err "$DATA_DIR 属主为 ${owner}，应为 ${INVOKER_USER}。"
      problems=$((problems + 1))
    else
      log "✔ ${DATA_DIR} 属主正常 (${owner:-?}, mode $(file_mode "$DATA_DIR"))"
    fi
    for f in "$CONFIG_FILE" "$DATA_DIR/pairing.json"; do
      [[ -e "$f" ]] || continue
      owner="$(file_owner "$f")"
      if [[ -n "$owner" && "$owner" != "$INVOKER_USER" ]]; then
        err "$f 属主为 ${owner}，应为 ${INVOKER_USER}。"
        problems=$((problems + 1))
      fi
    done
    # Root-owned leftovers anywhere below the data dir (sessions, media, ...).
    local strays
    strays="$(find "$DATA_DIR" \! -user "$INVOKER_USER" 2>/dev/null | head -20 || true)"
    if [[ -n "$strays" ]]; then
      err "以下文件不属于 ${INVOKER_USER}（最多列出 20 个）:"
      printf '   %s\n' $strays >&2
      problems=$((problems + 1))
    fi
    if [[ -e "$CONFIG_FILE" ]]; then
      local mode
      mode="$(file_mode "$CONFIG_FILE")"
      if [[ -n "$mode" && "$mode" != "600" && "$mode" != "400" ]]; then
        err "$CONFIG_FILE 权限为 ${mode}，含 API Key，应为 600。"
        problems=$((problems + 1))
      fi
    fi
  else
    log "ℹ️  ${DATA_DIR} 尚不存在（首次 start 会创建，属主 ${INVOKER_USER}, mode 700）"
  fi

  if [[ -n "$(command -v getcap 2>/dev/null)" ]] && [[ -e "$NANODESK_BIN" ]]; then
    local caps
    caps="$(getcap "$NANODESK_BIN" 2>/dev/null || true)"
    [[ -z "$caps" ]] || log "ℹ️  二进制带有 capabilities: $caps（会以特权写文件，请确认属主）"
  fi
  if [[ -x "$NANODESK_BIN" ]] && command -v stat >/dev/null 2>&1; then
    local setuid_bit
    setuid_bit="$(file_mode "$NANODESK_BIN")"
    if [[ -n "$setuid_bit" && "$setuid_bit" =~ ^[46][0-7]{3}$ ]]; then
      log "ℹ️  二进制带 setuid/setgid 位 (mode ${setuid_bit})：gateway 将按 euid 写文件，"
      log "   本脚本会自动降权到 ${INVOKER_USER}；直接用二进制启动则需要 setpriv/sudo -u。"
    fi
  fi

  local pid
  if pid="$(current_pid)" && pid_alive "$pid"; then
    local powner
    powner="$(ps -o user= -p "$pid" 2>/dev/null | tr -d '[:space:]' || true)"
    log "运行状态:   pid ${pid}，属主 ${powner:-?}$( [[ -n "$powner" && "$powner" != "$INVOKER_USER" ]] && printf ' ⚠️  与目标属主不一致')"
  else
    log "运行状态:   未运行"
  fi

  if [[ "$problems" -eq 0 ]]; then
    log "✅ 未发现属主/权限问题"
    return 0
  fi
  fix_hint
  return 1
}

usage() {
  cat <<EOF
用法: bash service.sh {start|stop|restart|status|logs|doctor}

  start            后台启动 gateway (首次自动按 config.json.example 生成配置)
  stop             停止后台 gateway (只动 pid 文件，不碰配置文件)
  restart          重启 (stop + start)
  status           查看运行状态 (运行中 exit 0, 未运行 exit 1)
  logs [-n LINES]  跟随查看 gateway 日志 (默认最后 200 行)
  doctor           检查属主/权限/启动身份（只读，不修改任何文件）

环境变量:
  NANODESK_CONFIG     配置文件路径 (默认 <属主 home>/.nanodesk/config.json)
  NANODESK_PORT       端口覆盖 (透传 --port)
  NANODESK_PID_FILE / NANODESK_LOG_FILE
                      pid/日志路径 (默认在离线包 run/ logs/ 下)
  NANODESK_ALLOW_ROOT 设为 1 才允许 root 直接常驻（默认拒绝）

日常不要加 sudo 运行。文件属主已错乱时，root 登录后按 doctor/报错提示
执行 chown -R <USER> 交还属主即可。
可执行文件固定为: /opt/nanodesk/.venv/bin/nanodesk
EOF
  exit 2
}

case "${1:-}" in
  start) shift; cmd_start "$@" ;;
  stop) shift; cmd_stop "$@" ;;
  restart) shift; cmd_stop "$@" && cmd_start "$@" ;;
  status) shift; cmd_status "$@" ;;
  logs) shift; cmd_logs "$@" ;;
  doctor) shift; cmd_doctor "$@" ;;
  *) usage ;;
esac
