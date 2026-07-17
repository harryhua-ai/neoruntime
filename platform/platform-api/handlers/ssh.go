package handlers

import (
	"bufio"
	"fmt"
	"os"
	"os/exec"
	"strings"

	eventLoggerPkg "aipc/platform/common/events"
	"github.com/gin-gonic/gin"
)

// SSHHandler handles SSH configuration management.
type SSHHandler struct {
	configPath  string
	eventLogger *eventLoggerPkg.Logger
}

// NewSSHHandler creates a new SSHHandler.
func NewSSHHandler(eventLogger *eventLoggerPkg.Logger) *SSHHandler {
	return &SSHHandler{
		configPath:  "/etc/ssh/sshd_config",
		eventLogger: eventLogger,
	}
}

// SetEventLogger sets the event logger (for dependency injection)
func (h *SSHHandler) SetEventLogger(logger *eventLoggerPkg.Logger) {
	h.eventLogger = logger
}

// GetConfig reads and returns the current sshd configuration.
func (h *SSHHandler) GetConfig(c *gin.Context) {
	config, err := h.parseSSHConfig()
	if err != nil {
		Resp(c).FailMsg(CodeSSHConfigError, err.Error())
		return
	}
	Resp(c).OK(gin.H{"config": config})
}

// SetConfig updates sshd configuration and optionally restarts the service.
func (h *SSHHandler) SetConfig(c *gin.Context) {
	var req struct {
		Port            string `json:"port"`
		PermitRootLogin string `json:"permit_root_login"`
		PasswordAuth    string `json:"password_authentication"`
		PubkeyAuth      string `json:"pubkey_authentication"`
		MaxAuthTries    string `json:"max_auth_tries"`
		RestartService  bool   `json:"restart_service"`
	}

	if err := c.ShouldBindJSON(&req); err != nil {
		Resp(c).FailMsg(CodeInvalidRequest, err.Error())
		return
	}

	// Read current config
	content, err := os.ReadFile(h.configPath)
	if err != nil {
		Resp(c).FailMsg(CodeSSHConfigError, "Failed to read sshd_config: "+err.Error())
		return
	}

	lines := strings.Split(string(content), "\n")
	updates := map[string]string{}
	if req.Port != "" {
		updates["Port"] = req.Port
	}
	if req.PermitRootLogin != "" {
		updates["PermitRootLogin"] = req.PermitRootLogin
	}
	if req.PasswordAuth != "" {
		updates["PasswordAuthentication"] = req.PasswordAuth
	}
	if req.PubkeyAuth != "" {
		updates["PubkeyAuthentication"] = req.PubkeyAuth
	}
	if req.MaxAuthTries != "" {
		updates["MaxAuthTries"] = req.MaxAuthTries
	}

	// Apply updates to lines
	applied := map[string]bool{}
	for i, line := range lines {
		trimmed := strings.TrimSpace(line)
		for key, val := range updates {
			if strings.HasPrefix(trimmed, key+" ") || strings.HasPrefix(trimmed, "#"+key+" ") || strings.HasPrefix(trimmed, "# "+key+" ") {
				lines[i] = key + " " + val
				applied[key] = true
				break
			}
		}
	}

	// Append any un-applied settings
	for key, val := range updates {
		if !applied[key] {
			lines = append(lines, key+" "+val)
		}
	}

	// Write back
	if err := os.WriteFile(h.configPath, []byte(strings.Join(lines, "\n")), 0644); err != nil {
		Resp(c).FailMsg(CodeSSHConfigError, "Failed to write sshd_config: "+err.Error())
		return
	}

	result := gin.H{"status": "updated", "changes": updates}

	// Restart sshd if requested
	restarted := false
	if req.RestartService {
		if err := exec.Command("systemctl", "restart", "sshd").Run(); err != nil {
			result["restart_error"] = err.Error()
		} else {
			result["restarted"] = true
			restarted = true
		}
	}

	if h.eventLogger != nil {
		h.eventLogger.LogWithCodeAsync(
			"ssh.config.changed",
			eventLoggerPkg.MessageParams{
				"changes":   fmt.Sprint(updates),
				"restarted": restarted,
			},
			getUsernameFromContext(c),
		)
	}

	Resp(c).OK(result)
}

// GetStatus returns the sshd service status.
func (h *SSHHandler) GetStatus(c *gin.Context) {
	out, err := exec.Command("systemctl", "is-active", "sshd").Output()
	status := strings.TrimSpace(string(out))
	if err != nil {
		// Try "ssh" service name (Debian/Ubuntu)
		out, err = exec.Command("systemctl", "is-active", "ssh").Output()
		status = strings.TrimSpace(string(out))
		if err != nil {
			status = "unknown"
		}
	}

	Resp(c).OK(gin.H{"status": status})
}

// GetLogs returns recent SSH login log entries.
func (h *SSHHandler) GetLogs(c *gin.Context) {
	// Try journalctl first
	out, err := exec.Command("journalctl", "-u", "sshd", "--no-pager", "-n", "50", "--output=short").Output()
	if err != nil {
		out, err = exec.Command("journalctl", "-u", "ssh", "--no-pager", "-n", "50", "--output=short").Output()
	}

	var logs []string
	if err == nil {
		lines := strings.Split(string(out), "\n")
		for _, line := range lines {
			if strings.TrimSpace(line) != "" {
				logs = append(logs, line)
			}
		}
	} else {
		// Fallback: read /var/log/auth.log
		f, err := os.Open("/var/log/auth.log")
		if err != nil {
			Resp(c).OK(gin.H{"logs": []string{}, "error": "Unable to read SSH logs"})
			return
		}
		defer f.Close()

		scanner := bufio.NewScanner(f)
		var allLines []string
		for scanner.Scan() {
			line := scanner.Text()
			if strings.Contains(line, "sshd") {
				allLines = append(allLines, line)
			}
		}
		// Last 50 lines
		if len(allLines) > 50 {
			allLines = allLines[len(allLines)-50:]
		}
		logs = allLines
	}

	Resp(c).OK(gin.H{"logs": logs})
}

// parseSSHConfig reads and parses sshd_config into a map.
func (h *SSHHandler) parseSSHConfig() (map[string]string, error) {
	f, err := os.Open(h.configPath)
	if err != nil {
		return nil, fmt.Errorf("cannot open %s: %w", h.configPath, err)
	}
	defer f.Close()

	config := make(map[string]string)
	scanner := bufio.NewScanner(f)
	for scanner.Scan() {
		line := strings.TrimSpace(scanner.Text())
		if line == "" || strings.HasPrefix(line, "#") {
			continue
		}
		parts := strings.SplitN(line, " ", 2)
		if len(parts) == 2 {
			config[parts[0]] = strings.TrimSpace(parts[1])
		}
	}
	return config, scanner.Err()
}
