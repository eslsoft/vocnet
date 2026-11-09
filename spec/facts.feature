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

  @facts/exclusive-slot-race @api
  Scenario: Concurrent corrections cannot both go live
    Given a sense with a published gloss
    When two agents submit different corrections of it at the same time
    Then one is pending and the other conflicts, so the sense holds one published and one pending gloss

  @facts/correction @usecase
  Scenario: A published correction supersedes the original in the same write
    Given a published gloss and a pending correction of it
    When the correction is published
    Then the original is superseded; a rejected correction leaves the original published

  @facts/supersede-api @api
  Scenario: A correction replaces the original atomically on a real database
    Given a published gloss and a pending correction of it
    When the review queue publishes the correction
    Then the original is superseded and the public entry shows only the correction

  @facts/revalidate-dependents @usecase
  Scenario: Facts judged against a corrected gloss are re-reviewed in place
    Given a sense with published examples, translations, and relations in both directions
    When a correction of its gloss publishes
    Then each of those facts is marked and enqueued for revalidation, stays published and public meanwhile, and is reviewed against the new gloss

  @facts/revalidation-outcome @domain
  Scenario: Revalidation unpublishes only on failure
    Given a published fact under revalidation
    When its new review is pass, uncertain, or fail
    Then it stays published with the new review, or moves to rejected
    And with no live gloss to judge against, it stays published with its standing review and loses only the mark

  @facts/revalidate-gloss-retracted @api
  Scenario: A retracted correction does not reject the facts waiting to revalidate against it
    Given a published gloss correction whose dependents are marked for revalidation
    When the correction is retracted before the queue delivers their jobs
    Then the dependents stay published with their standing reviews, unmarked, and no reviewer is asked

  @facts/revalidate-api @api
  Scenario: Revalidation through the queue on a real database
    Given a corrected gloss whose example and incoming relation were published
    When the queue delivers their revalidation jobs
    Then they stay published with reviews of the new gloss, and a fact about another sense is untouched

  @facts/retract-no-cascade @usecase
  Scenario: Retracting a gloss does not cascade
    Given a sense whose published gloss has dependent facts
    When the gloss is retracted
    Then nothing is marked or enqueued, and the sense and its facts drop out of the public view

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
    Given facts pending for more than five minutes
    When the reconciler runs
    Then their review jobs are enqueued again

  @facts/reconcile-revalidation @usecase
  Scenario: Stuck revalidations are re-enqueued
    Given published facts marked for revalidation more than five minutes ago
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

  @facts/rereview-api @api
  Scenario: A rejected fact goes back through review and publishes
    Given a fact the reviewer rejected
    When an admin re-reviews it and the reviewer then passes it
    Then it moves from rejected to pending to published and is publicly visible

  @facts/rereview-conflict @api
  Scenario: A re-review never makes a second live fact
    Given a published gloss with a pending correction, and a rejected example whose text is live again
    When an admin re-reviews the gloss or the rejected example
    Then each answers 409 conflict and nothing changes

  @facts/rereview-orphaned-correction @api
  Scenario: A rejected correction cannot come back once its original is gone
    Given a published gloss, a rejected correction of it, and a second correction that published
    When an admin re-reviews the rejected correction
    Then it answers 409 conflict, the correction stays rejected, and the live gloss can still be corrected

  @facts/manage-api @api
  Scenario: Fact management over HTTP
    Given an agent's fact
    When the agent tries to re-review it, retracts it, and reads stats
    Then re-review is forbidden, retraction succeeds, and stats count it
