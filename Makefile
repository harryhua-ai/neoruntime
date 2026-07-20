# NE503 AIPC platform Makefile

.PHONY: all clean distclean test test-unit test-integration proto \
  proto-inference proto-device proto-event proto-camera proto-app proto-lens proto-discovery \
  hal-v2 platform ai-runtime device-control event-bus app-manager platform-api \
  device-discovery os-updater camera-daemon web aipc-cli tools mcu-firmware pack pack-release \
  docker-pack-release _pack-stage _pack-internal fmt lint help

-include Makefile.local

BUILD_DIR ?= build/output
VERSION ?= $(shell git describe --tags --always --dirty 2>/dev/null || date +%Y%m%d-%H%M%S)
RELEASE_DIR ?= build/release
PKG_NAME = aipc-$(HAL_PLATFORM)-$(VERSION)
STAGE_DIR = $(RELEASE_DIR)/$(PKG_NAME)
TARBALL = $(RELEASE_DIR)/$(PKG_NAME).tar.gz
SDK_PATH ?= $(or $(HAILO_SDK_PATH),/opt/hailo-sdk)
RECOVERY_BUNDLE_DIR ?= build/recovery/hailo15-ne503
RECOVERY_VERSION ?= 1.0.1
DOCKER_RELEASE_IMAGE ?= zerobot/ne503-dev-env-full:4.0.23
DOCKER_RELEASE_WORKDIR ?= /ne503
DOCKER_RELEASE_SDK_PATH ?= /opt/hailo-sdk
DOCKER_RELEASE_NODE_VERSION ?= 24.18.0
DOCKER_RELEASE_PNPM_VERSION ?= 10.34.5
DOCKER_PULL ?= 1
AIPC_COMPAT_LEVEL ?= 1
AIPC_DATA_SCHEMA ?= 1
AIPC_MACHINE ?= hailo15-ne503
AIPC_PRODUCT ?= ne503
SKIP_STAGE_TARBALL ?= 0
BUILD_MCU_FW ?= 0
MCU_MAKE_ARGS ?= RELEASE=1
MCU_FW_BUILD_DIR ?= mcu_board_prj/build
MCU_FW_DIR ?= $(BUILD_DIR)/mcu-firmware
HAL_PLATFORM ?= stub
GO ?= go
GO_BUILD_FLAGS ?= -v -mod=mod
GO_TEST_FLAGS ?= -v -race
GO_CACHE_DIR ?= /tmp/aipc-go-cache
CMAKE ?= cmake
CMAKE_BUILD_TYPE ?= Release
PROTOC ?= protoc

PROTO_GO_PLUGIN := --go_out=. --go_opt=paths=source_relative --go-grpc_out=. --go-grpc_opt=paths=source_relative
PROTOC_OPT := --experimental_allow_proto3_optional
CMAKE_TARGET_ARGS := -DCMAKE_BUILD_TYPE=$(CMAKE_BUILD_TYPE)
SYSROOT_ENV :=
HAL_V2_BUILD_DIR := hal_v2/build-$(HAL_PLATFORM)

ifeq ($(HAL_PLATFORM),hailo15)
AIPC_GO_ENV := GOCACHE=$(GO_CACHE_DIR) CGO_ENABLED=0 GOOS=linux GOARCH=arm64
ifneq ($(CMAKE_TOOLCHAIN_FILE),)
CMAKE_TARGET_ARGS += -DCMAKE_TOOLCHAIN_FILE=$(CMAKE_TOOLCHAIN_FILE)
else ifneq ($(wildcard $(CURDIR)/cmake/toolchain-aarch64-hailo.cmake),)
CMAKE_TARGET_ARGS += -DCMAKE_TOOLCHAIN_FILE=$(CURDIR)/cmake/toolchain-aarch64-hailo.cmake
endif
ifneq ($(SDK_PATH),)
export HAILO_SDK_PATH := $(SDK_PATH)
CMAKE_TARGET_ARGS += -DHAILO_SDK_PATH=$(SDK_PATH)
POKY_ENV_SCRIPT := $(firstword $(wildcard $(SDK_PATH)/environment-setup-*-poky-linux))
ifneq ($(POKY_ENV_SCRIPT),)
SYSROOT_ENV := . $(POKY_ENV_SCRIPT) &&
endif
endif
else
AIPC_GO_ENV := GOCACHE=$(GO_CACHE_DIR) CGO_ENABLED=0
endif

all: proto hal-v2 platform ai-runtime camera-daemon aipc-cli

proto: proto-inference proto-device proto-event proto-camera proto-app proto-lens proto-discovery
ifeq ($(HAL_PLATFORM),hailo15)
	@if [ -n "$(SDK_PATH)" ]; then ./scripts/generate_proto_arm.sh --sdk-path "$(SDK_PATH)"; fi
endif

proto-inference:
	cd platform/ai-runtime/proto && $(PROTOC) $(PROTO_GO_PLUGIN) inference.proto

proto-device:
	cd platform/device-control/proto && $(PROTOC) $(PROTO_GO_PLUGIN) device.proto

proto-event:
	cd platform/event-bus/proto && $(PROTOC) $(PROTO_GO_PLUGIN) event.proto

proto-camera:
	@if [ -f platform/camera-daemon/proto/camera.proto ]; then \
		cd platform/camera-daemon/proto && $(PROTOC) $(PROTOC_OPT) $(PROTO_GO_PLUGIN) camera.proto; \
	fi

proto-app:
	@if [ -f platform/app-manager/proto/app.proto ]; then \
		cd platform/app-manager/proto && $(PROTOC) $(PROTO_GO_PLUGIN) app.proto; \
	fi

proto-lens:
	@mkdir -p platform/device-control/lens/lenspb
	$(PROTOC) --proto_path=platform/camera-daemon/proto $(PROTOC_OPT) \
		--go_out=platform/device-control/lens/lenspb --go_opt=paths=source_relative \
		--go-grpc_out=platform/device-control/lens/lenspb --go-grpc_opt=paths=source_relative \
		platform/camera-daemon/proto/lens_hal.proto

proto-discovery:
	cd platform/device-discovery/proto && $(PROTOC) $(PROTO_GO_PLUGIN) discovery.proto

hal-v2:
	@echo "==> Building HAL v2 [platform=$(HAL_PLATFORM)]"
	@mkdir -p $(HAL_V2_BUILD_DIR)
	cd $(HAL_V2_BUILD_DIR) && $(SYSROOT_ENV) $(CMAKE) $(CMAKE_TARGET_ARGS) -DHAL_PLATFORM=$(HAL_PLATFORM) ..
	cd $(HAL_V2_BUILD_DIR) && $(SYSROOT_ENV) $(MAKE) -j$$(nproc)
	@rm -rf $(BUILD_DIR)/hal/$(HAL_PLATFORM)
	@mkdir -p $(BUILD_DIR)/hal/$(HAL_PLATFORM)
	@cp -P $(HAL_V2_BUILD_DIR)/libaipc_hal*.so* $(HAL_V2_BUILD_DIR)/libhal-*.so* $(BUILD_DIR)/hal/$(HAL_PLATFORM)/ 2>/dev/null || true

platform: device-control event-bus app-manager platform-api device-discovery os-updater

ai-runtime: proto
	@echo "==> Building ai-runtime"
	@mkdir -p platform/ai-runtime/build-$(HAL_PLATFORM) $(BUILD_DIR)
	cd platform/ai-runtime/build-$(HAL_PLATFORM) && $(SYSROOT_ENV) $(CMAKE) $(CMAKE_TARGET_ARGS) .. && $(SYSROOT_ENV) $(MAKE) -j$$(nproc)
	cp platform/ai-runtime/build-$(HAL_PLATFORM)/ai-runtime $(BUILD_DIR)/

device-control: proto
	@mkdir -p $(BUILD_DIR)
	$(AIPC_GO_ENV) $(GO) build $(GO_BUILD_FLAGS) -o $(CURDIR)/$(BUILD_DIR)/device-control ./platform/device-control/server

event-bus: proto
	@mkdir -p $(BUILD_DIR)
	cd platform/event-bus/server && $(AIPC_GO_ENV) $(GO) build $(GO_BUILD_FLAGS) -o $(CURDIR)/$(BUILD_DIR)/event-bus .

app-manager: proto
	@mkdir -p $(BUILD_DIR)
	cd platform/app-manager && $(AIPC_GO_ENV) $(GO) build $(GO_BUILD_FLAGS) -o $(CURDIR)/$(BUILD_DIR)/app-manager ./cmd

platform-api: proto
	@mkdir -p $(BUILD_DIR)
	cd platform/platform-api/server && $(AIPC_GO_ENV) $(GO) build $(GO_BUILD_FLAGS) -o $(CURDIR)/$(BUILD_DIR)/platform-api .

device-discovery: proto
	@mkdir -p $(BUILD_DIR)
	cd platform/device-discovery/server && $(AIPC_GO_ENV) $(GO) build $(GO_BUILD_FLAGS) -o $(CURDIR)/$(BUILD_DIR)/device-discovery .

os-updater:
	@mkdir -p $(BUILD_DIR)
	cd platform/os-updater && $(AIPC_GO_ENV) $(GO) build $(GO_BUILD_FLAGS) -o $(CURDIR)/$(BUILD_DIR)/aipc-os-updater .

camera-daemon: proto
	@echo "==> Building camera-daemon"
	@mkdir -p platform/camera-daemon/build-$(HAL_PLATFORM) $(BUILD_DIR)
	cd platform/camera-daemon/build-$(HAL_PLATFORM) && $(SYSROOT_ENV) $(CMAKE) $(CMAKE_TARGET_ARGS) .. && $(SYSROOT_ENV) $(MAKE) -j$$(nproc)
	cp platform/camera-daemon/build-$(HAL_PLATFORM)/camera-daemon $(BUILD_DIR)/

web:
	cd web && pnpm install && pnpm run build

aipc-cli:
	@mkdir -p $(BUILD_DIR)
	$(AIPC_GO_ENV) $(GO) build $(GO_BUILD_FLAGS) -o $(CURDIR)/$(BUILD_DIR)/aipc-cli ./tools/aipc-cli

tools:
	@echo "==> Building tools (shm-reader, nv12-to-jpeg)"
	@mkdir -p tools/shm-reader/build-$(HAL_PLATFORM)
	cd tools/shm-reader/build-$(HAL_PLATFORM) && $(SYSROOT_ENV) $(CMAKE) $(CMAKE_TARGET_ARGS) .. && $(SYSROOT_ENV) $(MAKE) -j$$(nproc)
	cp tools/shm-reader/build-$(HAL_PLATFORM)/shm-reader tools/shm-reader/build-$(HAL_PLATFORM)/nv12-to-jpeg $(BUILD_DIR)/ 2>/dev/null || true

docker-pack-release:
	@echo "==> Building Hailo-15 release package in Docker"
	@echo "    image: $(DOCKER_RELEASE_IMAGE)"
	@if [ "$(DOCKER_PULL)" = "1" ]; then docker pull "$(DOCKER_RELEASE_IMAGE)"; fi
	docker run --rm -t \
		--entrypoint /bin/bash \
		--user root \
		-v "$(CURDIR):$(DOCKER_RELEASE_WORKDIR)" \
		-w "$(DOCKER_RELEASE_WORKDIR)" \
		-e SDK_PATH="$(DOCKER_RELEASE_SDK_PATH)" \
		-e HAILO_SDK_PATH="$(DOCKER_RELEASE_SDK_PATH)" \
		-e BUILD_MCU_FW="$(BUILD_MCU_FW)" \
		-e HOST_UID="$$(id -u)" \
		-e HOST_GID="$$(id -g)" \
		-e DOCKER_RELEASE_NODE_VERSION="$(DOCKER_RELEASE_NODE_VERSION)" \
		-e DOCKER_RELEASE_PNPM_VERSION="$(DOCKER_RELEASE_PNPM_VERSION)" \
		"$(DOCKER_RELEASE_IMAGE)" \
		-lc 'set -e; \
			trap "chown -R $$HOST_UID:$$HOST_GID build hal_v2 platform web tools mcu_board_prj 2>/dev/null || true" EXIT; \
			if ! command -v python >/dev/null 2>&1 && command -v python3 >/dev/null 2>&1; then ln -sf "$$(command -v python3)" /usr/local/bin/python; fi; \
			case "$$BUILD_MCU_FW" in 1|yes|true|on) \
				if ! command -v arm-none-eabi-gcc >/dev/null 2>&1; then \
					if ! command -v apt-get >/dev/null 2>&1; then echo "ERROR: arm-none-eabi-gcc is required for BUILD_MCU_FW=1"; exit 1; fi; \
					export DEBIAN_FRONTEND=noninteractive; \
					apt-get update; \
					apt-get install -y --no-install-recommends gcc-arm-none-eabi binutils-arm-none-eabi libnewlib-arm-none-eabi; \
					rm -rf /var/lib/apt/lists/*; \
				fi; \
				arm-none-eabi-gcc --version | head -1; \
			;; esac; \
			node_major="$$(node -p "process.versions.node.split('\''.'\'')[0]")"; \
			if [ "$$node_major" -lt 24 ]; then \
				node_dist="node-v$$DOCKER_RELEASE_NODE_VERSION-linux-x64"; \
				node_dir="/tmp/$$node_dist"; \
				if [ ! -x "$$node_dir/bin/node" ]; then \
					curl -fsSL "https://nodejs.org/dist/v$$DOCKER_RELEASE_NODE_VERSION/$$node_dist.tar.gz" | tar -xz -C /tmp; \
				fi; \
				export PATH="$$node_dir/bin:$$PATH"; \
			fi; \
			node -v; \
			corepack enable; \
			corepack prepare "pnpm@$$DOCKER_RELEASE_PNPM_VERSION" --activate; \
			pnpm -v; \
			make pack-release SDK_PATH="$$SDK_PATH" HAILO_SDK_PATH="$$HAILO_SDK_PATH" VERSION="$(VERSION)" BUILD_MCU_FW="$$BUILD_MCU_FW"'

mcu-firmware:
	@echo "==> Building MCU firmware ($(MCU_MAKE_ARGS))"
	@$(MAKE) -C mcu_board_prj clean
	@if [ "$(MCU_FW_DIR)" != "mcu_board_prj/firmware" ]; then rm -rf "$(MCU_FW_DIR)"; fi
	$(MAKE) -C mcu_board_prj $(MCU_MAKE_ARGS)
	@mkdir -p "$(MCU_FW_DIR)"
	@found_ota=0; \
	for f in \
		"$(MCU_FW_BUILD_DIR)"/ne503_mcu_boot.bin \
		"$(MCU_FW_BUILD_DIR)"/ne503_mcu_boot.elf \
		"$(MCU_FW_BUILD_DIR)"/ne503_Main_v*.hex \
		"$(MCU_FW_BUILD_DIR)"/ne503_ota_package_*.bin; do \
		[ -f "$$f" ] || continue; \
		cp -f "$$f" "$(MCU_FW_DIR)/"; \
		echo "  + mcu firmware: $$(basename "$$f")"; \
		case "$$f" in */ne503_ota_package_*.bin) found_ota=1 ;; esac; \
	done; \
	if [ "$$found_ota" -ne 1 ]; then \
		echo "ERROR: MCU build completed but no $(MCU_FW_BUILD_DIR)/ne503_ota_package_*.bin was found"; \
		exit 1; \
	fi; \
	echo "==> MCU firmware staged in $(MCU_FW_DIR)"

pack: all tools web
	$(MAKE) _pack-stage HAL_PLATFORM="$(HAL_PLATFORM)" VERSION="$(VERSION)"

pack-release:
	@if [ ! -d "$(SDK_PATH)" ]; then \
		echo "ERROR: SDK not found at $(SDK_PATH). Set SDK_PATH=/path/to/poky-sdk or HAILO_SDK_PATH."; \
		exit 1; \
	fi
ifneq ($(filter 1 yes true on,$(BUILD_MCU_FW)),)
	$(MAKE) mcu-firmware
endif
	$(MAKE) all tools web HAL_PLATFORM=hailo15 SDK_PATH="$(SDK_PATH)" VERSION="$(VERSION)"
	$(MAKE) _pack-internal HAL_PLATFORM=hailo15 SDK_PATH="$(SDK_PATH)" VERSION="$(VERSION)"

_pack-stage:
	@echo "==> Packaging release [$(VERSION), platform=$(HAL_PLATFORM)]"
	@missing=""; \
	for b in camera-daemon ai-runtime device-control event-bus platform-api app-manager aipc-cli device-discovery aipc-os-updater; do \
		[ -x "$(BUILD_DIR)/$$b" ] || missing="$$missing $$b"; \
	done; \
	[ -e "$(BUILD_DIR)/hal/$(HAL_PLATFORM)/libaipc_hal.so" ] || missing="$$missing libaipc_hal.so"; \
	if [ -n "$$missing" ]; then \
		echo "ERROR: missing platform binaries in $(BUILD_DIR):$$missing"; \
		echo "       Run 'make all' before packaging."; \
		exit 1; \
	fi
	@for helper in scripts/aipc-install-current-root.sh scripts/aipc-compat-check.sh systemd/aipc-platform.target; do \
		if [ ! -f "$$helper" ]; then \
			echo "ERROR: missing required release helper $$helper"; \
			exit 1; \
		fi; \
	done
	@rm -rf "$(STAGE_DIR)" "$(TARBALL)"
	@mkdir -p "$(STAGE_DIR)/opt/aipc/bin" \
		"$(STAGE_DIR)/opt/aipc/libexec" \
		"$(STAGE_DIR)/opt/aipc/lib/hal" \
		"$(STAGE_DIR)/opt/aipc/etc/security" \
		"$(STAGE_DIR)/opt/aipc/scripts" \
		"$(STAGE_DIR)/opt/aipc/recovery" \
		"$(STAGE_DIR)/opt/aipc/web" \
		"$(STAGE_DIR)/opt/aipc/swagger-ui" \
		"$(STAGE_DIR)/opt/aipc/models" \
		"$(STAGE_DIR)/systemd"
	@for f in camera-daemon ai-runtime device-control event-bus platform-api app-manager aipc-cli device-discovery; do \
		cp "$(BUILD_DIR)/$$f" "$(STAGE_DIR)/opt/aipc/bin/"; \
		echo "  + $$f"; \
	done
	@cp "$(BUILD_DIR)/aipc-os-updater" "$(STAGE_DIR)/opt/aipc/libexec/" && echo "  + aipc-os-updater"
	@if [ "$(HAL_PLATFORM)" = "hailo15" ]; then \
		if [ -f "$(RECOVERY_BUNDLE_DIR)/manifest.json" ] && [ -f "$(RECOVERY_BUNDLE_DIR)/fitImage" ] && [ -f "$(RECOVERY_BUNDLE_DIR)/swupdate-image-hailo15-ne503.ext4.gz" ]; then \
			cp -f "$(RECOVERY_BUNDLE_DIR)/manifest.json" "$(RECOVERY_BUNDLE_DIR)/fitImage" "$(RECOVERY_BUNDLE_DIR)/swupdate-image-hailo15-ne503.ext4.gz" "$(STAGE_DIR)/opt/aipc/recovery/"; \
			echo "  + bundled single-copy Recovery $(RECOVERY_VERSION)"; \
		else \
			echo "  - recovery bundle not found at $(RECOVERY_BUNDLE_DIR)"; \
		fi; \
	fi
	@for f in shm-reader nv12-to-jpeg; do \
		[ -f "$(BUILD_DIR)/$$f" ] && cp "$(BUILD_DIR)/$$f" "$(STAGE_DIR)/opt/aipc/bin/" && echo "  + $$f"; \
	done
	@[ -f tools/shm-reader/shm_viewer.py ] && cp tools/shm-reader/shm_viewer.py "$(STAGE_DIR)/opt/aipc/bin/" || true
	@cp -P $(BUILD_DIR)/hal/$(HAL_PLATFORM)/libaipc_hal*.so* $(BUILD_DIR)/hal/$(HAL_PLATFORM)/libhal-*.so* "$(STAGE_DIR)/opt/aipc/lib/hal/" 2>/dev/null || true
	@cp -f configs/platform/camera-daemon.yaml "$(STAGE_DIR)/opt/aipc/etc/" 2>/dev/null || true
	@cp -f configs/ai/ai-runtime.yaml "$(STAGE_DIR)/opt/aipc/etc/" 2>/dev/null || true
	@cp -f configs/platform/event-bus.yaml "$(STAGE_DIR)/opt/aipc/etc/" 2>/dev/null || true
	@cp -f configs/platform/app-manager.yaml "$(STAGE_DIR)/opt/aipc/etc/" 2>/dev/null || true
	@cp -f configs/platform/device-control.yaml "$(STAGE_DIR)/opt/aipc/etc/" 2>/dev/null || true
	@cp -f configs/platform-api.yaml "$(STAGE_DIR)/opt/aipc/etc/" 2>/dev/null || true
	@cp -f configs/platform/discovery.yaml "$(STAGE_DIR)/opt/aipc/etc/" 2>/dev/null || true
	@cp -f configs/security/seccomp-default.json "$(STAGE_DIR)/opt/aipc/etc/security/" 2>/dev/null || true
	@mkdir -p "$(STAGE_DIR)/opt/aipc/etc/systemd/system.conf.d" \
		"$(STAGE_DIR)/opt/aipc/etc/systemd/journald.conf.d" \
		"$(STAGE_DIR)/opt/aipc/etc/sysctl.d"
	@cp -f configs/systemd/*.conf "$(STAGE_DIR)/opt/aipc/etc/systemd/system.conf.d/" 2>/dev/null || true
	@cp -f configs/systemd/journald.conf.d/*.conf "$(STAGE_DIR)/opt/aipc/etc/systemd/journald.conf.d/" 2>/dev/null || true
	@cp -f configs/system/sysctl.d/*.conf "$(STAGE_DIR)/opt/aipc/etc/sysctl.d/" 2>/dev/null || true
	@for unit in systemd/*.service systemd/*.timer systemd/*.target; do \
		[ -f "$$unit" ] || continue; \
		install -m 0644 "$$unit" "$(STAGE_DIR)/systemd/"; \
	done
	@cp -f scripts/deploy.sh "$(STAGE_DIR)/deploy.sh" 2>/dev/null && chmod +x "$(STAGE_DIR)/deploy.sh" || true
	@install -m 0755 scripts/aipc-install-current-root.sh "$(STAGE_DIR)/opt/aipc/scripts/aipc-install-current-root.sh"
	@cp -f scripts/aipc-firstboot.sh "$(STAGE_DIR)/opt/aipc/scripts/aipc-firstboot.sh" 2>/dev/null && chmod +x "$(STAGE_DIR)/opt/aipc/scripts/aipc-firstboot.sh" || true
	@cp -f scripts/aipc-healthmon.sh "$(STAGE_DIR)/opt/aipc/scripts/aipc-healthmon.sh" 2>/dev/null && chmod +x "$(STAGE_DIR)/opt/aipc/scripts/aipc-healthmon.sh" || true
	@cp -f scripts/aipc-logrotate.sh "$(STAGE_DIR)/opt/aipc/scripts/aipc-logrotate.sh" 2>/dev/null && chmod +x "$(STAGE_DIR)/opt/aipc/scripts/aipc-logrotate.sh" || true
	@cp -f scripts/aipc-os-layout-check.sh "$(STAGE_DIR)/opt/aipc/scripts/aipc-os-layout-check.sh" 2>/dev/null && chmod +x "$(STAGE_DIR)/opt/aipc/scripts/aipc-os-layout-check.sh" || true
	@cp -f scripts/aipc-restore.sh "$(STAGE_DIR)/opt/aipc/libexec/aipc-restore" 2>/dev/null && chmod +x "$(STAGE_DIR)/opt/aipc/libexec/aipc-restore" || true
	@cp -f scripts/aipc-firstboot-os.sh "$(STAGE_DIR)/opt/aipc/libexec/aipc-firstboot" 2>/dev/null && chmod +x "$(STAGE_DIR)/opt/aipc/libexec/aipc-firstboot" || true
	@cp -f scripts/aipc-autostart.sh "$(STAGE_DIR)/opt/aipc/libexec/aipc-autostart" 2>/dev/null && chmod +x "$(STAGE_DIR)/opt/aipc/libexec/aipc-autostart" || true
	@cp -f scripts/aipc-compat-check.sh "$(STAGE_DIR)/opt/aipc/libexec/aipc-compat-check" 2>/dev/null && chmod +x "$(STAGE_DIR)/opt/aipc/libexec/aipc-compat-check" || true
	@cp -f scripts/aipc-osd-apply.sh "$(STAGE_DIR)/opt/aipc/libexec/aipc-osd-apply" 2>/dev/null && chmod +x "$(STAGE_DIR)/opt/aipc/libexec/aipc-osd-apply" || true
	@cp -f scripts/aipc-mcu-prep.sh "$(STAGE_DIR)/opt/aipc/bin/aipc-mcu-prep.sh" 2>/dev/null && chmod +x "$(STAGE_DIR)/opt/aipc/bin/aipc-mcu-prep.sh" || true
	@if [ -x "$(HAL_V2_BUILD_DIR)/ne503_boot_prep" ]; then cp -f "$(HAL_V2_BUILD_DIR)/ne503_boot_prep" "$(STAGE_DIR)/opt/aipc/bin/" && echo "  + ne503_boot_prep (from $(HAL_V2_BUILD_DIR))"; \
	elif [ -x hal_v2/examples/ne503_boot_prep/build-standalone/ne503_boot_prep ]; then cp -f hal_v2/examples/ne503_boot_prep/build-standalone/ne503_boot_prep "$(STAGE_DIR)/opt/aipc/bin/" && echo "  + ne503_boot_prep (standalone)"; \
	elif [ -x tools/ne503_boot_prep ]; then cp -f tools/ne503_boot_prep "$(STAGE_DIR)/opt/aipc/bin/" && echo "  + ne503_boot_prep (tools/ copy)"; \
	else echo "  - ne503_boot_prep not built"; fi
	@mkdir -p "$(STAGE_DIR)/opt/aipc/firmware/mcu"
	@found=0; \
	for dir in "$(MCU_FW_DIR)" mcu_board_prj/firmware firmware/mcu; do \
		for f in "$$dir"/ne503_ota_package_*.bin; do \
			[ -f "$$f" ] || continue; \
			cp -f "$$f" "$(STAGE_DIR)/opt/aipc/firmware/mcu/"; \
			echo "  + mcu fw: $$(basename "$$f") (from $$dir)"; \
			found=1; \
		done; \
	done; \
	[ "$$found" -eq 1 ] || echo "  - mcu fw: no ne503_ota_package_*.bin found"
	@mkdir -p "$(STAGE_DIR)/opt/aipc/docs" "$(STAGE_DIR)/opt/aipc/share/calibration"
	@cp -f docs/baseboard-mcu-rtc-ota.md "$(STAGE_DIR)/opt/aipc/docs/" 2>/dev/null || true
	@cp -f configs/calibration/final_calibration.json "$(STAGE_DIR)/opt/aipc/share/calibration/final_calibration.json" 2>/dev/null && echo "  + imu calibration" || echo "  - imu calibration missing"
	@cp -f scripts/download_models.sh "$(STAGE_DIR)/opt/aipc/bin/download_models.sh" 2>/dev/null && chmod +x "$(STAGE_DIR)/opt/aipc/bin/download_models.sh" || true
	@[ -d web/dist ] && cp -r web/dist/* "$(STAGE_DIR)/opt/aipc/web/" && echo "  + web console" || true
	@cp -f platform/platform-api/swagger-ui/* "$(STAGE_DIR)/opt/aipc/swagger-ui/" 2>/dev/null || true
	@cp -f docs/api/swagger.yaml "$(STAGE_DIR)/opt/aipc/etc/swagger.yaml" 2>/dev/null || true
	@for cat in detection classification segmentation keypoint clip depth ocr genai; do \
		mkdir -p "$(STAGE_DIR)/opt/aipc/models/$$cat"; \
	done
	@printf '%s\n' \
		"version=$(VERSION)" \
		"build_date=$$(date +%Y%m%d-%H%M%S)" \
		"git_commit=$$(git rev-parse --short HEAD 2>/dev/null || echo unknown)" \
		"platform=$(HAL_PLATFORM)" > "$(STAGE_DIR)/VERSION"
	@printf '%s\n' \
		'{' \
		'  "app_version": "$(VERSION)",' \
		'  "machine": "$(AIPC_MACHINE)",' \
		'  "product": "$(AIPC_PRODUCT)",' \
		'  "required_compat_level": $(AIPC_COMPAT_LEVEL),' \
		'  "supported_data_schema": [$(AIPC_DATA_SCHEMA)],' \
		'  "target_data_schema": $(AIPC_DATA_SCHEMA)' \
		'}' > "$(STAGE_DIR)/opt/aipc/app-manifest.json"
	@if [ "$(SKIP_STAGE_TARBALL)" != "1" ]; then \
		mkdir -p "$(RELEASE_DIR)"; \
		tar czf "$(TARBALL)" -C "$(RELEASE_DIR)" "$(PKG_NAME)"; \
		echo "=== Release Package Ready ==="; \
		echo "  File: $(TARBALL)"; \
		echo "  Size: $$(du -h "$(TARBALL)" | cut -f1)"; \
	fi

_pack-internal: SKIP_STAGE_TARBALL = 1
_pack-internal: _pack-stage
	@IMAGING_BASE="$(SDK_PATH)/sysroots/armv8a-poky-linux/etc/imaging"; \
	if [ -d "$$IMAGING_BASE" ]; then \
		mkdir -p "$(STAGE_DIR)/opt/aipc/etc/imaging"; \
		cp -a "$$IMAGING_BASE"/. "$(STAGE_DIR)/opt/aipc/etc/imaging/"; \
		echo "  + imaging configs"; \
	else \
		echo "  - imaging configs not found at $$IMAGING_BASE"; \
	fi
	@mkdir -p "$(RELEASE_DIR)"
	tar czf "$(TARBALL)" -C "$(RELEASE_DIR)" "$(PKG_NAME)"
	@echo "=== Release Package Ready ==="
	@echo "  File: $(TARBALL)"
	@echo "  Size: $$(du -h "$(TARBALL)" | cut -f1)"

test: test-unit test-integration

test-unit: proto
	$(GO) test $(GO_TEST_FLAGS) ./platform/... ./tests/unit

test-integration: proto
	$(GO) test -v ./tests/integration

fmt:
	$(GO) fmt ./platform/... ./tests/...
	@if command -v clang-format >/dev/null 2>&1; then \
		find hal_v2 platform tools tests -name "*.c" -o -name "*.h" -o -name "*.cpp" | xargs clang-format -i; \
	fi

lint:
	golangci-lint run ./platform/...

clean:
	rm -rf build/output build/release
	rmdir build 2>/dev/null || true
	find hal_v2 platform tools -maxdepth 3 -type d \( -name "build-*" -o -name "build_*" \) -prune -exec rm -rf {} +
	find platform -path "*/proto/*.pb.go" -delete
	rm -rf platform/device-control/lens/lenspb

distclean: clean
	rm -rf web/node_modules web/dist web/.husky/_
	find . -name "__pycache__" -type d -prune -exec rm -rf {} +
	find . -name "*.pyc" -delete

help:
	@echo "NE503 AIPC platform targets:"
	@echo "  make all              Build proto, HAL v2, Go services, C++ services, and CLI"
	@echo "  make proto            Compile protobuf definitions"
	@echo "  make hal-v2           Build HAL v2, default HAL_PLATFORM=stub"
	@echo "  make platform         Build Go platform services"
	@echo "  make camera-daemon    Build C++ camera daemon"
	@echo "  make ai-runtime       Build C++ AI runtime"
	@echo "  make web              Build web console"
	@echo "  make pack             Build native stub release tarball"
	@echo "  make pack-release     Build Hailo-15 release tarball (requires SDK_PATH)"
	@echo "  make docker-pack-release Build Hailo-15 release tarball in Docker"
	@echo "  make test             Run unit and integration tests"
