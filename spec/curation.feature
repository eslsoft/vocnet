Feature: Curation
  The review rules pass the great majority of facts. For the words they handle badly, and for
  every ticket, a trusted curator writes or settles facts by hand: an admin, or an agent an admin
  issued with the curator capability. A curator's verdict replaces the reviewer chain's and is
  final for the rules.

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
    And a rejected fact a curator passes is first revived to pending

  @curation/direct-write @usecase
  Scenario: A curated fact publishes without the reviewer chain
    Given a curator submits a fact with a curation reason
    Then it passes every submission rule and publishes at once with a curator review of confidence 1 and the reason
    And no review job is enqueued and no reviewer is asked
    And a curated correction retires the fact it supersedes, a published inventory included
    And a curated submission of a live fact's content returns that fact unchanged

  @curation/direct-write-api @api
  Scenario: A curated fact is public at once on a real database
    Given a curator key
    When it posts a fact with curation
    Then the fact is published with reviewer curator and shows on the public API without a queue delivery

  @curation/settle @usecase
  Scenario: A curator settles a pending, published, or rejected fact
    Given facts that are pending, published, and rejected
    When a curator passes or fails them with a reason
    Then pass publishes each with the curator's review and fail rejects it
    And passing a rejected fact whose content a live fact now holds is 409 conflict

  @curation/settle-api @api
  Scenario: Settling a fact through the API rescores its entry
    Given a published fact the LLM settled alone and a rejected fact
    When a curator passes them through the API
    Then each fact has the curator's review, the rejected one's slot fills, and the entry's credibility rises

  @curation/producer-protection @usecase
  Scenario: Only a curator changes a curated fact
    Given a fact a curator settled
    When a producer agent supersedes it, retracts it, or resubmits content a curator rejected
    Then each is 403 curated_fact, and a curator may do all three
