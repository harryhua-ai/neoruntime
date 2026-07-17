#include "config.h"
#include "log.h"
#include <fstream>
#include <sstream>
#include <algorithm>

namespace aipc::ai_runtime {

// Minimal YAML parser: supports flat key: value and simple nested blocks.
// For production, replace with yaml-cpp.

namespace {

std::string trim(const std::string& s) {
    auto b = s.find_first_not_of(" \t\r\n");
    if (b == std::string::npos) return "";
    auto e = s.find_last_not_of(" \t\r\n");
    return s.substr(b, e - b + 1);
}

std::string strip_comment(const std::string& s) {
    bool in_quote = false;
    char quote_char = 0;
    for (size_t i = 0; i < s.size(); i++) {
        if (!in_quote && (s[i] == '"' || s[i] == '\'')) {
            in_quote = true;
            quote_char = s[i];
        } else if (in_quote && s[i] == quote_char) {
            in_quote = false;
        } else if (!in_quote && s[i] == '#') {
            return s.substr(0, i);
        }
    }
    return s;
}

std::string unquote(const std::string& s) {
    if (s.size() >= 2 &&
        ((s.front() == '"' && s.back() == '"') ||
         (s.front() == '\'' && s.back() == '\''))) {
        return s.substr(1, s.size() - 2);
    }
    return s;
}

int indent_level(const std::string& line) {
    int n = 0;
    for (char c : line) {
        if (c == ' ') ++n;
        else break;
    }
    return n;
}

}  // namespace

Config load_config(const std::string& path) {
    Config cfg;

    std::ifstream file(path);
    if (!file.is_open()) {
        LOG_WARN("Cannot open config file: %s, using defaults", path.c_str());
        return cfg;
    }

    std::string section;     // e.g. "service", "hal", "scheduler"
    std::string subsection;  // e.g. "default_session"
    bool in_preload_item = false;
    PreloadModel current_preload;
    bool in_pipeline_item = false;
    AutoInferPipeline current_pipeline;

    // Block scalar state (for platform_config: |)
    std::string block_key;
    std::string block_content;
    int block_indent = -1;

    std::string line;
    while (std::getline(file, line)) {
        line = strip_comment(line);
        auto trimmed = trim(line);

        // Inside a block scalar: collect indented lines
        if (!block_key.empty()) {
            int indent = indent_level(line);
            if (!trimmed.empty() && indent > block_indent) {
                if (!block_content.empty()) block_content += '\n';
                block_content += trimmed;
                continue;
            }
            // Block ended — flush accumulated content
            if (section == "hal" && block_key == "platform_config") {
                cfg.hal_platform_config = block_content;
            }
            block_key.clear();
            block_content.clear();
            block_indent = -1;
            // Fall through to process current line normally
        }

        if (trimmed.empty() || trimmed[0] == '#') continue;

        int indent = indent_level(line);

        // Top-level section header (indent 0)
        if (indent == 0 && trimmed.back() == ':' && trimmed.find(' ') == std::string::npos) {
            if (in_preload_item && !current_preload.id.empty()) {
                cfg.preload_models.push_back(current_preload);
                current_preload = {};
            }
            if (in_pipeline_item && !current_pipeline.model_id.empty()) {
                cfg.auto_infer_pipelines.push_back(current_pipeline);
                current_pipeline = {};
            }
            section = trimmed.substr(0, trimmed.size() - 1);
            subsection.clear();
            in_preload_item = false;
            in_pipeline_item = false;
            continue;
        }

        // Sub-section header (indent 2)
        if (indent == 2 && trimmed.back() == ':' && trimmed.find(' ') == std::string::npos) {
            if (in_preload_item && !current_preload.id.empty()) {
                cfg.preload_models.push_back(current_preload);
                current_preload = {};
            }
            if (in_pipeline_item && !current_pipeline.model_id.empty()) {
                cfg.auto_infer_pipelines.push_back(current_pipeline);
                current_pipeline = {};
            }
            subsection = trimmed.substr(0, trimmed.size() - 1);
            in_preload_item = false;
            in_pipeline_item = false;
            continue;
        }

        // Preload list item start
        if (trimmed.substr(0, 2) == "- " && section == "models" && subsection == "preload") {
            if (in_preload_item && !current_preload.id.empty()) {
                cfg.preload_models.push_back(current_preload);
            }
            current_preload = {};
            in_preload_item = true;
            // Parse "- id: xxx"
            auto rest = trim(trimmed.substr(2));
            auto colon = rest.find(':');
            if (colon != std::string::npos) {
                auto key = trim(rest.substr(0, colon));
                auto val = unquote(trim(rest.substr(colon + 1)));
                if (key == "id") current_preload.id = val;
                else if (key == "path") current_preload.path = val;
                else if (key == "type") current_preload.type = val;
                else if (key == "postprocess_json") current_preload.postprocess_json = val;
            }
            continue;
        }

        // Continuation of preload item
        if (in_preload_item && indent >= 6) {
            auto colon = trimmed.find(':');
            if (colon != std::string::npos) {
                auto key = trim(trimmed.substr(0, colon));
                auto val = unquote(trim(trimmed.substr(colon + 1)));
                if (key == "id") current_preload.id = val;
                else if (key == "path") current_preload.path = val;
                else if (key == "type") current_preload.type = val;
                else if (key == "postprocess_json") current_preload.postprocess_json = val;
            }
            continue;
        }

        // Auto-infer pipeline list item start
        if (trimmed.substr(0, 2) == "- " && section == "auto_infer" && subsection == "pipelines") {
            if (in_pipeline_item && !current_pipeline.model_id.empty()) {
                cfg.auto_infer_pipelines.push_back(current_pipeline);
            }
            current_pipeline = {};
            in_pipeline_item = true;
            auto rest = trim(trimmed.substr(2));
            auto colon = rest.find(':');
            if (colon != std::string::npos) {
                auto key = trim(rest.substr(0, colon));
                auto val = unquote(trim(rest.substr(colon + 1)));
                if (key == "model_id") current_pipeline.model_id = val;
                else if (key == "stream_id") current_pipeline.stream_id = val;
                else if (key == "fps") current_pipeline.fps = std::stoul(val);
            }
            continue;
        }

        // Continuation of pipeline item
        if (in_pipeline_item && indent >= 6) {
            auto colon = trimmed.find(':');
            if (colon != std::string::npos) {
                auto key = trim(trimmed.substr(0, colon));
                auto val = unquote(trim(trimmed.substr(colon + 1)));
                if (key == "model_id") current_pipeline.model_id = val;
                else if (key == "stream_id") current_pipeline.stream_id = val;
                else if (key == "fps") current_pipeline.fps = std::stoul(val);
            }
            continue;
        }

        // Key: value pair
        auto colon = trimmed.find(':');
        if (colon == std::string::npos) continue;
        auto key = trim(trimmed.substr(0, colon));
        auto val = unquote(trim(trimmed.substr(colon + 1)));
        if (val.empty()) continue;

        // Route to config fields
        if (section == "service") {
            if (key == "name")      cfg.service_name = val;
            else if (key == "listen")    cfg.listen_address = val;
            else if (key == "log_level") cfg.log_level = val;
            else if (key == "log_file")  cfg.log_file = val;
        } else if (section == "hal") {
            if (key == "library_path") cfg.hal_library_path = val;
            else if (key == "device_path") cfg.hal_device_path = val;
            else if (key == "platform_config" && (val == "|" || val == ">")) {
                // Start block scalar collection
                block_key = "platform_config";
                block_content.clear();
                block_indent = indent;
            }
        } else if (section == "models") {
            if (key == "repository_path") cfg.model_repository_path = val;
            else if (key == "cache_path") cfg.model_cache_path = val;
        } else if (section == "scheduler") {
            if (subsection == "default_session") {
                if (key == "max_qps")    cfg.default_session_max_qps = std::stoul(val);
                else if (key == "priority") cfg.default_session_priority = std::stoul(val);
            } else {
                if (key == "queue_size")              cfg.scheduler_queue_size = std::stoul(val);
                else if (key == "timeout_ms")         cfg.scheduler_timeout_ms = std::stoul(val);
                else if (key == "global_qps_limit")   cfg.global_qps_limit = std::stoul(val);
                else if (key == "global_concurrent_limit") cfg.scheduler_workers = std::stoul(val);
            }
        } else if (section == "postprocess") {
            if (key == "workers")         cfg.postprocess_workers = std::stoul(val);
            else if (key == "queue_size") cfg.postprocess_queue_size = std::stoul(val);
        } else if (section == "fd_receiver") {
            if (key == "socket_path") cfg.fd_socket_path = val;
        } else if (section == "performance") {
            if (key == "device_mode") cfg.device_mode = val;
        } else if (section == "event_bus") {
            if (key == "enabled")              cfg.event_bus_enabled = (val == "true");
            else if (key == "endpoint")        cfg.event_bus_endpoint = val;
            else if (key == "auto_publish_results") cfg.event_bus_auto_publish = (val == "true");
            else if (key == "result_topic_prefix")  cfg.event_bus_result_topic_prefix = val;
        } else if (section == "auto_infer") {
            if (key == "enabled") cfg.auto_infer_enabled = (val == "true");
        }
    }

    // Flush pending block scalar (in case file ended while in block)
    if (!block_key.empty() && section == "hal" && block_key == "platform_config") {
        cfg.hal_platform_config = block_content;
    }

    // Flush last preload item
    if (in_preload_item && !current_preload.id.empty()) {
        cfg.preload_models.push_back(current_preload);
    }

    // Flush last pipeline item
    if (in_pipeline_item && !current_pipeline.model_id.empty()) {
        cfg.auto_infer_pipelines.push_back(current_pipeline);
    }

    return cfg;
}

std::string parse_unix_address(const std::string& addr) {
    const std::string prefix = "unix://";
    if (addr.compare(0, prefix.size(), prefix) == 0) {
        return addr.substr(prefix.size());
    }
    return addr;
}

}  // namespace aipc::ai_runtime
