package auth

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"net/http"
	"strings"
	"time"

	"aipc/platform/common/logger"
	"github.com/gin-gonic/gin"
)

// TokenValidator validates authentication tokens
type TokenValidator struct {
	tokenKey     string
	enabled      bool
	allowedPaths []string // Paths that don't require authentication
}

// NewTokenValidator creates a new token validator
func NewTokenValidator(tokenKey string, enabled bool) *TokenValidator {
	return &TokenValidator{
		tokenKey: tokenKey,
		enabled:  enabled,
		allowedPaths: []string{
			"/api/v1/system/health", // Health check doesn't need auth
		},
	}
}

// ValidateToken validates an authentication token
// Supports two modes:
// 1. Simple token match (if tokenKey is set)
// 2. HMAC-based token validation (if tokenKey is used as secret)
func (v *TokenValidator) ValidateToken(token string) bool {
	if !v.enabled {
		return true
	}

	if token == "" {
		return false
	}

	// Simple token match (for basic API key authentication)
	if v.tokenKey != "" {
		// If token matches the configured key, accept it
		if token == v.tokenKey {
			return true
		}

		// Also support Bearer token format
		if strings.HasPrefix(token, "Bearer ") {
			token = strings.TrimPrefix(token, "Bearer ")
			if token == v.tokenKey {
				return true
			}
		}

		// Support HMAC-based token (optional, for more secure tokens)
		// Format: timestamp:hmac(secret, timestamp)
		parts := strings.Split(token, ":")
		if len(parts) == 2 {
			timestamp := parts[0]
			expectedHMAC := parts[1]

			// Validate timestamp (within 5 minutes)
			var ts int64
			if _, err := fmt.Sscanf(timestamp, "%d", &ts); err == nil {
				now := time.Now().Unix()
				if ts > now-300 && ts < now+300 { // 5 minute window
					// Compute HMAC
					mac := hmac.New(sha256.New, []byte(v.tokenKey))
					mac.Write([]byte(timestamp))
					computedHMAC := hex.EncodeToString(mac.Sum(nil))

					if hmac.Equal([]byte(expectedHMAC), []byte(computedHMAC)) {
						return true
					}
				}
			}
		}
	}

	return false
}

// extractToken extracts token from request headers or query parameters
func (v *TokenValidator) extractToken(c *gin.Context) string {
	// Try Authorization header first
	authHeader := c.GetHeader("Authorization")
	if authHeader != "" {
		if strings.HasPrefix(authHeader, "Bearer ") {
			return strings.TrimPrefix(authHeader, "Bearer ")
		}
		return authHeader
	}

	// For WebSocket connections, also check query parameters
	if token := c.Query("token"); token != "" {
		return token
	}

	// Try X-API-Key header
	apiKey := c.GetHeader("X-API-Key")
	if apiKey != "" {
		return apiKey
	}

	return ""
}

// isAllowedPath checks if the path is in the allowed list
func (v *TokenValidator) isAllowedPath(path string) bool {
	for _, allowed := range v.allowedPaths {
		if path == allowed {
			return true
		}
	}
	return false
}

// Middleware creates an authentication middleware for Gin
func Middleware(validator *TokenValidator) gin.HandlerFunc {
	return func(c *gin.Context) {
		// If auth is disabled, allow all requests
		if !validator.enabled {
			c.Next()
			return
		}

		// Check if path is in allowed list
		if validator.isAllowedPath(c.Request.URL.Path) {
			c.Next()
			return
		}

		// Extract and validate token
		token := validator.extractToken(c)
		if !validator.ValidateToken(token) {
			logger.Warn("Unauthorized access attempt from %s to %s", c.ClientIP(), c.Request.URL.Path)
			c.Header("WWW-Authenticate", "Bearer")
			c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{
				"code":    2000, // CodeUnauthorized
				"message": "Unauthorized",
				"error": gin.H{
					"type":   "auth",
					"detail": "Invalid or missing authentication token",
				},
			})
			return
		}

		// Token is valid, proceed
		c.Next()
	}
}
