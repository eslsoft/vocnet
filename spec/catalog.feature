Feature: Catalog
  The public dictionary: entries, senses, forms, and relations, shown only as far
  as their facts are published. Lookups are exact; there are no fallbacks.

  @catalog/entry-read @api
  Scenario: Read a reviewed entry
    Given an entry whose entry, sense, form, example, and relation facts are published
    When anyone requests the entry by its lemma
    Then the API returns the entry with each published fact, its confidence, and its verdict

  @catalog/entry-not-found @api
  Scenario: Unknown or unpublished items are not found
    Given a lemma, form, or sense that does not exist or is not yet published
    When anyone requests it
    Then the API responds 404 with the not_found code

  @catalog/no-fallback @usecase
  Scenario: A lemma lookup never falls back to a similar lemma
    Given a published entry "bank"
    When anyone requests "banks" or "Bank"
    Then the lookup is not found instead of returning "bank"

  @catalog/visibility @domain
  Scenario: Only published facts are visible
    Given an entry with published, pending, and rejected facts
    When the public view is built
    Then only the published facts appear, each with its id, confidence, and verdict

  @catalog/relation-visibility @domain
  Scenario: A relation is visible only when both of its senses are
    Given a published relation whose target sense or target entry is not published
    When the public view is built
    Then the relation does not appear

  @catalog/form-lookup @usecase
  Scenario: Look up an entry by an exact published form
    Given a published plural form "banks" of "bank"
    When anyone looks up the form "banks"
    Then the result names the entry "bank" and the form fact

  @catalog/form-lookup-api @api
  Scenario: Form lookup over HTTP
    Given a published form fact
    When anyone requests the form endpoint
    Then the API returns the owning entries, and 404 for a form no entry claims

  @catalog/search @api
  Scenario: Page through entries by prefix
    Given more published entries with a prefix than fit on one page
    When a client follows next_cursor
    Then every matching entry is returned exactly once in lemma order, and a broken cursor is rejected

  @catalog/create-entry @usecase
  Scenario: Creating an entry is idempotent by lemma
    Given an agent creates the entry "ice cream"
    When it creates the same lemma again
    Then the existing entry and its live entry fact are returned and nothing new is enqueued

  @catalog/create-sense @usecase
  Scenario: Creating a sense submits its gloss as a fact
    Given an entry
    When an agent creates a sense with a POS and gloss
    Then the sense and a pending sense fact exist, and repeating the call returns them

  @catalog/create-sense-race @api
  Scenario: Concurrent identical sense creations make one sense
    Given an entry
    When two identical create-sense requests arrive at the same time
    Then both return the same sense and gloss fact, and the entry has one sense

  @catalog/manage-entry @api
  Scenario: Management sees every fact in every status
    Given an entry with pending facts
    When an agent requests the entry through the management API
    Then every fact about the entry and its senses is returned with its status

  @catalog/locate-node @api
  Scenario: Management resolves a node id to its entry
    Given an entry with a sense
    When management asks for the node behind the entry id, the sense id, or an unknown id
    Then it gets the owning entry's id and lemma for both, and 404 for the unknown id
