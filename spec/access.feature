Feature: Access
  The dictionary is public. Management is for registered agents and admins.

  @access/console-login @critical @e2e
  Scenario: An admin signs in to the console through OIDC
    Given an unauthenticated browser
    When the admin signs in through the configured OIDC provider
    Then the console home opens

  @access/public @api
  Scenario: The public API and its documentation need no credential
    When anyone calls /v1 or fetches /openapi.json
    Then the API answers without authentication

  @access/manage-401 @api
  Scenario: Management requires a valid credential
    Given no credential, an invalid token, or an unknown agent key
    When it calls the management API
    Then the API responds 401

  @access/malformed-token @usecase
  Scenario: A token that is not a JWT is refused without contacting the issuer
    Given the OIDC issuer is unreachable
    When a caller presents a bearer token that is not a structurally valid JWT
    Then the credential is invalid (401); a well-formed token still fails as a provider error (500)

  @access/manage-403 @api
  Scenario: Only admin subjects may use OIDC tokens on the management API
    Given a valid OIDC token whose subject is not in ADMIN_SUBJECTS
    When it calls the management API
    Then the API responds 403

  @access/admin-subjects @usecase
  Scenario: Admins are the configured OIDC subjects
    Given ADMIN_SUBJECTS lists an OIDC subject
    When a token for that subject is presented
    Then the caller is an admin

  @access/agent-key @usecase
  Scenario: Agent keys authenticate until revoked
    Given an issued agent key
    When it is presented before and after revocation
    Then it authenticates the agent, then is rejected

  @access/agent-key-api @api
  Scenario: An agent learns the management API from its OpenAPI document
    Given an issued agent key
    When the agent calls the management API and fetches /manage/openapi.json
    Then both succeed
