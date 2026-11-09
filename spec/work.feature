Feature: Worklist
  Agents ask the server what to work on next, and no two agents work the same entry at once.

  @work/gaps @domain
  Scenario: A claim names what the entry lacks
    Given an entry and its facts in every status
    When the gaps are computed from its pending and published facts
    Then each missing senses, forms, or pronunciation is a gap, and each live sense with fewer relations than its part of speech needs, or without examples or a zh translation, is a gap

  @work/relations-gap @domain
  Scenario: A relations gap stays open until the sense has the relations it needs
    Given a live noun sense with no, one, or two live relations, as subject or object
    When the gaps are computed
    Then the sense has a relations gap while it has fewer than two, and the gap counts them and names each type and direction it already has

  @work/relations-by-pos @domain
  Scenario: The relations a sense needs depend on its part of speech
    Given a live sense of each part of speech
    When the gaps and completeness are computed
    Then nouns, verbs, and adjectives need two relations, adverbs one, and every other part of speech none, with no relations gap and no relation slots

  @work/scores @domain
  Scenario: An entry's completeness and quality come from its live facts
    Given an entry with some slots filled, some facts published on an uncertain verdict, and some under open feedback
    When the entry is assessed
    Then completeness is the filled share of the slots its gaps count, quality is one minus the weak share of its live facts, and each weak fact is named with its reason

  @work/stall @domain
  Scenario: A completed pass that left the open work as its claim found it stalls the entry
    Given the open work an entry's last claim found, whether that pass completed, and the open work now
    When the stall rule is applied
    Then the entry is stalled only if the pass completed and the open work is unchanged

  @work/admission @domain
  Scenario: Only a live entry with work left that is neither stalled nor awaiting review is claimable
    Given worklist rows that are live or dead, stalled or not, awaiting review or not, stale or scored, with and without work left
    When admission is decided
    Then a live row is claimable when its scores are stale, or when it is not stalled, has no pending fact about it or relation into its senses, and has a gap or a weak fact

  @work/claim-order @usecase
  Scenario: Seed entries come first, never-claimed by lowest completeness, claimed by least recently claimed
    Given never-claimed seed entries, other never-claimed entries of different completeness, and an entry whose entry fact is retracted
    When agents claim and complete work, some passes adding a sense or a form, and reviews land between passes
    Then seed entries are claimed first and claimed ones by least recently claimed, then the other entries by lowest completeness, every pass that added nothing stalls its entry, and the dead entry is never claimed

  @work/stall-loop @usecase
  Scenario: No loop hands out an entry whose passes make no lasting progress
    Given an entry whose pass submits a relation review rejects, or only adds a second example
    When agents claim and complete work
    Then the entry is stalled after that pass, and claimable again only after another principal's fact or a fact leaving live changes its open work

  @work/awaiting-review @usecase
  Scenario: An entry waits while its facts are under review, so a rejection after its lease stalls it
    Given an entry whose pass submits a relation and completes before the review lands
    When agents keep claiming work, and then review rejects the relation
    Then neither end of the relation is claimed while it is pending, and after the rejection the entry is stalled and claimed no more

  @work/weak-facts @api
  Scenario: A claim names the entry's weak facts
    Given a complete entry with a fact published on an uncertain verdict, and later open feedback on another fact
    When an agent claims work
    Then the claim names each weak fact with its reason, the entry stays claimable until a pass replaces them, and a pass that replaced nothing stalls it until the feedback opens

  @work/claim-empty @api
  Scenario: The worklist empties once every entry is complete and good
    Given entries whose every gap is filled and none of whose facts is weak
    When an agent claims work
    Then the claim answers no content, until a rejection reopens a gap

  @work/stall-api @api
  Scenario: A stalled entry waits until another principal changes its work
    Given a seed entry whose pass links it to another entry, and review rejects the link after the lease ended
    When agents claim and complete work
    Then neither entry is claimable while the link is pending, the entry is not claimed again, the worklist empties, and another principal's example makes it claimable

  @work/scores-backfill @api
  Scenario: The backfill computes the scores the rescore stores
    Given entries of every part of speech with filled, missing, uncertain, reported, and pending facts
    When the backfill migration runs over the rescored worklist
    Then every entry's completeness, quality, and awaiting review are unchanged

  @work/claim-seeds-first @api
  Scenario: Seed entries are claimed before the entries outside the seed list
    Given entries created without seed, one created with seed true, and one marked seed by a repeated create
    When agents claim and complete work
    Then each seed entry is claimed before any other entry, and once each pass added nothing the worklist is empty

  @work/claim-rotation @api
  Scenario: An entry whose lease lapses goes back without stalling
    Given the least complete entry is claimed and its lease keeps expiring without a complete
    When agents claim work
    Then the never-claimed entries come first, and then the claimed entries least recently claimed first, so the lapsing entry never comes ahead of one claimed before it

  @work/entry-seed @api
  Scenario: The entry view says whether the entry is a seed entry
    Given an entry created without seed and one created with seed true
    When an agent reads either entry or claims it
    Then the management view and the claim say seed false for the first and seed true for the second

  @work/claim-live @api
  Scenario: Only an entry with a live entry fact is claimable
    Given an entry whose entry fact is retracted
    When an agent claims work, then the entry is submitted again and the agent claims again
    Then the first claim gets no content and the second gets the entry

  @work/claim-index @api
  Scenario: A claim does not sort the worklist
    Given the claim statement
    When its query plan is read
    Then it walks the claim-order index and builds no temporary sort

  @work/claim-lease @usecase
  Scenario: A claimed entry is leased to one agent
    Given an agent holds the lease on the only live entry
    When another agent claims work before the lease expires
    Then nothing is claimable, and after the lease expires the other agent gets the entry

  @work/complete @usecase
  Scenario: Only the holder completes its lease, once
    Given an agent holds a lease
    When another agent completes it, the lease expired, or the holder completes it twice
    Then the other agent and the expired lease get conflict, and the repeat gets not_found

  @work/claim-api @api
  Scenario: Claim and complete over HTTP
    Given a submitted entry
    When an agent claims work, another agent claims or completes, and the holder completes with a note
    Then the claim returns the lease, the management entry view with its completeness and quality, its gaps, and its weak facts; the other agent gets 204 and 409; a repeated complete is 404

  @work/claim-race @api
  Scenario: Concurrent claims get distinct entries
    Given several live entries
    When agents claim work at the same moment
    Then each claim gets a different entry, and the claims beyond the entry count get no content

  @work/claim-expired-race @api
  Scenario: Concurrent claims split expired leases
    Given every live entry has an expired lease
    When more agents than entries claim work at the same moment
    Then each expired entry goes to exactly one agent, and the other claims get no content

  @work/lease-expiry-api @api
  Scenario: An expired lease is claimable again and cannot be completed
    Given an agent whose lease has expired
    When the first agent completes its lease and another agent claims work
    Then the first agent gets 409 conflict and the other agent gets the entry
