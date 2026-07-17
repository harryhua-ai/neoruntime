/**
 * @file main.cpp
 * @brief AIPC Camera Daemon - Entry point
 *
 * Loads YAML configuration and starts CameraDaemon.
 * Handles SIGINT/SIGTERM for graceful shutdown.
 */

#include "../include/camera_daemon.h"

#include <iostream>
#include <fstream>
#include <sstream>
#include <cerrno>
#include <cstddef>
#include <csignal>
#include <cstdlib>
#include <cstring>
#include <getopt.h>
#include <sys/socket.h>
#include <sys/stat.h>
#include <sys/un.h>
#include <unistd.h>

extern "C" {
    #include "hal_log.h"
    #include "crash_handler.h"
}

static CameraDaemon* g_daemon = nullptr;

// Send READY=1 without taking a build-time dependency on libsystemd.  This is
// the sd_notify wire protocol: one datagram to the Unix socket named by
// NOTIFY_SOCKET.  Abstract sockets are represented by a leading '@'.
static void notify_systemd_ready() {
    const char* notify_socket = std::getenv("NOTIFY_SOCKET");
    if (notify_socket == nullptr || notify_socket[0] == '\0') return;

    int fd = socket(AF_UNIX, SOCK_DGRAM | SOCK_CLOEXEC, 0);
    if (fd < 0) {
        HAL_LOG_WARNING("Failed to create systemd notify socket: %s", std::strerror(errno));
        return;
    }

    sockaddr_un addr{};
    addr.sun_family = AF_UNIX;
    size_t path_len = std::strlen(notify_socket);
    if (path_len >= sizeof(addr.sun_path)) {
        HAL_LOG_WARNING("NOTIFY_SOCKET path is too long");
        close(fd);
        return;
    }
    std::memcpy(addr.sun_path, notify_socket, path_len + 1);
    if (addr.sun_path[0] == '@') addr.sun_path[0] = '\0';

    const char ready[] = "READY=1\nSTATUS=Camera pipeline and gRPC control are ready";
    // Abstract socket names are length-delimited and must not include the
    // trailing NUL; filesystem socket paths do include it.
    const bool abstract_socket = notify_socket[0] == '@';
    const socklen_t addr_len = static_cast<socklen_t>(
        offsetof(sockaddr_un, sun_path) + path_len + (abstract_socket ? 0 : 1));
    if (sendto(fd, ready, sizeof(ready) - 1, MSG_NOSIGNAL,
               reinterpret_cast<sockaddr*>(&addr), addr_len) < 0) {
        HAL_LOG_WARNING("Failed to notify systemd readiness: %s", std::strerror(errno));
    }
    close(fd);
}

static void signal_handler(int signo) {
    HAL_LOG_INFO("Received signal %d, shutting down...", signo);
    if (g_daemon) {
        g_daemon->stop();
    }
}

/* ========== Minimal YAML-like config parser ========== */

static std::string trim(const std::string& s) {
    size_t start = s.find_first_not_of(" \t\r\n");
    if (start == std::string::npos) return "";
    size_t end = s.find_last_not_of(" \t\r\n");
    return s.substr(start, end - start + 1);
}

static std::string strip_inline_comment(const std::string& s) {
    bool in_quote = false;
    char qc = 0;
    for (size_t i = 0; i < s.size(); i++) {
        if (!in_quote && (s[i] == '"' || s[i] == '\'')) { in_quote = true; qc = s[i]; }
        else if (in_quote && s[i] == qc) { in_quote = false; }
        else if (!in_quote && s[i] == '#') { return s.substr(0, i); }
    }
    return s;
}

static std::string strip_quotes(const std::string& s) {
    if (s.size() >= 2 &&
        ((s.front() == '"' && s.back() == '"') ||
         (s.front() == '\'' && s.back() == '\'')))
        return s.substr(1, s.size() - 2);
    return s;
}

static std::string get_value(const std::string& line) {
    auto pos = line.find(':');
    if (pos == std::string::npos) return "";
    return strip_quotes(trim(line.substr(pos + 1)));
}

// Derive the AIPC install prefix from the config file path:
//   /data/aipc/etc/camera-daemon.yaml -> /data/aipc
//   /opt/aipc/etc/camera-daemon.yaml  -> /opt/aipc  (legacy)
// Used for default HAL library / log paths when the YAML omits them.
static std::string derive_install_prefix(const std::string& config_path) {
    if (config_path.find("/data/") == 0 || config_path.find("/data\\") == 0)
        return "/data/aipc";
    return "/opt/aipc";
}

static DaemonConfig load_config(const std::string& path) {
    DaemonConfig cfg;

    // Defaults
    // HAL library: derive from the install prefix so a missing video_library
    // key still resolves to the real monolithic library. The previous default
    // (hal-hailo15.so) did not exist and caused HAL load failures when the
    // YAML key was absent.
    cfg.video_lib = derive_install_prefix(path) + "/lib/hal/libaipc_hal.so";
    cfg.codec_lib = "";
    cfg.device_path = "/dev/video0";
    cfg.device_width = 1920;
    cfg.device_height = 1080;
    cfg.device_fps = 30;
    cfg.device_format = 0;  // NV12
    cfg.fd_pub_sock_path = "/run/aipc/camera.sock";
    cfg.fd_pub_max_clients = 16;
    cfg.fd_pub_max_outstanding = 3;
    cfg.rtsp_enabled = true;
    cfg.rtsp_port = 8554;
    cfg.encoded_pub_enabled = true;
    cfg.encoded_pub_dir = "/run/aipc/encoded";
    cfg.watchdog_scan_ms = 100;
    cfg.watchdog_timeout_ms = 5000;
    cfg.watchdog_warn_ms = 3000;
    cfg.log_level = "info";

    // Streams derived from encoders after YAML parse (see below)
    cfg.streams = {};

    // Default encoder for main stream (aligned with video_test)
    EncoderCfg main_enc;
    main_enc.stream_name = "main";
    main_enc.codec = "h264";
    main_enc.width = 1920;
    main_enc.height = 1080;
    main_enc.fps = 30;
    main_enc.bitrate = 4000000;
    main_enc.gop = 60;
    main_enc.cbr = true;
    main_enc.rc_mode = "CBR";
    main_enc.max_bitrate = 0;
    main_enc.qp_min = 20;
    main_enc.qp_max = 45;
    main_enc.output_pool_max_buffers = 11;
    main_enc.max_queue_size = 8;
    // OSD disabled by default — enable via osd_config_path in YAML
    cfg.encoders = { main_enc };

    // Default OSD (empty — enable via config file to avoid missing font errors)
    cfg.osd_overlays = {};

    // Try to load config file
    std::ifstream file(path);
    if (!file.is_open()) {
        HAL_LOG_WARNING("Config file not found: %s, using defaults", path.c_str());
        return cfg;
    }

    HAL_LOG_INFO("Loading config: %s", path.c_str());

    std::string line;
    std::string section;

    while (std::getline(file, line)) {
        line = strip_inline_comment(line);
        std::string trimmed = trim(line);
        if (trimmed.empty() || trimmed[0] == '#') continue;

        // Track section context
        if (trimmed.find("hal:") == 0) { section = "hal"; continue; }
        if (trimmed.find("media:") == 0) { section = "media"; continue; }
        if (trimmed.find("video:") == 0) { section = "video"; continue; }
        if (trimmed.find("rtsp:") == 0) { section = "rtsp"; continue; }
        if (trimmed.find("watchdog:") == 0) { section = "watchdog"; continue; }
        if (trimmed.find("ai_overlay:") == 0) { section = "ai_overlay"; continue; }
        if (trimmed.find("audio:") == 0) { section = "audio"; continue; }
        if (trimmed.find("service:") == 0) { section = "service"; continue; }
        if (trimmed.find("streams:") == 0) { section = "streams"; cfg.streams.clear(); continue; }
        if (trimmed.find("encoders:") == 0) { section = "encoders"; cfg.encoders.clear(); continue; }

        std::string val = get_value(trimmed);

        if (section == "hal") {
            if (trimmed.find("video_library:") != std::string::npos)
                cfg.video_lib = val;
            else if (trimmed.find("codec_library:") != std::string::npos)
                cfg.codec_lib = val;
            else if (trimmed.find("lens_library:") != std::string::npos)
                cfg.lens_bridge_lib = val;
            else if (trimmed.find("led_library:") != std::string::npos)
                cfg.led_lib = val;
        } else if (section == "media") {
            if (trimmed.find("config_path:") != std::string::npos)
                cfg.media_config_path = val;
            else if (trimmed.find("config_json:") != std::string::npos)
                cfg.media_config_json = val;
            else if (trimmed.find("backup_path:") != std::string::npos)
                cfg.backup_folder_path = val;
        } else if (section == "video") {
            if (trimmed.find("device_path:") != std::string::npos)
                cfg.device_path = val;
            else if (trimmed.find("config_path:") != std::string::npos)
                cfg.video_config_path = val;
        } else if (section == "rtsp") {
            if (trimmed.find("enabled:") != std::string::npos)
                cfg.rtsp_enabled = (val == "true" || val == "1");
            else if (trimmed.find("port:") != std::string::npos)
                cfg.rtsp_port = (uint16_t)std::stoul(val);
        } else if (section == "watchdog") {
            if (trimmed.find("scan_interval_ms:") != std::string::npos)
                cfg.watchdog_scan_ms = std::stoul(val);
            else if (trimmed.find("frame_timeout_ms:") != std::string::npos)
                cfg.watchdog_timeout_ms = std::stoul(val);
            else if (trimmed.find("warn_threshold_ms:") != std::string::npos)
                cfg.watchdog_warn_ms = std::stoul(val);
        } else if (section == "ai_overlay") {
            if (trimmed.find("enabled:") != std::string::npos)
                cfg.ai_overlay_enabled = (val == "true" || val == "1");
            else if (trimmed.find("event_bus_endpoint:") != std::string::npos)
                cfg.ai_overlay_event_bus_endpoint = val;
            else if (trimmed.find("topic_prefix:") != std::string::npos)
                cfg.ai_overlay_topic_prefix = val;
            else if (trimmed.find("draw_labels:") != std::string::npos)
                cfg.ai_overlay_draw_labels = (val == "true" || val == "1");
            else if (trimmed.find("draw_confidence:") != std::string::npos)
                cfg.ai_overlay_draw_confidence = (val == "true" || val == "1");
            else if (trimmed.find("draw_landmarks:") != std::string::npos)
                cfg.ai_overlay_draw_landmarks = (val == "true" || val == "1");
            else if (trimmed.find("enable_face_blur:") != std::string::npos)
                cfg.ai_overlay_enable_face_blur = (val == "true" || val == "1");
            else if (trimmed.find("box_thickness:") != std::string::npos)
                cfg.ai_overlay_box_thickness = std::stoul(val);
            else if (trimmed.find("overlay_library:") != std::string::npos)
                cfg.ai_overlay_lib = val;
            else if (trimmed.find("stream_map:") != std::string::npos && !val.empty()) {
                // Flat format: "src1:dst1,src2:dst2,..."
                std::istringstream ss(val);
                std::string pair;
                while (std::getline(ss, pair, ',')) {
                    auto c = pair.find(':');
                    if (c != std::string::npos) {
                        std::string k = trim(pair.substr(0, c));
                        std::string v = trim(pair.substr(c + 1));
                        if (!k.empty() && !v.empty())
                            cfg.ai_overlay_stream_map[k] = v;
                    }
                }
            }
        } else if (section == "streams") {
            bool is_new = (trimmed.find("- ") == 0);
            if (is_new) {
                StreamCfg s;
                s.width = 1920; s.height = 1080; s.fps = 30; // Defaults
                s.pool_max_buffers = 8; s.max_queue_size = 12;
                cfg.streams.push_back(s);
                trimmed = trim(trimmed.substr(1)); // Skip '-'
                val = get_value(trimmed);
            }
            if (!cfg.streams.empty()) {
                auto& s = cfg.streams.back();
                if (trimmed.find("name:") != std::string::npos) s.name = val;
                else if (trimmed.find("width:") != std::string::npos) s.width = std::stoul(val);
                else if (trimmed.find("height:") != std::string::npos) s.height = std::stoul(val);
                else if (trimmed.find("fps:") != std::string::npos) s.fps = std::stoul(val);
                else if (trimmed.find("pool_max_buffers:") != std::string::npos) s.pool_max_buffers = std::stoul(val);
                else if (trimmed.find("max_queue_size:") != std::string::npos) s.max_queue_size = std::stoul(val);
            }
        } else if (section == "encoders") {
            bool is_new = (trimmed.find("- ") == 0);
            if (is_new) {
                EncoderCfg enc;
                enc.codec = "h264"; enc.bitrate = 4000000; enc.gop = 60; // Defaults
                enc.cbr = true; enc.rc_mode = "CBR"; enc.max_bitrate = 0;
                enc.qp_min = 20; enc.qp_max = 45;
                enc.output_pool_max_buffers = 11; enc.max_queue_size = 8;
                cfg.encoders.push_back(enc);
                trimmed = trim(trimmed.substr(1)); // Skip '-'
                val = get_value(trimmed);
            }
            if (!cfg.encoders.empty()) {
                auto& enc = cfg.encoders.back();
                if (trimmed.find("stream_name:") != std::string::npos) enc.stream_name = val;
                else if (trimmed.find("codec:") != std::string::npos) enc.codec = val;
                else if (trimmed.find("width:") != std::string::npos) enc.width = std::stoul(val);
                else if (trimmed.find("height:") != std::string::npos) enc.height = std::stoul(val);
                else if (trimmed.find("fps:") != std::string::npos) enc.fps = std::stoul(val);
                else if (trimmed.find("bitrate:") != std::string::npos) enc.bitrate = std::stoul(val);
                else if (trimmed.find("gop:") != std::string::npos) enc.gop = std::stoul(val);
                else if (trimmed.find("cbr:") != std::string::npos) enc.cbr = (val == "true" || val == "1");
                else if (trimmed.find("rc_mode:") != std::string::npos) enc.rc_mode = val;
                else if (trimmed.find("max_bitrate:") != std::string::npos) enc.max_bitrate = std::stoul(val);
                else if (trimmed.find("qp_min:") != std::string::npos) enc.qp_min = std::stoul(val);
                else if (trimmed.find("qp_max:") != std::string::npos) enc.qp_max = std::stoul(val);
                else if (trimmed.find("osd_config_path:") != std::string::npos) enc.osd_config_path = val;
                else if (trimmed.find("enabled:") != std::string::npos) enc.enabled = (val == "true" || val == "1");
            }
        } else if (section == "audio") {
            if (trimmed.find("enabled:") != std::string::npos)
                cfg.audio.enabled = (val == "true" || val == "1");
            else if (trimmed.find("capture_device:") != std::string::npos)
                cfg.audio.capture_device = val;
            else if (trimmed.find("sample_rate:") != std::string::npos)
                cfg.audio.sample_rate = std::stoul(val);
            else if (trimmed.find("channels:") != std::string::npos)
                cfg.audio.channels = std::stoul(val);
            else if (trimmed.find("codec:") != std::string::npos)
                cfg.audio.codec = val;
            else if (trimmed.find("bitrate:") != std::string::npos)
                cfg.audio.bitrate = std::stoul(val);
            else if (trimmed.find("volume:") != std::string::npos)
                cfg.audio.volume = std::stof(val);
            else if (trimmed.find("mute:") != std::string::npos)
                cfg.audio.mute = (val == "true" || val == "1");
            else if (trimmed.find("audio_library:") != std::string::npos)
                cfg.audio.audio_lib = val;
        } else if (section == "service") {
            if (trimmed.find("log_level:") != std::string::npos)
                cfg.log_level = val;
            else if (trimmed.find("log_file:") != std::string::npos)
                cfg.log_file = val;
        }
    }

    // Derive raw stream configs from encoder configs.
    // YAML encoders: is the single source of truth for stream resolution.
    // If no explicit streams: section was provided, auto-generate from encoders.
    if (cfg.streams.empty() && !cfg.encoders.empty()) {
        for (const auto& enc : cfg.encoders) {
            if (!enc.enabled) {
                HAL_LOG_INFO("CameraDaemon: Skipping disabled encoder '%s' at startup",
                             enc.stream_name.c_str());
                continue;
            }
            cfg.streams.push_back({
                enc.stream_name,
                enc.width,
                enc.height,
                enc.fps,
                8,   // pool_max_buffers
                12,  // max_queue_size
            });
        }
    }

    return cfg;
}

static void setup_logging(const std::string& level, const std::string& log_file, const std::string& config_path) {
    int log_level = HAL_LOG_LEVEL_INFO;
    if (level == "debug") log_level = HAL_LOG_LEVEL_DEBUG;
    else if (level == "warning") log_level = HAL_LOG_LEVEL_WARNING;
    else if (level == "error") log_level = HAL_LOG_LEVEL_ERROR;

    hal_log_set_level(log_level);
    hal_log_set_color(1);
    hal_log_set_timestamp(1);

    // Remap /var/log/aipc/<name> → <prefix>/logs/<name>
    // On embedded devices /var/log is tmpfs (lost on reboot), so redirect
    // to the persistent install prefix (e.g. /data/logs/).
    std::string resolved_log_file = log_file;
    const std::string var_log_prefix = "/var/log/aipc/";
    if (log_file.compare(0, var_log_prefix.size(), var_log_prefix) == 0) {
        std::string file_name = log_file.substr(var_log_prefix.size());
        // Derive prefix from the config file path: /opt/aipc/etc/ → /opt/aipc
        // or use /data if config is under /data/etc/
        std::string prefix = "/opt/aipc";
        if (config_path.find("/data/") == 0 || config_path.find("/data\\") == 0)
            prefix = "/data";
        resolved_log_file = prefix + "/logs/" + file_name;
    }

    // Configure log file output if specified
    if (!resolved_log_file.empty()) {
        // Ensure log directory exists
        std::string log_dir = resolved_log_file;
        size_t last_slash = log_dir.find_last_of('/');
        if (last_slash != std::string::npos) {
            log_dir = log_dir.substr(0, last_slash);
            mkdir(log_dir.c_str(), 0755);
        }
        // Enable file logging with rotation (10MB max, 5 files)
        hal_log_set_file(1, resolved_log_file.c_str(), 10 * 1024 * 1024, 5);
        HAL_LOG_INFO("Logging to file: %s", resolved_log_file.c_str());
    }
}

static void print_usage(const char* prog) {
    std::cerr << "Usage: " << prog << " [options]\n"
              << "  -c, --config <path>  Config file (default: /data/aipc/etc/camera-daemon.yaml)\n"
              << "  -h, --help           Show this help\n";
}

int main(int argc, char** argv) {
    std::string config_path = "/data/aipc/etc/camera-daemon.yaml";

    // Parse command line
    static struct option long_opts[] = {
        {"config", required_argument, nullptr, 'c'},
        {"help",   no_argument,       nullptr, 'h'},
        {nullptr, 0, nullptr, 0}
    };

    int opt;
    while ((opt = getopt_long(argc, argv, "c:h", long_opts, nullptr)) != -1) {
        switch (opt) {
        case 'c': config_path = optarg; break;
        case 'h': print_usage(argv[0]); return 0;
        default:  print_usage(argv[0]); return 1;
        }
    }

    // Load configuration
    DaemonConfig config = load_config(config_path);
    setup_logging(config.log_level, config.log_file, config_path);

    HAL_LOG_INFO("===================================");
    HAL_LOG_INFO("AIPC Camera Daemon v2.0.0");
    HAL_LOG_INFO("===================================");

    // Crash handler (SIGSEGV, SIGABRT, SIGBUS, SIGFPE -> backtrace)
    // Use same prefix derivation as setup_logging for crash dumps
    {
        std::string crash_dir = "/opt/aipc/logs";
        if (config_path.find("/data/") == 0) crash_dir = "/data/logs";
        crash_handler_install("camera-daemon", crash_dir.c_str());
    }

    // Setup signal handlers
    signal(SIGINT, signal_handler);
    signal(SIGTERM, signal_handler);

    // Create and initialize daemon
    CameraDaemon daemon;
    g_daemon = &daemon;

    if (!daemon.init(config)) {
        HAL_LOG_ERROR("Failed to initialize camera daemon");
        return 1;
    }

    // init() creates the CameraControl/LensHAL socket only after the media,
    // ISP and encoder pipeline is initialized.  Notify systemd at that real
    // readiness boundary so After=camera-daemon.service has useful semantics.
    notify_systemd_ready();

    // Run (blocks until stop signal)
    daemon.run();

    g_daemon = nullptr;
    HAL_LOG_INFO("Camera daemon exited");
    return 0;
}
