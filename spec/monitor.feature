Feature: Console monitor
  Admins watch how complete and credible the dictionary is and how fast the agents close its open work. Every number derives from stored rows on read; the console only reads.

  @monitor/item-status @domain
  Scenario: An open item stands where its attempts, lease, and reviews put it
    Given open items at the attempt bound, under an unexpired lease, awaiting review, or none of these
    When their status is read
    Then an item at the two-pass bound is stuck, a ticket, whatever else holds, a leased one is in progress, an awaiting one waits on review, and the rest are queued

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
  Scenario: The overview counts facts, credibility, completeness by level, reviews, tickets, and work
    Given low-credibility published facts, live entries of several levels, pending facts, tickets in several statuses, open and stuck items, and timed-out leases
    When the console stats are read
    Then low-credibility facts count by kind, completeness averages over the live entries overall and for each level A1 to C2 and none, pending reviews count those older than an hour, tickets count by status, and work counts open, stuck, and timed-out items

  @monitor/work-summary @usecase
  Scenario: The work summary shows the backlog and how fast it moves
    Given open items in every status, items created and closed over the last week, settled and waiting attempts, and leases
    When the work summary of a window is read
    Then it counts open items by status overall and by type, every type with its stage, closes and attempt success within the window, buckets of every hour or day, when the history began, the net closed per day over the recorded part of 7 days and 24 hours overall and by level (none before a whole day is recorded), and each lease with whether it timed out

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

  @monitor/history-api @api
  Scenario: Every item and attempt is kept, and the rescore settles each attempt
    Given an entry whose items a producer works: one filled by a pending fact, one passed with found_none, one left unchanged twice
    When the passes complete and the reviews land
    Then every item has a history row, the filled one's attempt waits on review and then closes with its fact listed, the passed one's attempt is passed, the closed items read with their attempts, the unchanged one's first attempt made no progress and the second is stuck, each attempt is numbered among its item's attempts whatever the filter, attempts filter and page by outcome, holder, and exact lemma, and only admins read them

  @monitor/items-api @api
  Scenario: The open items of an entry or a node read on a real database
    Given an entry with a sense and its open items, one of them leased
    When admins list the items by entry or by node and read the leased one
    Then each shows its status, the sense's gloss, and the lease, and asking by both or neither is invalid

  @monitor/stats-api @api
  Scenario: The overview counts on a real database
    Given an A1 entry and one without a level, a fact the LLM published after Jev was unsure, a pending fact, an open feedback ticket, and a timed-out lease
    When the stats are read
    Then low-credibility facts count by kind, completeness lists every level, pending review counts those older than an hour, tickets count by status, and the work counts open items and the timed-out lease

  @monitor/work-summary-api @api
  Scenario: The work summary on a real database
    Given an entry whose items a producer worked, closing one and leaving one unchanged, with a lease held
    When admins read the 24h and 7d summaries
    Then the counts, buckets, type rows, forecast, and leases match the history, and producers are forbidden

  @monitor/entry-list-api @api
  Scenario: The entry list shows level, scores, slots, and open work, and filters by them
    Given an A1 entry and one without a level, a leased item, and an item two passes left unchanged
    When admins list the entries
    Then each has its level, its stored completeness, credibility, and slots as the management view computes them, and its open work by status, and the level and stuck filters list only the matching entries

  @monitor/fact-filters-api @api
  Scenario: Facts filter by author and exact lemma on a real database
    Given facts by two agents about one entry and an entry of another
    When facts are listed by author and lemma
    Then each filter lists only the matching facts, and another spelling or an unknown lemma lists none

  @monitor/listing-entry-api @api
  Scenario: Facts and tickets read with the entry each is about
    Given an entry with a sense, an example of it and that example's translation, another entry, and reports about the entry, the sense, and the example
    When facts and tickets are listed and read by id
    Then each carries the id and lemma of the entry its subject or target is or belongs to, the translation through its example
