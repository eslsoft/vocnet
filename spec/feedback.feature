Feature: Feedback
  Anyone reports a problem; agents work through reports one at a time.

  @feedback/submit @usecase
  Scenario: Report a problem with an entry, a sense, or a fact
    Given a publicly visible entry, sense, or fact
    When anyone submits feedback about it
    Then the feedback is open

  @feedback/public-target @usecase
  Scenario: Only what the public API shows can be reported
    Given an entry, sense, or fact that is missing or not publicly visible
    When anyone submits feedback about it
    Then the API answers 404 not_found and records nothing

  @feedback/rate-limit @api
  Scenario: Each client address may report a few times a minute
    Given a client that sent 10 reports within a minute
    When it sends another
    Then the API answers 429 rate_limited, while another address is still served

  @feedback/claim-lease @usecase
  Scenario: A claim is a one-hour lease
    Given open feedback
    When an agent claims it
    Then no other agent can claim it until the lease expires, and the holder may renew it

  @feedback/lease-api @api
  Scenario: Claim and resolve over HTTP
    Given a public report
    When one agent claims it and another tries to claim or resolve it
    Then the second agent is refused and the holder resolves it with the correcting fact ids

  @feedback/resolve @usecase
  Scenario: The holder resolves or dismisses claimed feedback
    Given feedback claimed by an agent
    When the agent resolves it with fact ids or dismisses it with a note
    Then it is closed, and closing it again returns the same result
