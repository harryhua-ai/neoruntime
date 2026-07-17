package handlers

import (
	"github.com/gin-gonic/gin"

	"aipc/platform/common/events"
)

type LoginRequest struct {
	Username string `json:"username" binding:"required"`
	Password string `json:"password" binding:"required"`
}

// Login handles user authentication and token issuing
func (h *APIHandlers) Login(c *gin.Context) {
	var req LoginRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		Resp(c).FailMsg(CodeInvalidRequest, "Invalid input format")
		return
	}

	// In the event that no username/password is configured, fallback to basic security
	expectedUser := h.authUser
	if expectedUser == "" {
		expectedUser = "admin"
	}
	expectedPass := h.authPass
	if expectedPass == "" {
		expectedPass = "admin"
	}
	// tokenKey is populated by main.go at startup (env override or a
	// randomly generated boot secret). An empty value here means auth was
	// misconfigured; refuse to mint a token rather than silently falling back
	// to a hardcoded secret.
	secret := h.tokenKey
	if secret == "" {
		if h.eventLogger != nil {
			h.eventLogger.LogWithCodeAsync(
				string(events.EventUserLoginFailed),
				events.MessageParams{"username": req.Username, "ip": c.ClientIP(), "reason": "token_key_unconfigured"},
				req.Username,
			)
		}
		Resp(c).FailMsg(CodeUnauthorized, "Auth not initialized; set AIPC_TOKEN_KEY")
		return
	}

	if req.Username != expectedUser || req.Password != expectedPass {
		// Log failed login attempt
		if h.eventLogger != nil {
			h.eventLogger.LogWithCodeAsync(
				string(events.EventUserLoginFailed),
				events.MessageParams{"username": req.Username, "ip": c.ClientIP(), "reason": "invalid_credentials"},
				req.Username,
			)
		}
		Resp(c).FailMsg(CodeUnauthorized, "Invalid username or password")
		return
	}

	// For simplicity with this embedded single-user system, use the static configured tokenKey as the Bearer token
	// This ensures that the Frontend will send "Bearer <tokenKey>"
	// and auth.go will validate it easily without expiring logic.
	tokenStr := "Bearer " + secret

	// Log successful login
	if h.eventLogger != nil {
		h.eventLogger.LogWithCodeAsync(
			string(events.EventUserLoginSuccess),
			events.MessageParams{"username": req.Username, "ip": c.ClientIP()},
			req.Username,
		)
	}

	// Reply matching what frontend expects
	Resp(c).OK(map[string]interface{}{
		"token":    tokenStr,
		"username": req.Username,
	})
}
