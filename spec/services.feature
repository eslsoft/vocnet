Feature: Services
  A downstream product reads the dictionary through the public API as a named service. An admin
  issues it a service key, stored and hashed as agent keys are. The key identifies the caller and
  moves its reads from the per-address limit to a per-service one; it grants nothing else.

  @services/issue @usecase
  Scenario: Issue a service key
    When an admin issues a key for a named service
    Then the key starts with vn_service_, is returned once, and only its SHA-256 hash is stored

  @services/revoke @usecase
  Scenario: Revoke a service key
    Given an issued service key
    When an admin revokes it, twice
    Then the service is revoked at the first revocation time, and an unknown service is not found

  @services/authenticate @usecase
  Scenario: A service key names its service until revoked
    Given an issued service key
    When it is presented before and after revocation, and an unknown key is presented
    Then it names the service, then is an invalid credential, as the unknown key is
    And it never authenticates on the management API

  @services/read-limit @usecase
  Scenario: A read with a service key is counted per service and needs no client address
    Given a service key and a client address that has used up its reads
    When the service reads with its key as a bearer token, with or without CF-Connecting-IP
    Then the read is served and logged under the service, counted against the service's own allowance
    And once the service used that up the API answers 429 rate_limited with Retry-After
    And a key that names no live service is 401 invalid_credential, never an anonymous read
    And any other Authorization value is no read credential: the read is counted by its address, and one without an address still fails loudly

  @services/read-api @api
  Scenario: A service reads the public API with its key on a real Worker
    Given a service key an admin issued through the management API
    When the service reads /v1 without CF-Connecting-IP, under either rate limit binding, and after revocation
    Then the keyed read is 200 where an anonymous one has no address to count, it is limited by the service binding alone, and the revoked or unknown key is 401
    And the key is 401 on the management API, and only admins list, issue, and revoke services
