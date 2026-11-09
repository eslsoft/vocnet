Feature: Facts and review
  Every claim is one fact. Each fact is reviewed and published on its own, by Jev
  when it is a checkable proposition and by a general LLM otherwise.

  @facts/review-flow @api
  Scenario: A submitted fact is reviewed through the queue and published
    Given an agent submits a fact
    When the review queue consumer processes its job and the reviewer passes it
    Then the fact is published and visible on the public API

  @facts/review-publish @usecase
  Scenario: A passing review publishes the fact and records what was judged
    Given a pending fact
    When Jev passes it
    Then the fact is published with the reviewer, model, verdict, confidence, and context

  @facts/publish-with-flaws @domain
  Scenario: Uncertain reviews publish; only failures reject
    Given a review verdict
    When the decision is made
    Then pass and uncertain publish the fact and fail rejects it

  @facts/jev-policy @domain
  Scenario: Jev probabilities map to a verdict
    Given Jev answers for every question
    When all are at least 0.8, any is below 0.5, or neither
    Then the verdict is pass, fail, or uncertain, with the minimum answer as confidence

  @facts/reviewer-routing @domain
  Scenario: Each kind has one reviewer
    Given the fact-kind registry
    Then entry, sense, form, and relation go to Jev and pronunciation, example, and translation go to the LLM

  @facts/unreviewable @domain
  Scenario: A meaning-dependent fact cannot be judged without a gloss
    Given an example, translation, or relation whose sense has no live gloss
    When its review is planned
    Then it is rejected as unreviewable without asking a reviewer

  @facts/independent @usecase
  Scenario: A fact never waits for another fact
    Given an example whose sense gloss is still pending
    When the example is reviewed
    Then it is judged against the pending gloss and decided on its own

  @facts/dedupe @usecase
  Scenario: Resubmitting a live fact returns it
    Given a pending or published fact
    When an agent submits the same content again
    Then the existing fact is returned with created=false and nothing is enqueued

  @facts/submit-api @api
  Scenario: Submission over HTTP
    Given an agent key
    When it submits a fact twice, a fact about the wrong node type, and an invalid payload
    Then the API answers 201, 200, 422 invalid_reference, and 400 invalid_request

  @facts/subject-validation @usecase
  Scenario: A fact must be about the right kind of node
    Given a kind whose subject is a sense
    When an agent submits it about an entry
    Then the submission is rejected as an invalid reference

  @facts/supersede-rules @usecase
  Scenario: Corrections supersede only a published fact of the same kind and subject
    Given a fact to correct
    When the correction names a missing, different, or unpublished fact
    Then the submission is rejected

  @facts/single-gloss @usecase
  Scenario: A sense has one gloss
    Given a sense with a live gloss
    When an agent submits another gloss without superseding it, or a second correction
    Then the submission conflicts

  @facts/correction @usecase
  Scenario: A published correction supersedes the original in the same write
    Given a published gloss and a pending correction of it
    When the correction is published
    Then the original is superseded; a rejected correction leaves the original published

  @facts/review-idempotent @usecase
  Scenario: Duplicate deliveries change nothing
    Given a fact that is already decided
    When its review job is delivered again
    Then the review is skipped and the status is unchanged

  @facts/transport-retry @usecase
  Scenario: A reviewer outage is not a verdict
    Given the reviewer gateway is unreachable
    When a fact is reviewed
    Then the fact stays pending and the error propagates

  @facts/transport-retry-api @api
  Scenario: The queue retries a job when the gateway is down
    Given the reviewer gateway answers 503
    When the queue consumer processes the job
    Then the message is retried and the fact stays pending

  @facts/reconcile @usecase
  Scenario: Stuck facts are re-enqueued
    Given facts pending for more than ten minutes
    When the reconciler runs
    Then their review jobs are enqueued again

  @facts/retract @usecase
  Scenario: Retract a fact
    Given an agent's own pending or published fact
    When it retracts the fact
    Then the fact is retracted; another agent may not, and retracting twice is a no-op

  @facts/rereview @usecase
  Scenario: Admins send a decided fact back through review
    Given a published or rejected fact
    When an admin re-reviews it
    Then it is pending again and enqueued, unless another live fact took its place

  @facts/manage-api @api
  Scenario: Fact management over HTTP
    Given an agent's fact
    When the agent tries to re-review it, retracts it, and reads stats
    Then re-review is forbidden, retraction succeeds, and stats count it
