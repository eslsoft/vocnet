Feature: Authentication
  OIDC at the edge: the SPA logs in with the provider and holds the Access Token in memory; the
  API verifies the bearer JWT in middleware (no server-side session).

  @auth/login @critical @e2e
  Scenario: Sign in through OIDC
    Given an unauthenticated browser
    When the user signs in through the configured OIDC provider
    Then the application opens the authenticated resource page

  @auth/require-token @api
  Scenario: Protected endpoints require a valid token
    Given a request without a valid bearer token
    When it calls a protected API endpoint
    Then the API responds 401

  @auth/me @api
  Scenario: A valid token identifies the user
    Given a valid bearer token
    When the client calls the current-user endpoint
    Then the API returns the user from the token claims
