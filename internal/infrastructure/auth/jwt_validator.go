package auth

import (
	"context"
	"fmt"
	"time"

	"github.com/MicahParks/keyfunc/v3"
	"github.com/golang-jwt/jwt/v5"
	"github.com/google/uuid"
)

// Claims represents the JWT claims from Supabase auth tokens
type Claims struct {
	Sub   string `json:"sub"`   // User ID (UUID format from Supabase)
	Email string `json:"email"` // Optional email
	jwt.RegisteredClaims
}

// UserID extracts and parses the UUID from the sub claim
func (c *Claims) UserID() (uuid.UUID, error) {
	return uuid.Parse(c.Sub)
}

// JWTValidator validates JWT tokens using JWKS from Supabase
type JWTValidator struct {
	kf     keyfunc.Keyfunc
	cancel context.CancelFunc
}

// JWTValidatorConfig holds configuration for JWT validation
type JWTValidatorConfig struct {
	JWKSURL       string        // JWKS endpoint URL
	RefreshPeriod time.Duration // How often to refresh JWKS (default: 1 hour)
}

// NewJWTValidator creates a new JWT validator with JWKS auto-refresh
func NewJWTValidator(ctx context.Context, cfg *JWTValidatorConfig) (*JWTValidator, error) {
	if cfg == nil || cfg.JWKSURL == "" {
		return nil, fmt.Errorf("auth: JWKS URL is required")
	}

	// Set default refresh period if not specified
	refreshPeriod := cfg.RefreshPeriod
	if refreshPeriod == 0 {
		refreshPeriod = time.Hour
	}

	// Create a cancellable context for the JWKS background refresh
	jwksCtx, cancel := context.WithCancel(ctx)

	override := keyfunc.Override{
		RefreshInterval: refreshPeriod,
	}

	// Configure JWKS with automatic refresh
	// The keyfunc library handles:
	// - Initial fetch on startup
	// - Background refresh at specified interval
	// - Automatic caching of keys
	kf, err := keyfunc.NewDefaultOverrideCtx(jwksCtx, []string{cfg.JWKSURL}, override)
	if err != nil {
		cancel()
		return nil, fmt.Errorf("auth: failed to create JWKS keyfunc: %w", err)
	}

	return &JWTValidator{
		kf:     kf,
		cancel: cancel,
	}, nil
}

// ValidateToken validates a JWT token and returns the claims
func (v *JWTValidator) ValidateToken(ctx context.Context, tokenString string) (*Claims, error) {
	if tokenString == "" {
		return nil, fmt.Errorf("auth: token is empty")
	}

	// Parse and validate the token
	token, err := jwt.ParseWithClaims(tokenString, &Claims{}, func(token *jwt.Token) (interface{}, error) {
		// Get the key from JWKS - it will validate the signing method matches the key type
		// Supports RSA (RS256/384/512), ECDSA (ES256/384/512), EdDSA and other algorithms
		// as long as they're properly configured in JWKS
		return v.kf.KeyfuncCtx(ctx)(token)
	})

	if err != nil {
		return nil, fmt.Errorf("auth: failed to parse token: %w", err)
	}

	if !token.Valid {
		return nil, fmt.Errorf("auth: token is invalid")
	}

	claims, ok := token.Claims.(*Claims)
	if !ok {
		return nil, fmt.Errorf("auth: failed to extract claims")
	}

	// Validate that sub claim exists and is valid UUID
	if claims.Sub == "" {
		return nil, fmt.Errorf("auth: sub claim is missing")
	}

	_, err = claims.UserID()
	if err != nil {
		return nil, fmt.Errorf("auth: invalid UUID in sub claim: %w", err)
	}

	return claims, nil
}

// Close stops the JWKS background refresh and cleans up resources
func (v *JWTValidator) Close() error {
	if v.cancel != nil {
		v.cancel()
	}
	return nil
}
