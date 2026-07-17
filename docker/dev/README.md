# NE503 Docker 开发环境

独立 Docker 编译环境，内置完整工具链和 Hailo SDK。容器常驻运行，数据通过 volume 持久化。

## 快速开始

```bash
# 启动常驻开发容器（源码在容器内克隆，volume 持久化）
make docker-dev
make docker-dev-shell

# 容器内：
git clone <repo-url> ~/ne503 && cd ~/ne503
make pack-release VERSION=1.0.0
```

无需关心 SDK 路径，所有编译工具和交叉编译工具链已内置。

## 使用方式

### 方式一：容器内克隆（推荐）

```bash
make docker-dev          # 启动常驻容器
make docker-dev-shell    # 进入容器
# 容器内：
git clone <repo-url> ~/ne503 && cd ~/ne503
make pack-release VERSION=1.0.0
```

退出后容器继续运行，数据通过 `ne503-workspace` volume 持久化。再次进入：

```bash
make docker-dev-shell
```

### 方式二：挂载宿主机源码

```bash
make docker-dev-mount              # 启动容器（挂载宿主机源码）
docker exec -it ne503-dev-mount bash
```

### 停止容器

```bash
make docker-dev-stop
```

## 编译命令

```bash
make env-check          # 验证工具链（可选）
make layer1             # proto + Go 服务 + Web + Python SDK
make layer2             # + HAL + camera-daemon + 工具
make pack-release VERSION=1.0.0  # 完整 ARM 交叉编译 + 打包固件
make pack-release VERSION=1.0.0 BUILD_MCU_FW=1  # 先构建/同步 MCU 固件再打包
make docker-pack-release VERSION=1.0.0  # 使用 zerobot/ne503-dev-env-full:4.0.23 自动打包
```

`make pack-release` 会自动使用内置的 Hailo SDK 进行交叉编译并打包为 `.tar.gz`。

GitHub Actions 的发布 workflow 默认使用 self-hosted Docker runner 运行
`make docker-pack-release`。runner 需要有 `self-hosted`, `linux`, `x64`,
`docker` 标签，并能拉取 `zerobot/ne503-dev-env-full:4.0.23`。

## 镜像构建（管理员）

```bash
# 含 SDK（完整编译）
docker/dev/build.sh /opt/poky/4.0.23

# 含 SDK + 自定义镜像名
docker/dev/build.sh /opt/poky/4.0.23 your-org/ne503-dev-env:v1.0

# 不含 SDK
docker/dev/build.sh

# 推送到 Docker Hub
docker push your-org/ne503-dev-env:latest
```

## 故障排查

```bash
# Go 模块下载慢
export GOPROXY=https://goproxy.cn,direct

# pnpm install 慢
pnpm config set registry https://registry.npmmirror.com
```
