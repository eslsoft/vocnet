Feature: Topics
  Learners find words by topic, a scene or a subject area. A server-maintained, two-level taxonomy
  groups leaf topics ("At the doctor and hospital") under categories ("Body and health"). Agents
  tag senses with leaf topics through topic facts; topics are tags, never relations between words.

  @topics/review-plan @domain
  Scenario: A topic fact asks whether a learner meets this sense in that scene
    Given a topic fact on a glossed sense and the leaf topic it names
    When its review is planned
    Then Jev is asked one question naming the lemma, part of speech, gloss, topic, and category
    And the LLM rubric passes a sense a learner would commonly meet or need with the topic, be it a scene or a subject area
    And fails a loose association, a different sense of the word, or a topic where the word is only incidental
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

  @topics/revalidate @usecase
  Scenario: Topics are re-reviewed when the gloss changes meaning
    Given a published topic fact on a sense
    When a correction that changes the gloss's meaning publishes
    Then the topic fact is re-reviewed against the new gloss

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
    Then GET /v1/topics/{id}/senses lists each tagged sense with its lemma, part of speech, and gloss, in lemma order and paginated
    And a category lists the senses of all its leaves
    And the public entry shows the topic tags of each sense, and the management API lists the topic facts

  @topics/visibility @api
  Scenario: A tagged sense is listed only while everything it shows is published
    Given a published topic fact whose sense gloss and entry are still pending
    When the topic's senses are listed before and after the gloss and entry publish, and after the topic is retracted
    Then the sense is listed only while its topic fact, gloss, and entry are all published

  @topics/write-rules-api @api
  Scenario: The write rules hold on a real database
    Given a noun sense and a preposition sense
    When topic facts with an unknown topic, a category, a preposition sense, or a fourth topic are submitted
    Then the first three are 422 invalid_reference, the fourth is 409 naming the limit, and a malformed id is 400

  @topics/correct-at-limit-api @api
  Scenario: A correction replaces a topic on a full sense on a real database
    Given a sense with three published topic facts
    When a correction supersedes one of them, a second correction of the same one and a fourth topic are submitted, and a rejected correction is re-reviewed
    Then the first correction is accepted, the second is 409 naming the live correction, and the fourth is 409 naming the limit
    And the re-review is 409 while another correction holds the place and is accepted once it does not
    And once the correction publishes the sense holds three published topics and the original is superseded

  @topics/rereview-under-correction-api @api
  Scenario: Re-reviewing a topic under correction cannot push a sense past three topics
    Given a sense with three published topic facts and a pending correction of one of them
    When an admin re-reviews the original and both are then reviewed
    Then the re-review is 409 conflict pointing at the correction and the original stays published
    And the correction publishes, the original is superseded, and the sense holds three published topics

  @topics/correction-race-api @api
  Scenario: A correction racing a re-review of its original cannot push a sense past three topics
    Given a sense with three published topic facts
    When an admin re-reviews one of them right after a correction's submission or a rejected correction's re-review read it published
    Then the correction is 409 conflict because its original is not published, and nothing of it is live
    And once the original is reviewed again the sense holds exactly three published topics

  @topics/one-live-correction-api @api
  Scenario: One original has one live correction, below the limit too, on a real database
    Given a sense with one published topic fact
    When four corrections of it are submitted at once, and a rejected one is re-reviewed beside a live one
    Then one correction is accepted and the rest are 409 conflict naming the live correction
    And once the live correction publishes the sense holds one published topic, the original is superseded and cannot be corrected again

  @topics/not-found @api
  Scenario: An unknown topic has no senses to list
    Given no topic with the requested id
    When GET /v1/topics/{id}/senses is called
    Then the response is 404 not_found, with no fuzzy fallback
