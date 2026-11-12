Feature: Feedback
  Anyone reports a problem with what the public API shows; each report becomes a feedback ticket
  for a curator.

  @feedback/submit @usecase
  Scenario: Report a problem with an entry, a sense, or a fact
    Given a publicly visible entry, sense, or fact
    When anyone submits feedback about it
    Then an open feedback ticket names the target and the message

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

  @feedback/ticket-api @api
  Scenario: A public report opens a feedback ticket on a real database
    Given a public entry, its sense, and a published fact
    When anyone reports each of them, reports the entry again, and reports a pending fact
    Then each report answers 201 with an open ticket, the curator's ticket list shows them as feedback tickets with their entry, the repeat on the entry keeps one open ticket, and the pending fact is 404
