Feature: Catalog
  The public dictionary: entries, senses, forms, and relations, shown only as far
  as their facts are published, in a learner's shape. Lookups are exact; there
  are no fallbacks.

  @catalog/entry-read @api
  Scenario: Read a reviewed entry
    Given an entry whose entry, sense, form, example, and relation facts are published
    When anyone requests the entry by its lemma
    Then the API returns the entry with its senses grouped into meanings and no review metadata
    And with include=review each published claim carries its fact id, confidence, and verdict

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

  @catalog/usage-facts @domain
  Scenario: Grammar, word formation, and collocations are part of the public entry
    Given an entry with published, pending, and rejected grammar, morphology, and collocation facts
    When the public view is built
    Then the entry shows its published word formation, each sense its published grammar (with its patterns and named prepositions as lists) and collocations, each with its review, and null or empty when none is published

  @catalog/usage-facts-api @api
  Scenario: Grammar, word formation, and collocations are reviewed and published through the queue
    Given an agent submits grammar and a collocation about a verb sense and a word formation about its entry
    When the queue consumer reviews them
    Then Jev answers one question per grammar property, pattern, and named preposition, the LLM judges the collocation, and the public entry and sense show all three

  @catalog/sense-order @domain
  Scenario: Senses come in the order of the published sense list
    Given an entry with a published sense list, a pending correction, and a sense the list does not name
    When the public view is built
    Then each part of speech is a meaning, in the order of its first sense, and its senses come common in list order, then extra marked rare, then the unnamed ones, and the entry's review carries the published list

  @catalog/meaning-shape @domain
  Scenario: An entry reads as a learner's dictionary entry
    Given an entry with pronunciations with and without a part of speech, inflections, variants, and labelled senses of two parts of speech
    When the public view is built
    Then the default pronunciations are on the entry and the ones particular to a part of speech on its meaning, weak forms marked weak
    And each meaning lists its inflections by type, a type with several forms listing each, variants are on the entry, and a form of a part of speech no public sense has is not shown
    And each sense carries its register as labels

  @catalog/relation-groups @domain
  Scenario: Relations are grouped by what they say about the sense
    Given synonym, antonym, hypernym, and part-of relations with the sense at either end
    When the public view is built
    Then synonyms and antonyms show on both senses, a hypernym is broader on its subject and narrower on its target, and a part-of is part_of on its subject and parts on its target
    And each related sense carries its lemma, id, and gloss

  @catalog/language @domain
  Scenario: A read shows one language
    Given senses with translations in two languages and a topic with names in two languages
    When a read asks for one language, a longer tag of it, all, a language with no translation, or none
    Then translations are a list in that language, keyed by language for all, empty for a language with none, and absent for none, never another language
    And topic names carry English and the requested language, and summaries the first sense's first translation in it

  @catalog/review-metadata @domain
  Scenario: Review metadata appears only when asked for
    Given a public entry
    When it is read with and without include=review
    Then without it no fact id, confidence, or verdict appears, and with it every published claim the entry shows carries its own

  @catalog/summary @domain
  Scenario: Lists show summaries
    Given public entries with and without senses, CEFR levels, and translations
    When their summaries and the summaries of their tagged senses are built
    Then an entry summary has its lemma, the parts of speech of its meanings, its lowest CEFR level, and its first sense's gloss and translation
    And a sense summary has its id, part of speech, the CEFR level of that part of speech, and its gloss and translation

  @catalog/accept-language @usecase
  Scenario: The language comes from the query or Accept-Language
    Given requests with lang, with Accept-Language, with both, and with neither
    When the read variant is resolved
    Then lang wins, else the preferred language tag of Accept-Language by quality, ignoring * and q=0, else none

  @catalog/visibility @domain
  Scenario: Only published facts are visible
    Given an entry with published, pending, and rejected facts
    When the public view is built
    Then only the published facts appear, each with its review

  @catalog/relation-visibility @domain
  Scenario: A relation is visible only when both of its senses are
    Given a published relation whose target sense or target entry is not published
    When the public view is built
    Then the relation does not appear

  @catalog/form-lookup @usecase
  Scenario: Look up an entry by an exact published form
    Given a published plural form "banks" of "bank"
    When anyone looks up the form "banks"
    Then the result is the summary of "bank" with the form type and part of speech that matched

  @catalog/form-lookup-api @api
  Scenario: Form lookup over HTTP
    Given a published form fact
    When anyone requests the form endpoint
    Then the API returns each owning entry as a summary with the forms that matched, and 404 for a form no entry claims

  @catalog/search @api
  Scenario: Page through entries by prefix
    Given more published entries with a prefix than fit on one page
    When a client follows next_cursor
    Then every matching entry is returned exactly once in lemma order as a summary, and a broken cursor is rejected

  @catalog/create-entry @usecase
  Scenario: Creating an entry is idempotent by lemma
    Given an agent creates the entry "ice cream"
    When it creates the same lemma again
    Then the existing entry and its live entry fact are returned and nothing new is enqueued

  @catalog/create-entry-seed @usecase
  Scenario: Creating an entry with seed marks it as a seed entry
    Given entries created without seed
    When an agent creates a new entry with seed true, creates an existing entry with seed true, and creates a seed entry again with seed false or without seed
    Then both entries are seed entries and the repeated creates leave the mark as it was

  @catalog/import-core @usecase
  Scenario: The core import creates entries for the CEFR headwords that have none
    Given CEFR headwords of several levels, one of them already an entry, and the single letters "a", "I", and "x"
    When an admin runs the core import a few entries at a time until nothing remains, and once more
    Then each headword without an entry becomes a seed entry the admin created, lowest level first, its entry fact pending and queued for review
    And "x" is skipped and reported, the existing entry is left as it was, and the last run creates nothing

  @catalog/import-core-api @api
  Scenario: Only an admin runs the core import over HTTP
    Given imported CEFR levels and an entry an agent created for one of the headwords
    When an agent and then an admin call the core import, one entry per call
    Then the agent gets 403, the admin's calls create the missing entries and report the skipped single letter and what remains
    And the created entries are seed entries, and the worklist orders them with the agent's entry by level and frequency, not by the seed mark

  @catalog/create-sense @usecase
  Scenario: Creating a sense submits its gloss as a fact
    Given an entry
    When an agent creates a sense with a POS and gloss
    Then the sense and a pending sense fact exist, and repeating the call returns them

  @catalog/create-sense-register @usecase
  Scenario: A register does not make a second sense
    Given a sense with a gloss
    When an agent creates a sense of the same entry and POS with that gloss and a register
    Then it returns the existing sense unchanged, and a register goes on an existing sense through a correction

  @catalog/create-sense-register-api @api
  Scenario: Creating a known gloss with a register over HTTP
    Given an entry
    When an agent creates the same gloss with and without a register at once, then again with another register
    Then every call returns one sense, and the public entry lists that gloss once

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

  @catalog/manage-entry-list @api
  Scenario: Management lists entries in every status with their progress
    Given entries with pending, published, and retracted facts, one of them worked by an agent
    When an agent pages through the entries by prefix
    Then each page lists entries in lemma order with the entry status, live sense count, fact counts by status, and last worked time

  @catalog/manage-entry-list-index @api
  Scenario: Listing entries reads only the page
    Given the statements behind one page of entry summaries
    When their query plans are read
    Then each one searches an index from the page's entries and none reads every live fact of a kind

  @catalog/locate-node @api
  Scenario: Management resolves a node id to its entry
    Given an entry with a sense
    When management asks for the node behind the entry id, the sense id, or an unknown id
    Then it gets the owning entry's id and lemma for both, and 404 for the unknown id
