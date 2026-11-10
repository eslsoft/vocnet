Feature: Curation
  The review rules pass the great majority of facts. For the words they handle
  badly, a trusted curator writes or settles facts by hand: an admin, or an agent
  an admin issued with the curator capability. A curator's verdict replaces the
  reviewer chain's and is final for the rules.

  @curation/curator-capability @domain
  Scenario: Only admins and curator agents curate
    Given an admin, a curator agent, and a producer agent
    Then the admin and the curator agent may curate and the producer may not

  @curation/curator-only @api
  Scenario: Curation is refused to producers
    Given an admin issues a curator key and a producer key
    When the producer sends a curated fact or settles a fact
    Then the API responds 403 forbidden, and the curator key may do both

  @curation/lifecycle @domain
  Scenario: A curator's verdict has its own transitions
    Given the transition table
    Then a curator pass moves a pending or published fact to published
    And a curator fail moves a pending or published fact to rejected

  @curation/direct-write @usecase
  Scenario: A curated fact publishes without the reviewer chain
    Given a curator submits a fact with a curation reason
    Then it passes every submission rule and publishes at once with a curator review of confidence 1 and the reason
    And no review job is enqueued and no reviewer is asked
    And a curated correction retires the fact it supersedes
    And a curated submission of a live fact's content returns that fact unchanged

  @curation/direct-write-api @api
  Scenario: A curated fact is public at once on a real database
    Given a curator key
    When it posts a fact with curation
    Then the fact is published with reviewer curator and shows on the public API without a queue delivery

  @curation/settle @usecase
  Scenario: A curator settles a pending, weak, or rejected fact
    Given facts that are pending, published on an uncertain review, and rejected
    When a curator passes or fails them with a reason
    Then pass publishes each with the curator's review, so it is no longer weak, and fail rejects it
    And passing a rejected fact whose content a live fact now holds is 409 conflict

  @curation/settle-api @api
  Scenario: Settling a fact through the API rescores its entry
    Given a weak published fact and a rejected fact
    When a curator settles them through the API
    Then each fact has the curator's review and the entry's weak count drops

  @curation/never-revalidated @api
  Scenario: Gloss corrections never revalidate a curated fact
    Given a curated example and a reviewed example of one sense
    When a correction of the sense's gloss publishes
    Then only the reviewed example is marked for revalidation

  @curation/producer-protection @usecase
  Scenario: Only a curator changes a curated fact
    Given a fact a curator settled
    When a producer agent supersedes it, retracts it, or resubmits content a curator rejected
    Then each is 403 curated_fact, and a curator may do all three

  @curation/weak-list @api
  Scenario: A curator lists weak facts by kind and level
    Given weak facts about entries of different CEFR levels
    When the curator lists facts with weak, a kind, and a level
    Then only the published facts with an uncertain or failed review of that kind about entries of that level are listed, newest first
