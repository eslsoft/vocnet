Feature: Agents
  Admins register the agents that maintain the dictionary.

  @agents/issue @usecase
  Scenario: Issue an agent key
    When an admin issues a key for a named agent
    Then the key is returned once and only its SHA-256 hash is stored

  @agents/revoke @usecase
  Scenario: Revoke an agent key
    Given an issued key
    When an admin revokes it, twice
    Then the agent is revoked at the first revocation time

  @agents/admin-only @api
  Scenario: Agent administration is for admins only
    Given an agent key
    When it lists agents
    Then the API responds 403, and an admin can revoke the key so it stops working
