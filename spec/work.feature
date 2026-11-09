Feature: Worklist
  Agents ask the server what to work on next, and no two agents work the same entry at once.

  @work/gaps @domain
  Scenario: A claim names what the entry lacks
    Given an entry and its facts in every status
    When the gaps are computed from its pending and published facts
    Then each missing senses, forms, or pronunciation is a gap, and each live sense with fewer than two relations, or without examples or a zh translation, is a gap

  @work/relations-gap @domain
  Scenario: A relations gap stays open until the sense has two relations
    Given a live sense with no, one, or two live relations, as subject or object
    When the gaps are computed
    Then the sense has a relations gap while it has fewer than two, and the gap counts them and names each type and direction it already has

  @work/entry-seed @api
  Scenario: The entry view says whether the entry is a seed entry
    Given an entry created without seed and one created with seed true
    When an agent reads either entry or claims it
    Then the management view and the claim say seed false for the first and seed true for the second

  @work/claim-order @usecase
  Scenario: An entry's second pass comes first, then seed entries with work left, then other entries with work left, then the rest
    Given entries claimed once, never-claimed seed entries, other never-claimed entries, entries claimed twice with and without a revisit, and entries whose entry fact is rejected or retracted
    When an agent claims work
    Then it gets an entry claimed once first, oldest claim first, then a never-claimed seed entry, then a seed entry to revisit, then another never-claimed entry, then another entry to revisit, then the least recently claimed of the rest, and never a dead entry

  @work/revisit @domain
  Scenario: A pass that added to an entry and left gaps open earns a revisit
    Given an entry's facts after a pass
    When the pass is judged
    Then the entry is revisited only if the holder added a fact about it since the claim and a gap is still open

  @work/claim-revisit @api
  Scenario: Seed entries a pass added to and left open come before never-claimed entries outside the seed list
    Given seed and other entries, where some second passes add a sense and the others add nothing
    When agents claim and complete work
    Then a seed entry left open comes back before any never-claimed other entry, another entry left open comes back after them, and entries whose pass added nothing wait for the rotation

  @work/claim-revisit-reopen @api
  Scenario: A finished entry comes back ahead of the rotation when it can have new gaps
    Given entries in the rotation, one with a fact retracted, two linked by a relation that review rejects, and one given a new sense by another agent
    When agents claim work
    Then each of those entries is claimed before the entry that nothing changed

  @work/claim-seeds-first @api
  Scenario: Seed entries are claimed before the entries outside the seed list
    Given entries created without seed, one created with seed true, and one marked seed by a repeated create
    When agents claim and complete work
    Then each seed entry gets its first and second pass before any other never-claimed entry is claimed

  @work/claim-second-pass @api
  Scenario: An entry worked once is claimed again before never-claimed entries
    Given an agent claimed and completed an entry once, and other entries were never claimed
    When agents claim work
    Then the next claim gets the entry worked once with its per-sense gaps, and once claimed twice it comes after every never-claimed entry

  @work/claim-rotation @api
  Scenario: An entry whose lease lapses twice goes to the back
    Given an agent claimed an entry twice and both leases expired without a complete
    When agents claim work
    Then every entry claimed fewer times comes first, and the lapsed entry comes after them

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
    Then the claim returns the lease, the management entry view, and its gaps; the other agent gets 204 and 409; a repeated complete is 404

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
