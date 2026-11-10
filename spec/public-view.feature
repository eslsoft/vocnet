Feature: Public view
  The public reads serve prebuilt documents. Each entry's public document is the
  same projection of its published facts, built when the facts change instead of
  on every read, so a read is one indexed lookup and responses can be cached.

  @public-view/document @domain
  Scenario: The view derives from the public document
    Given an entry's public projection and its reference data
    When its view rows are built
    Then the document is the public entry, nothing for an entry that is not public, a form row per published form under its content key, and a row per topic tag of a public sense

  @public-view/refresh @usecase
  Scenario: Writes and reads keep the view current
    Given entries linked by a relation, with built views
    When a write changes one entry's facts, a view goes stale, or a write lands during a rebuild
    Then the write rebuilds every view it made stale, linked entries included, a read rebuilds a stale view before serving it, rebuilding again a bounded number of times while it keeps losing and nothing is stored, and a rebuild that lost to a newer write stores nothing

  @public-view/publish @api
  Scenario: Publishing and retracting move the entry in and out of every public read
    Given an entry with a form and a topic tag under review
    When its facts are published and later its entry fact is retracted
    Then the entry, sense, form, list, and topic reads show it once published, and all of them drop it once retracted

  @public-view/linked @api
  Scenario: A change at the other end of a relation updates the linked entry
    Given two published entries linked by a relation
    When the gloss of the other sense is corrected and the other entry is later retracted
    Then the linked entry's document shows the corrected gloss and then drops the relation

  @public-view/reference @api
  Scenario: A reference import updates the documents
    Given a published entry with imported frequency data
    When a new reference import changes its frequency and CEFR levels
    Then the entry document carries the new data while the worklist scores stay current

  @public-view/http-cache @api
  Scenario: Public reads are cacheable and revalidate with an ETag
    Given a published entry
    When anyone reads the entry, a sense, a form, or a list
    Then documents carry an ETag and a Cache-Control that revalidates on every use, a matching If-None-Match gets 304, the ETag changes only when the document does, and lists stay fresh for five seconds

  @public-view/rebuild @api
  Scenario: Stale views are rebuilt on read and drained by an admin
    Given views marked stale as the backfill migration marks them
    When anyone reads one, and an agent and then an admin call the rebuild
    Then the read rebuilds it first, the agent gets 403, and the admin's calls rebuild the rest and report what remains

  @public-view/parity @api
  Scenario: The view serves exactly what the live projection builds
    Given entries with senses, forms, relations, topics, and reference data
    When the view serves them
    Then each entry and sense body is byte-identical to the live projection of the same facts

  @public-view/lost-update @api
  Scenario: A rebuild that lost to a newer write stores nothing
    Given a public entry whose revision moved after a rebuild loaded it
    When the rebuild saves its document
    Then the stored document, form rows, topic rows, and view revision all stay as they were

  @public-view/drain @api
  Scenario: Form lookups and lists wait for the drain after a migration
    Given a migration that marked every view stale and left no view rows
    When anyone looks up a form or lists entries before and after an admin drains the rebuild
    Then they find nothing of the entry before the drain and find it after
