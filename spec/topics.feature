Feature: Topics
  Learners find words by topic, a scene or a subject area. A server-maintained, two-level taxonomy
  groups leaf topics ("At the doctor and hospital") under categories ("Body and health"). Agents
  tag senses with leaf topics through topic facts; topics are tags, never relations between words.

  @topics/review-plan @domain
  Scenario: A topic fact asks whether this sense is core vocabulary of that topic
    Given a topic fact on a glossed sense and the leaf topic it names
    When its review is planned
    Then Jev and luna are asked one question with the lemma, part of speech, gloss, topic, category, and the entry's other senses, and their mean score against the mean threshold settles a pass
    And otherwise the LLM decides, with the same context
    And its rubric passes only a sense a learner characteristically meets or needs in the topic, typical vocabulary of that scene or subject area
    And fails a general-purpose sense that merely can appear in the topic, a loose association, or a topic that fits a different sense of the word
    And it gives audited passes and fails as examples and says to fail when in doubt
    And a sense without a gloss or a topic that is not a leaf is unreviewable

  @topics/tag @usecase
  Scenario: An agent tags a content sense with a leaf topic
    Given a noun sense and a leaf topic
    When an agent submits a topic fact
    Then the fact is pending with the topic id as its content key
    And its review reads the topic and its category's English names and publishes on a pass

  @topics/invalid-reference @usecase
  Scenario: A topic fact names an existing leaf topic on a content sense
    Given an unknown topic id, a category id, or a preposition sense
    When an agent submits a topic fact with it
    Then the submission is refused as an invalid reference with a message saying why, and nothing is queued

  @topics/limit @usecase
  Scenario: A sense holds at most three live topics
    Given a sense with three live topic facts
    When an agent submits a fourth, or an admin re-reviews a rejected one
    Then it is refused as a conflict naming the limit of three
    And once one is retracted a new topic fact is accepted

  @topics/correct-at-limit @usecase
  Scenario: A correction takes its original's place on a full sense
    Given a sense with three live topic facts, one of them published
    When an agent submits a correction that supersedes the published one, or an admin re-reviews a rejected correction of it
    Then it is accepted, because the limit does not count the fact a correction supersedes
    And a second correction of the same original is refused while the first is live, naming the live correction
    And a plain fourth topic fact is still refused as a conflict naming the limit of three

  @topics/tree @usecase
  Scenario: The taxonomy is served as categories with their leaf topics
    Given the topic taxonomy
    When it is listed
    Then each category carries its leaf topics, both in display order, with English and Chinese names

  @topics/senses @usecase
  Scenario: A topic lists the published senses it tags, and a category rolls up its leaves
    Given published topic facts on several senses
    When the senses of a leaf topic or of a category are listed
    Then a leaf lists the senses tagged with it and a category the senses tagged with any of its leaves, each once
    And an unknown topic id is not found

  @topics/tree-api @api
  Scenario: The seeded taxonomy is public
    Given a fresh database with every migration applied
    When GET /v1/topics is called
    Then it returns the 16 approved categories over 147 leaf topics with their English and Chinese names

  @topics/publish-api @api
  Scenario: A topic fact is reviewed, published, and listed on a real database
    Given topic facts submitted on senses of two entries
    When the queue reviews and publishes them
    Then GET /v1/topics/{id}/senses lists each tagged sense as a sense summary with its lemma, id, part of speech, CEFR level, gloss, and translation, in lemma order and paginated
    And a category lists the senses of all its leaves
    And the public entry shows the topic tags of each sense, and the management API lists the topic facts

  @topics/visibility @api
  Scenario: A tagged sense is listed only while everything it shows is published
    Given published topic facts on two senses of an entry's published inventory
    When a curator's correction of the inventory drops one sense, and the other sense's topic is retracted
    Then each sense is listed only while its topic fact is published and its entry's published inventory lists it

  @topics/write-rules-api @api
  Scenario: The write rules hold on a real database
    Given a noun sense and a preposition sense
    When topic facts with an unknown topic, a category, a preposition sense, or a fourth topic are submitted
    Then the first three are 422 invalid_reference, the fourth is 409 naming the limit, and a malformed id is 400

  @topics/correct-at-limit-api @api
  Scenario: A correction replaces a topic on a full sense on a real database
    Given a sense with three published topic facts
    When a correction supersedes one of them, and a second correction of the same one and a fourth topic are submitted
    Then the first correction is accepted, the second is 409 naming the live correction, and the fourth is 409 naming the limit
    And once the correction publishes the sense holds three published topics and the original is superseded

  @topics/one-live-correction-api @api
  Scenario: One original has one live correction, below the limit too, on a real database
    Given a sense with one published topic fact
    When four corrections of it are submitted at once
    Then one correction is accepted and the rest are 409 conflict naming the live correction
    And once the live correction publishes the sense holds one published topic, the original is superseded and cannot be corrected again

  @topics/not-found @api
  Scenario: An unknown topic has no senses to list
    Given no topic with the requested id
    When GET /v1/topics/{id}/senses is called
    Then the response is 404 not_found, with no fuzzy fallback
