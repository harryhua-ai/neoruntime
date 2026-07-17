#!/bin/bash
# Seccomp Profile 验证脚本
# 用于验证 seccomp profile 是否正确加载和应用

set -e

PROFILE_PATH="${1:-configs/security/seccomp-default.json}"
CONTAINER_ID="${2:-}"

echo "=== Seccomp Profile 验证 ==="
echo ""

# 1. 验证文件存在
echo "1. 检查 seccomp profile 文件..."
if [ ! -f "$PROFILE_PATH" ]; then
    echo "   ❌ 错误: seccomp profile 文件不存在: $PROFILE_PATH"
    exit 1
fi
echo "   ✅ 文件存在: $PROFILE_PATH"

# 2. 验证 JSON 格式
echo ""
echo "2. 验证 JSON 格式..."
if ! python3 -m json.tool "$PROFILE_PATH" > /dev/null 2>&1; then
    echo "   ❌ 错误: JSON 格式无效"
    exit 1
fi
echo "   ✅ JSON 格式有效"

# 3. 验证必需字段
echo ""
echo "3. 验证必需字段..."
if ! grep -q '"defaultAction"' "$PROFILE_PATH"; then
    echo "   ❌ 错误: 缺少 defaultAction 字段"
    exit 1
fi
if ! grep -q '"syscalls"' "$PROFILE_PATH"; then
    echo "   ❌ 错误: 缺少 syscalls 字段"
    exit 1
fi
echo "   ✅ 必需字段存在"

# 4. 检查架构支持
echo ""
echo "4. 检查架构支持..."
ARCH=$(uname -m)
case "$ARCH" in
    x86_64)
        ARCH_NAME="SCMP_ARCH_X86_64"
        ;;
    aarch64|arm64)
        ARCH_NAME="SCMP_ARCH_AARCH64"
        ;;
    armv7l|armv6l)
        ARCH_NAME="SCMP_ARCH_ARM"
        ;;
    *)
        echo "   ⚠️  警告: 未知架构 $ARCH，跳过架构检查"
        ARCH_NAME=""
        ;;
esac

if [ -n "$ARCH_NAME" ]; then
    if grep -q "$ARCH_NAME" "$PROFILE_PATH"; then
        echo "   ✅ 支持当前架构: $ARCH ($ARCH_NAME)"
    else
        echo "   ⚠️  警告: profile 可能不支持当前架构 $ARCH"
    fi
fi

# 5. 验证容器中的 seccomp（如果提供了容器 ID）
if [ -n "$CONTAINER_ID" ]; then
    echo ""
    echo "5. 验证容器中的 seccomp 状态..."
    
    # 检查容器是否存在
    if ! crictl inspect "$CONTAINER_ID" > /dev/null 2>&1; then
        echo "   ⚠️  警告: 无法检查容器 $CONTAINER_ID（可能使用 containerd 而非 crictl）"
    else
        # 尝试从容器进程检查 seccomp
        PID=$(crictl inspect "$CONTAINER_ID" | grep -o '"pid":[0-9]*' | head -1 | cut -d: -f2)
        if [ -n "$PID" ]; then
            SECCOMP_STATUS=$(cat "/proc/$PID/status" | grep "^Seccomp:" | awk '{print $2}' 2>/dev/null || echo "unknown")
            if [ "$SECCOMP_STATUS" = "2" ]; then
                echo "   ✅ Seccomp 已启用 (filter mode)"
            elif [ "$SECCOMP_STATUS" = "1" ]; then
                echo "   ⚠️  Seccomp 处于严格模式（非 filter）"
            else
                echo "   ⚠️  Seccomp 状态: $SECCOMP_STATUS"
            fi
        fi
    fi
fi

# 6. 显示 profile 摘要
echo ""
echo "6. Profile 摘要:"
DEFAULT_ACTION=$(grep -o '"defaultAction"[[:space:]]*:[[:space:]]*"[^"]*"' "$PROFILE_PATH" | cut -d'"' -f4)
SYSCALL_COUNT=$(grep -c '"names"' "$PROFILE_PATH" || echo "0")
echo "   默认动作: $DEFAULT_ACTION"
echo "   允许的系统调用数量: $SYSCALL_COUNT"

echo ""
echo "=== 验证完成 ==="
echo ""
echo "使用方法:"
echo "  $0 [profile_path] [container_id]"
echo ""
echo "示例:"
echo "  $0 /opt/aipc/etc/seccomp-default.json"
echo "  $0 /opt/aipc/etc/seccomp-default.json aipc-hello-app"
