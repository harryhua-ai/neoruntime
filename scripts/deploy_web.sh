#!/bin/bash
#
# AIPC Web Console 部署脚本
# 用于将前端构建产物部署到目标设备
#

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
DEPLOY_PATH="${INSTALL_PREFIX:-/data/aipc}/web"

# 颜色输出
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

log_info() { echo -e "${GREEN}[INFO]${NC} $1"; }
log_warn() { echo -e "${YELLOW}[WARN]${NC} $1"; }
log_error() { echo -e "${RED}[ERROR]${NC} $1"; }

# Prefer new web/ frontend over legacy web/console
if [[ -d "$PROJECT_ROOT/web/src" ]]; then
    WEB_SRC="$PROJECT_ROOT/web"
    WEB_DIST="$WEB_SRC/dist"
    log_info "Using new web frontend (web/)"
else
    WEB_SRC="$PROJECT_ROOT/web/console"
    WEB_DIST="$WEB_SRC/dist"
    log_info "Using legacy web console (web/console)"
fi

usage() {
    echo "Usage: $0 [OPTIONS]"
    echo ""
    echo "Options:"
    echo "  -t, --target HOST    部署到远程主机 (user@host)"
    echo "  -p, --path PATH      部署路径 (默认: $DEPLOY_PATH)"
    echo "  -b, --build          部署前重新构建"
    echo "  -l, --local          本地部署 (默认)"
    echo "  -h, --help           显示帮助"
    echo ""
    echo "Environment:"
    echo "  SSHPASS              SSH 密码 (配合 sshpass 使用)"
    echo ""
    echo "Examples:"
    echo "  $0 -b -l                           # 本地构建并部署"
    echo "  $0 -t root@192.168.1.100           # 部署到远程设备 (使用 SSH 密钥)"
    echo "  SSHPASS='password' $0 -b -t root@device  # 使用密码部署"
}

build_web() {
    log_info "构建前端..."
    cd "$WEB_SRC"

    # Check for pnpm first (new web/ uses pnpm)
    if command -v pnpm &> /dev/null; then
        if [ ! -d "node_modules" ]; then
            log_info "安装依赖 (pnpm)..."
            pnpm install
        fi
        pnpm run build
    else
        if [ ! -d "node_modules" ]; then
            log_info "安装依赖 (npm)..."
            npm install
        fi
        npm run build
    fi
    log_info "构建完成: $WEB_DIST"
}

deploy_local() {
    log_info "本地部署到 $DEPLOY_PATH"

    if [ ! -d "$WEB_DIST" ]; then
        log_error "构建目录不存在: $WEB_DIST"
        log_error "请先运行 -b 选项构建"
        exit 1
    fi

    mkdir -p "$DEPLOY_PATH"
    rm -rf "$DEPLOY_PATH"/*
    cp -r "$WEB_DIST"/* "$DEPLOY_PATH/"

    log_info "部署完成"
    log_info "文件列表:"
    ls -la "$DEPLOY_PATH"
}

deploy_remote() {
    local target=$1
    log_info "部署到远程主机: $target"

    if [ ! -d "$WEB_DIST" ]; then
        log_error "构建目录不存在: $WEB_DIST"
        log_error "请先运行 -b 选项构建"
        exit 1
    fi

    # 支持 sshpass 或 SSH 密钥认证
    # 优先使用 SSHPASS 环境变量，否则尝试使用默认密码 'root'
    local ssh_opts="-o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null"
    local use_sshpass=false

    if [ -n "$SSHPASS" ]; then
        use_sshpass=true
    elif command -v sshpass &> /dev/null; then
        # 检查是否是已知的本地设备（需要密码认证）
        if [[ "$target" == *"192.168."* ]] || [[ "$target" == *"@localhost"* ]] || [[ "$target" == *"@127."* ]]; then
            # 尝试默认密码 'root'
            export SSHPASS="${SSHPASS:-root}"
            use_sshpass=true
            log_info "使用默认密码认证"
        fi
    fi

    if [ "$use_sshpass" = true ]; then
        # 使用 sshpass 进行密码认证
        sshpass -e ssh $ssh_opts "$target" "mkdir -p $DEPLOY_PATH"
        sshpass -e ssh $ssh_opts "$target" "rm -rf $DEPLOY_PATH/*"
        sshpass -e scp $ssh_opts -r "$WEB_DIST"/* "$target:$DEPLOY_PATH/"
    else
        # 使用 SSH 密钥认证
        ssh $ssh_opts "$target" "mkdir -p $DEPLOY_PATH"
        ssh $ssh_opts "$target" "rm -rf $DEPLOY_PATH/*"
        scp $ssh_opts -r "$WEB_DIST"/* "$target:$DEPLOY_PATH/"
    fi

    log_info "部署完成"
    log_info "远程文件列表:"
    if [ "$use_sshpass" = true ]; then
        sshpass -e ssh $ssh_opts "$target" "ls -la $DEPLOY_PATH"
    else
        ssh $ssh_opts "$target" "ls -la $DEPLOY_PATH"
    fi
}

# 解析参数
BUILD=false
LOCAL=true
TARGET=""

while [[ $# -gt 0 ]]; do
    case $1 in
        -t|--target)
            TARGET="$2"
            LOCAL=false
            shift 2
            ;;
        -p|--path)
            DEPLOY_PATH="$2"
            shift 2
            ;;
        -b|--build)
            BUILD=true
            shift
            ;;
        -l|--local)
            LOCAL=true
            shift
            ;;
        -h|--help)
            usage
            exit 0
            ;;
        *)
            log_error "未知选项: $1"
            usage
            exit 1
            ;;
    esac
done

# 执行
if [ "$BUILD" = true ]; then
    build_web
fi

if [ "$LOCAL" = true ]; then
    deploy_local
else
    if [ -z "$TARGET" ]; then
        log_error "远程部署需要指定目标主机 (-t)"
        exit 1
    fi
    deploy_remote "$TARGET"
fi

log_info "========================================="
log_info "部署成功!"
log_info "访问地址: http://<device-ip>:8080/"
log_info "========================================="
