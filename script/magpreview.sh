#!/bin/bash
# MagPreview 管理脚本
# 用于 Ubuntu 系统的安装、运行、卸载、更新


APP_DIR="/opt/magpreview"
REPO_URL="https://github.com/self-exiler/MagPreview.git"
SERVICE_NAME="magpreview"
NODE_CMD="node"
CONFIG_PATH="$APP_DIR/server/config.json"

function install() {
  echo "[MagPreview] 开始安装..."
  sudo apt update
  sudo apt install -y git nodejs npm
  sudo mkdir -p "$APP_DIR"
  sudo git clone "$REPO_URL" "$APP_DIR"
  cd "$APP_DIR"
  sudo npm install
  sudo cp "$APP_DIR/script/magpreview.sh" /usr/local/bin/magpreview
  sudo chmod +x /usr/local/bin/magpreview
  set_port
  create_service
  echo "[MagPreview] 安装完成。"
}

function set_port() {
  read -p "请输入服务端口（默认3000）: " PORT
  if [[ -z "$PORT" ]]; then PORT=3000; fi
  sudo mkdir -p "$(dirname $CONFIG_PATH)"
  echo -e "{\n  \"port\": $PORT\n}" | sudo tee "$CONFIG_PATH" > /dev/null
  echo "[MagPreview] 端口已设置为 $PORT (可后续修改 $CONFIG_PATH)"
}
function create_service() {
  sudo bash -c "cat > /etc/systemd/system/$SERVICE_NAME.service" <<EOF
[Unit]
Description=MagPreview Service
After=network.target

[Service]
Type=simple
WorkingDirectory=$APP_DIR
ExecStart=$NODE_CMD server/index.js
Restart=always
User=$(whoami)
Environment=NODE_ENV=production

[Install]
WantedBy=multi-user.target
EOF
}

function start() {
  if [ ! -f "$CONFIG_PATH" ]; then
    set_port
  fi
  sudo systemctl daemon-reload
  sudo systemctl start $SERVICE_NAME
  sudo systemctl enable $SERVICE_NAME
  echo "[MagPreview] 服务已启动。"
}

function stop() {
  sudo systemctl stop $SERVICE_NAME
  echo "[MagPreview] 服务已停止。"
}

function status() {
  sudo systemctl status $SERVICE_NAME
}

function uninstall() {
  stop
  sudo systemctl disable $SERVICE_NAME
  sudo rm -f /etc/systemd/system/$SERVICE_NAME.service
  sudo rm -rf "$APP_DIR"
  sudo rm -f /usr/local/bin/magpreview
  sudo systemctl daemon-reload
  echo "[MagPreview] 已卸载。"
}

function update() {
  stop
  cd "$APP_DIR"
  sudo git pull
  sudo npm install
  set_port
  start
  echo "[MagPreview] 已更新并重启。"
}


# 交互式菜单
function menu() {
  while true; do
    echo "\n========= MagPreview 管理 ========="
    echo "1. 安装"
    echo "2. 启动"
    echo "3. 停止"
    echo "4. 状态"
    echo "5. 卸载"
    echo "6. 更新"
    echo "7. 设置端口"
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
      0) exit 0 ;;
      *) echo "无效选项，请重新输入。" ;;
    esac
  done
}

menu
