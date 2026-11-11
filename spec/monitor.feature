Feature: Console monitor
  Admins watch how complete and reliable the dictionary is and how fast the agents close its open work. Every number derives from stored rows on read; the console only reads.

  @monitor/item-status @domain
  Scenario: An open item stands where its attempts, lease, and reviews put it
    Given open items at the attempt bound, under an unexpired lease, awaiting review, or none of these
    When their status is read
    Then an item at the bound is stuck whatever else holds, a leased one is in progress, an awaiting one waits on review, and the rest are queued

  @monitor/throughput-buckets @domain
  Scenario: A summary window is a run of hourly or daily buckets
    Given the current time
    When the 24h or 7d window is bucketed
    Then it is the 24 hours ending with the current hour or the 7 UTC days ending with the current day, the window starts with its first bucket, and a bucket without rows counts nothing

  @monitor/fact-summary @domain
  Scenario: Each fact reads as one line
    Given a fact of every kind, with and without its optional fields
    When it is summarized
    Then the line names what it claims with its labels, and leaves out the fields it does not have

  @monitor/stats @usecase
  Scenario: The overview counts facts, completeness by level, reviews, feedback, and work
    Given weak facts, live entries of several levels, pending facts, feedback in several statuses, open and stuck items, and timed-out leases
    When the console stats are read
    Then completeness averages over the live entries overall and for each level A1 to C2 and none, pending reviews count those older than an hour, feedback counts by status, and work counts open, stuck, and timed-out items

  @monitor/work-summary @usecase
  Scenario: The work summary shows the backlog and how fast it moves
    Given open items in every status, items created and closed over the last week, settled and waiting attempts, and leases
    When the work summary of a window is read
    Then it counts open items by status overall and by type, every type with its stage, closes and attempt success within the window, buckets of every hour or day, the net closed per day over 7 days and 24 hours overall and by level, and each lease with whether it timed out

  @monitor/attempts @usecase
  Scenario: An attempt lists the facts its holder submitted with a summary line
    Given a completed attempt and the facts its holder submitted meanwhile
    When attempts are listed
    Then each comes with its ordinal among its item's attempts, its entry, outcome, time, note, and each fact's kind, status, and summary

  @monitor/items @usecase
  Scenario: A work item shows where it stands and how long it waited
    Given an open leased item, an open item whose lease lapsed, a closed item, and an item never claimed
    When the items and one item's detail are read
    Then only an unexpired lease shows, the agents' time is the sum of its attempts, the queue time runs from its creation to its first claim, to its close, or to now, and an unknown id is not found

  @monitor/fact-filters @usecase
  Scenario: Facts filter by author and by exact lemma
    Given facts by several principals about an entry
    When facts are listed by lemma and author
    Then only facts about the entry spelled exactly so and its senses by that author are listed

  @monitor/feedback-read @usecase
  Scenario: One feedback item reads by id
    Given a feedback item
    When it is read by its id or by an unknown id
    Then the item is returned, and an unknown id is not found

  @monitor/history-api @api
  Scenario: Every item and attempt is kept, and the rescore settles each attempt
    Given an entry whose items a producer works: one filled by a pending fact, one left unchanged three times
    When the passes complete and the reviews land
    Then every item has a history row, the filled one's attempt waits on review and then closes with its fact listed, the closed item reads with its attempts, the unchanged one's attempts made no progress and the third is stuck, each attempt is numbered among its item's attempts whatever the filter, attempts filter and page by outcome, holder, and exact lemma, and only admins read them

  @monitor/items-api @api
  Scenario: The open items of an entry or a node read on a real database
    Given an entry with a sense and its open items, one of them leased
    When admins list the items by entry or by node and read the leased one
    Then each shows its status, the sense's gloss, and the lease, and asking by both or neither is invalid

  @monitor/stats-api @api
  Scenario: The overview counts on a real database
    Given an A1 entry and one without a level, a weak fact, a pending fact, an open report, and a timed-out lease
    When the stats are read
    Then weak facts count by kind, completeness lists every level, pending review counts those older than an hour, feedback counts by status, and the work counts open items and the timed-out lease

  @monitor/work-summary-api @api
  Scenario: The work summary on a real database
    Given an entry whose items a producer worked, closing one and leaving one unchanged, with a lease held
    When admins read the 24h and 7d summaries
    Then the counts, buckets, type rows, forecast, and leases match the history, and producers are forbidden

  @monitor/entry-list-api @api
  Scenario: The entry list shows level, scores, slots, and open work, and filters by them
    Given an A1 entry and one without a level, a weak fact, a leased item, and an item three passes left unchanged
    When admins list the entries
    Then each has its level, its stored completeness and slots as the management view computes them, and its open work by status, and the level, flagged, and stuck filters list only the matching entries

  @monitor/fact-filters-api @api
  Scenario: Facts filter by author and exact lemma on a real database
    Given facts by two agents about one entry and an entry of another
    When facts are listed by author and lemma
    Then each filter lists only the matching facts, and another spelling or an unknown lemma lists none

  @monitor/feedback-read-api @api
  Scenario: One feedback item reads by id on a real database
    Given a public report
    When an agent reads it by id and an unknown id
    Then it is returned, and the unknown one is not found

  @monitor/listing-entry-api @api
  Scenario: Facts and feedback read with the entry each is about
    Given an entry with a sense, another entry, and reports about the entry, the sense, and the sense's fact
    When facts and feedback are listed and read by id
    Then each carries the id and lemma of the entry its subject or target is or belongs to

  @monitor/history-migration @api
  Scenario: The work_history migration backfills the open items' history
    Given open items without history rows
    When the work_history_backfill migration runs
    Then every open item has a history row with its gap and no close, and every worklist row is stale
