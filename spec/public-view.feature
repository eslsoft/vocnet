Feature: Public view
  The public reads serve prebuilt documents. Each entry's public document is the
  same projection of its published facts, built when the facts change instead of
  on every read, so a read is one indexed lookup and responses can be cached. A
  document holds every language and review; a read cuts out the variant it asks
  for and joins what other entries' views supply.

  @public-view/document @domain
  Scenario: The view derives from the public document
    Given an entry's public projection and its reference data
    When its view rows are built
    Then the document is the public entry with its summary, nothing for an entry that is not public, a form row per published form, shown or not, with the part of speech it is shown under, under its content key, a row per topic tag of a public sense with its summary, a row per word of a multiword lemma, and a row per word formation part

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
    Then documents carry an ETag and a Cache-Control that revalidates on every use, a matching If-None-Match gets 304, the ETag changes only when the document or the variant does, every read varies by Accept-Language, and lists stay fresh for five seconds

  @public-view/rebuild @api
  Scenario: Stale views are rebuilt on read and drained by an admin
    Given views marked stale as the backfill migration marks them
    When anyone reads one, and an agent and then an admin call the rebuild
    Then the read rebuilds it first, the agent gets 403, and the admin's calls rebuild the rest and report what remains

  @public-view/parity @api
  Scenario: The view serves exactly what the live projection builds
    Given entries with senses, forms, relations, topics, and reference data
    When the view serves them
    Then each entry and sense body, in every variant, equals the live projection of the same facts

  @public-view/lost-update @api
  Scenario: A rebuild that lost to a newer write stores nothing
    Given a public entry whose revision moved after a rebuild loaded it
    When the rebuild saves its document
    Then the stored document and every lookup row and the view revision stay as they were

  @public-view/drain @api
  Scenario: Form lookups and lists wait for the drain after a migration
    Given a migration that marked every view stale and left no view rows
    When anyone looks up a form or lists entries before and after an admin drains the rebuild
    Then they find nothing of the entry before the drain and find it after

  @public-view/phrases @api
  Scenario: A multiword entry appears among the phrases of each of its words
    Given published entries "give" and "up"
    When a multiword entry "give up" is published, and later retracted
    Then reading "give" or "up" lists "give up" as a phrase summary and then no longer does, with a new ETag each time, though nothing rebuilt their views

  @public-view/family @api
  Scenario: Entries sharing a base list each other as word family
    Given published entries "happy" and "happiness" whose word formations share the base "happy"
    When their word formation is read, and the formation of "happiness" is corrected to another base
    Then each lists the other in its family and links each part with a public entry, and after the correction neither lists the other

  @public-view/language @api
  Scenario: The language comes from lang or Accept-Language and changes the ETag
    Given a published entry with a translation and a topic tag
    When it is read with lang, with Accept-Language, with both, with lang=all, and without either
    Then the response carries the stored language it used, lang wins over Accept-Language, translations and topic names follow it, a Traditional Chinese request reads no language, and each language has its own ETag

  @public-view/list-language @api
  Scenario: Lists accept one language only
    Given a published entry with a form and a topic tag
    When the entry list, the form lookup, or the topic listing is requested with lang=all
    Then the API answers 400 naming the reads that accept lang=all, so every summary has one shape

  @public-view/form-parity @api
  Scenario: Every published form of a public entry resolves through the form lookup
    Given a public entry with forms shown, forms whose part of speech has no public sense, and a variant
    When each of its published forms is looked up
    Then every one finds the entry with its type, whether or not the entry document shows it
