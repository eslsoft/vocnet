Feature: Console
  Admins watch the dictionary through the console: what agents submitted, how
  review judged it, and what was published with flaws.

  @console/overview @web
  Scenario: The overview counts facts by kind and status
    Given facts in several kinds and statuses and open feedback
    When the admin opens the overview
    Then every kind and status has a count that opens the matching facts
    And the open feedback count links to open feedback

  @console/forbidden @web
  Scenario: A signed-in user who is not an admin sees why nothing loads
    Given the management API answers 403
    When the user opens the overview
    Then the server's message is shown at once
    And the console does not retry the request

  @console/facts-browse @web
  Scenario: Browse facts by status and kind, page by page
    Given more facts than one page
    When the admin filters by status and kind and loads more
    Then only matching facts are listed, each page appended to the last

  @console/flagged-facts @web
  Scenario: Facts published with flaws stand out
    Given published facts reviewed as pass, uncertain, and pass with low confidence
    When the admin browses facts
    Then the uncertain and low-confidence facts are marked as flagged and tinted

  @console/fact-detail @web
  Scenario: A fact's drawer shows its payload, review, correction, and entry
    Given a correction that supersedes a published fact
    When the admin opens the correction
    Then the drawer shows the payload, author, reviewer, verdict, confidence, and reason
    And it links to the owning entry and opens the superseded fact

  @console/fact-actions @web
  Scenario: Retract and re-review from the drawer
    Given a published fact and a rejected fact
    When the admin retracts the first and re-reviews the second
    Then each shows its new status without a reload
    And actions the lifecycle forbids are disabled

  @console/fact-action-error @web
  Scenario: A refused action shows the server's reason where the admin acted
    Given the server refuses a re-review
    When the admin re-reviews a fact
    Then the drawer shows the server's message

  @console/entry-list @web
  Scenario: Watch every entry's progress, page by page
    Given more entries than one page, in several statuses, one worked by an agent
    When the admin opens the entries page and loads more
    Then each entry shows its status, live senses, published, pending, and rejected counts, and when it was last worked
    And each page is appended in lemma order, and clicking an entry opens its inspector

  @console/entry-list-filter @web
  Scenario: Narrow the entry list by lemma prefix
    Given entries with different lemmas
    When the admin types a prefix and pauses
    Then the URL keeps the prefix and only entries starting with it are listed
    And a prefix nothing matches says so, and clearing it lists every entry again

  @console/entry-inspector @web
  Scenario: Inspect an entry with every fact in every status
    Given an entry with senses whose facts are pending, published, rejected, and uncertain
    When the admin opens the entry
    Then each sense shows its gloss and its facts with their statuses, and incoming relations are listed
    And an unknown lemma shows the server's not-found message

  @console/feedback @web
  Scenario: Browse feedback read-only with links to what it is about
    Given open and resolved feedback about a fact and an entry
    When the admin filters by status and opens an item
    Then the detail shows the message, assignee, and resolution without any resolve control
    And it links to the target fact or entry and to the correcting facts

  @console/agent-issue @critical @web
  Scenario: Issue an agent key and see it exactly once
    When the admin issues a key for a named agent
    Then the key is shown once with a copy button and the agent is listed as active
    And reopening the dialog shows an empty form, not the key

  @console/agent-revoke @web
  Scenario: Revoke an agent after confirming
    Given an active agent
    When the admin confirms its revocation
    Then the agent is listed as revoked and can no longer be revoked
