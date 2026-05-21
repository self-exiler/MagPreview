#!/bin/bash
set -euo pipefail

APP_DIR="/opt/magpreview"
REPO_URL="https://github.com/self-exiler/MagPreview.git"
SERVICE_NAME="magpreview"
CONFIG_PATH="$APP_DIR/server/config.json"
INSTALL_USER="${SUDO_USER:-$(whoami)}"

info()  { echo "[MagPreview] $*"; }
error() { echo "[MagPreview] 错误: $*" >&2; }

function check_node() {
  for cmd in node nodejs; do
    if command -v "$cmd" &>/dev/null; then
      echo "$cmd"
      return 0
    fi
  done
  error "未找到 Node.js，请先安装 Node.js >= 18"
  exit 1
}

NODE_CMD=$(check_node)

function install() {
  info "开始安装..."

  apt-get update -qq
  apt-get install -y -qq git nodejs npm

  if [ -d "$APP_DIR" ]; then
    info "目录 $APP_DIR 已存在，跳过克隆"
    chown -R "$INSTALL_USER":"$INSTALL_USER" "$APP_DIR" 2>/dev/null || true
  else
    mkdir -p "$(dirname "$APP_DIR")"
    git clone "$REPO_URL" "$APP_DIR"
    chown -R "$INSTALL_USER":"$INSTALL_USER" "$APP_DIR"
  fi

  cd "$APP_DIR"
  sudo -u "$INSTALL_USER" npm install

  cp "$APP_DIR/script/magpreview.sh" /usr/local/bin/magpreview
  chmod +x /usr/local/bin/magpreview

  set_port
  create_service
  info "安装完成。"
  info "启动服务: sudo magpreview start"
  info "访问地址: http://<服务器IP>:${PORT:-3000}"
}

function set_port() {
  local PORT
  read -p "请输入服务端口（默认3000）: " PORT
  PORT="${PORT:-3000}"
  cat > "$CONFIG_PATH" <<EOF
{
  "port": $PORT
}
EOF
  info "端口已设置为 $PORT"
}

function create_service() {
  cat > /etc/systemd/system/$SERVICE_NAME.service <<EOF
[Unit]
Description=MagPreview Service
After=network.target

[Service]
Type=simple
WorkingDirectory=$APP_DIR
ExecStart=$NODE_CMD $APP_DIR/server/index.js
Restart=always
RestartSec=5
User=$INSTALL_USER
Environment=NODE_ENV=production

[Install]
WantedBy=multi-user.target
EOF
  systemctl daemon-reload
}

function start() {
  if [ ! -f "$CONFIG_PATH" ]; then
    info "未检测到配置文件，请先配置端口"
    set_port
  fi
  create_service
  systemctl enable --now $SERVICE_NAME
  local PORT
  PORT=$(grep -oP '"port"\s*:\s*\K\d+' "$CONFIG_PATH" 2>/dev/null || echo 3000)
  info "服务已启动。"
  info "访问地址: http://<服务器IP>:$PORT"
}

function stop() {
  systemctl stop $SERVICE_NAME 2>/dev/null || true
  info "服务已停止。"
}

function status() {
  systemctl status $SERVICE_NAME
}

function uninstall() {
  stop
  systemctl disable $SERVICE_NAME 2>/dev/null || true
  rm -f /etc/systemd/system/$SERVICE_NAME.service
  rm -rf "$APP_DIR"
  rm -f /usr/local/bin/magpreview
  systemctl daemon-reload
  info "已卸载。"
}

function update() {
  if [ ! -d "$APP_DIR/.git" ]; then
    error "目录 $APP_DIR 不是 git 仓库，请重新安装"
    exit 1
  fi

  systemctl stop $SERVICE_NAME 2>/dev/null || true

  cd "$APP_DIR"
  sudo -u "$INSTALL_USER" git pull
  sudo -u "$INSTALL_USER" npm install

  # 保留现有端口配置
  if [ ! -f "$CONFIG_PATH" ]; then
    set_port
  fi

  create_service
  systemctl start $SERVICE_NAME
  info "已更新并重启。"
}

function logs() {
  journalctl -u $SERVICE_NAME -n 50 -f
}

function menu() {
  while true; do
    echo ""
    echo "========= MagPreview 管理 ========="
    echo "1. 安装"
    echo "2. 启动"
    echo "3. 停止"
    echo "4. 状态"
    echo "5. 卸载"
    echo "6. 更新"
    echo "7. 设置端口"
    echo "8. 查看日志"
    echo "0. 退出"
    read -p "请选择操作: " choice
    case $choice in
      1) install ;;
      2) start ;;
      3) stop ;;
      4) status ;;
      5) uninstall ;;
      6) update ;;
      7) set_port ;;
      8) logs ;;
      0) exit 0 ;;
      *) error "无效选项，请重新输入。" ;;
    esac
  done
}

menu
