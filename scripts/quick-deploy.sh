#!/bin/bash
# 快速部署脚本 - 自动检测架构并部署

set -e

TARGET_HOST="${1:-}"
TARGET_USER="${2:-root}"
TARGET_PREFIX="${INSTALL_PREFIX:-/data/aipc}"

if [ -z "$TARGET_HOST" ]; then
    echo "Usage: $0 <target-host> [username]"
    echo "Example: $0 192.168.1.100 root"
    exit 1
fi

echo "=== 快速部署到 $TARGET_USER@$TARGET_HOST ==="

# 1. 检测目标架构
echo "[1/5] 检测目标平台架构..."
TARGET_ARCH=$(ssh "$TARGET_USER@$TARGET_HOST" "uname -m" 2>/dev/null || echo "unknown")
echo "目标架构: $TARGET_ARCH"

# 2. 检查本地构建产物架构
LOCAL_ARCH=$(file build/output/ai-runtime 2>/dev/null | grep -oE "(x86-64|aarch64|ARM)" | head -1 || echo "unknown")
echo "本地构建架构: $LOCAL_ARCH"

# 3. 如果架构不匹配，提示交叉编译
if [ "$TARGET_ARCH" != "$LOCAL_ARCH" ] && [ "$TARGET_ARCH" != "unknown" ]; then
    echo "⚠️  架构不匹配！需要交叉编译"
    echo "执行以下命令后重新运行此脚本："
    echo ""
    echo "  export GOOS=linux"
    case $TARGET_ARCH in
        aarch64|arm64)
            echo "  export GOARCH=arm64"
            ;;
        armv7l|armv6l)
            echo "  export GOARCH=arm"
            echo "  export GOARM=7"
            ;;
        x86_64|amd64)
            echo "  export GOARCH=amd64"
            ;;
    esac
    echo "  make clean && make platform"
    echo ""
    read -p "是否继续部署（可能失败）? [y/N] " -n 1 -r
    echo
    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
        exit 1
    fi
fi

# 4. 创建目标目录
echo "[2/5] 创建目标目录..."
ssh "$TARGET_USER@$TARGET_HOST" "mkdir -p $TARGET_PREFIX/{bin,lib/hal,etc,logs,data,models}"
ssh "$TARGET_USER@$TARGET_HOST" "mkdir -p /run/aipc/{shm,sockets}"

# 5. 部署二进制文件
echo "[3/5] 部署二进制文件..."
for bin in ai-runtime app-manager device-control event-bus platform-api; do
    if [ -f "build/output/$bin" ]; then
        scp "build/output/$bin" "$TARGET_USER@$TARGET_HOST:$TARGET_PREFIX/bin/" >/dev/null
        echo "  ✓ $bin"
    fi
done

# 部署 HAL 库
if [ -d "build/output/hal" ]; then
    ssh "$TARGET_USER@$TARGET_HOST" "mkdir -p $TARGET_PREFIX/lib/hal"
    scp build/output/hal/*.so "$TARGET_USER@$TARGET_HOST:$TARGET_PREFIX/lib/hal/" 2>/dev/null || true
    echo "  ✓ HAL libraries"
fi

# 6. 设置权限
echo "[4/5] 设置权限..."
ssh "$TARGET_USER@$TARGET_HOST" "chmod +x $TARGET_PREFIX/bin/*"

# 7. 部署配置文件
echo "[5/5] 部署配置文件..."
scp -r configs/* "$TARGET_USER@$TARGET_HOST:$TARGET_PREFIX/etc/" >/dev/null 2>&1 || true

echo ""
echo "✅ 部署完成！"
echo ""
echo "下一步："
echo "  1. SSH 到目标: ssh $TARGET_USER@$TARGET_HOST"
echo "  2. 测试服务: $TARGET_PREFIX/bin/ai-runtime -config $TARGET_PREFIX/etc/ai/ai-runtime.yaml"
echo "  3. 查看日志: tail -f $TARGET_PREFIX/logs/*.log"
