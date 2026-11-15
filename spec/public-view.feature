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
    Then the document is the public entry with its summary and frequency order, nothing for an entry that is not public, a row per meaning with its level, a form row per published form, shown or not, by its spelling with the part of speech it is shown under, a row per topic tag of a public sense with its summary and level order, a row per word formation part, and a search row per distinct gloss, translation, and example

  @public-view/refresh @usecase
  Scenario: Writes and reads keep the view current
    Given entries linked by a relation, with built views
    When a write changes one entry's facts, a view goes stale, or a write lands during a rebuild
    Then the write rebuilds every view it made stale, linked entries included, a read rebuilds a stale view before serving it, rebuilding again a bounded number of times while it keeps losing and nothing is stored, and a rebuild that lost to a newer write stores nothing

  @public-view/publish @api
  Scenario: Publishing and retracting move the entry in and out of every public read
    Given a phrase entry a published phrases list admitted, with its inventory, a form, and a topic tag under review
    When its facts are published, and later a curator's correction of the headword's list drops the phrase
    Then the entry, sense, form, list, and topic reads show it once published, and all of them drop it once it is no longer live

  @public-view/linked @api
  Scenario: A change at the other end of a relation updates the linked entry
    Given two published entries linked by a relation
    When a curator corrects the other entry's inventory to reword the linked sense's gloss, and later to drop that sense
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
    Given entries with inventories, forms, relations, translations, topics, phrases, and reference data
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
  Scenario: A headword lists the public phrases its phrases list names
    Given a public headword "give" whose published phrases list names "give up" and "give in"
    When "give up" becomes public, and later stops being live
    Then reading "give" lists "give up" as a phrase summary under its type in the list's order and leaves out "give in" until it is public, and then no longer lists "give up", with a new ETag each time

  @public-view/sentence @usecase
  Scenario: A sentence is public where a public document shows it
    Given a public sense with a published example and a translation of its sentence, a public headword whose published list names a saying with a meaning, and a pending example
    When the sentences are read
    Then each shows its text, source, meaning, translation in the read's language, the public senses it exemplifies, and the public headwords it is a saying of, and the pending example's sentence and an unknown id are not found

  @public-view/family @api
  Scenario: Entries sharing a base list each other as word family
    Given published entries "happy" and "happiness" whose word formations share the base "happy"
    When their word formation is read, and the formation of "happiness" is corrected to another base
    Then each lists the other in its family and links each part with a public entry, and after the correction neither lists the other

  @public-view/family-lemma @domain
  Scenario: A base is read by the entry it names
    Given a word formation whose base part names an entry spelled otherwise
    When its view record and public entry are built
    Then its morpheme is the named lemma, so the words built on that entry share it as a family, and the part links that lemma only when it is public

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

  @public-view/list-filters @api
  Scenario: Entry lists filter by level, part of speech, and topic and sort by frequency
    Given published entries with CEFR levels, frequencies, several parts of speech, and topic tags
    When the entry list is read with level (repeated or comma-separated), pos, topic (a leaf or a category), and sort, page by page
    Then it keeps the entries with one meaning, or with a topic one tagged sense, of that part of speech at one of those levels, in lemma order or by frequency with unranked entries last, every page continuing where the last stopped; a cursor of another sort, an unknown level or sort is 400 and an unknown topic 404

  @public-view/topic-common-senses @api
  Scenario: A topic lists an entry only for a common sense
    Given an entry whose rare sense, ranked extra in its inventory, is tagged with a topic
    When the entry list is read by that topic, and again once a common sense is tagged
    Then the entry is listed only after the common sense is tagged, while the topic's senses list the rare sense itself, marked rare
    And the taxonomy counts the topic's senses and entries as those two lists show them

  @public-view/relation-layers-api @api
  Scenario: Relations show the everyday layer, and a domain layer on request
    Given a sense with everyday hypernyms and a biology hypernym
    When its entry is read without a domain, with domain biology, with another domain, and with an unknown one
    Then the everyday broader terms always show, the biology one only with domain biology and marked with it, its target lists the narrower term only then, each read has its own ETag, and an unknown domain is 400

  @public-view/members @usecase
  Scenario: The members walk reads the public hypernyms
    Given public senses linked by everyday and biology hypernyms
    When the members of the top category are listed a page at a time, with and without the domain, and of a sense that is not public
    Then each member comes with its depth and the senses it is a direct kind of within the layers walked, every page gives the total, pages continue, the domain adds its members, and the hidden sense is not found

  @public-view/members-api @api
  Scenario: A category lists its members transitively
    Given everyday hypernyms making bird, dog, and eagle animals and eagle a bird, and biology hypernyms making dog a canine and canine a carnivore
    When the members of animal, bird, and carnivore are read, page by page, with and without domain biology, and of an unknown sense
    Then each member comes once at its nearest depth, nearest first then by lemma, with its parents inside the walk (a member of two categories names both, a category outside the walk is left out) and the total over every page, pages continue where the last stopped, a domain taxonomy is walked only on request, and an unknown sense is 404

  @public-view/overviews @usecase
  Scenario: Overviews of many entries are cut from the built views
    Given public entries with pronunciations, several parts of speech, and translations
    When the overviews of a list of lemmas are read with a sense limit and a language
    Then each entry comes once, in the order asked, with its pronunciations and per part of speech its level, its sense count, and its first senses with every translation in that language
    And a lemma no public entry is spelled exactly like is named as missing, as it was asked

  @public-view/overviews-api @api
  Scenario: One read serves the word cards of a topic page
    Given published entries with levels, frequencies, pronunciations, and translations
    When GET /v1/overviews is read with repeated lemma parameters, senses, and lang
    Then it answers the overviews in the order asked with a five-second max-age, names the lemmas without a public entry, and shows no translations without a language
    And no lemma, more than 100 lemmas, lang=all, or senses above 10 is 400

  @public-view/topic-category @usecase
  Scenario: A topic tag shows its category
    Given a public sense tagged with a leaf topic
    When its entry or the sense is read
    Then each topic tag carries its category's id and name from the taxonomy as it is now, in the read's language, and the taxonomy is part of the read's ETag
    And a tag whose topic the taxonomy lacks fails the read

  @public-view/topic-sort @api
  Scenario: The senses of a topic sort by lemma, frequency, or level
    Given senses of entries with frequencies and levels tagged with topics of one category
    When a leaf or the category is listed with sort lemma, frequency, or level, page by page
    Then the senses come in that order, ties by lemma and sense, each once, the same across pages

  @public-view/list-indexes @api
  Scenario: Lists and search read through indexes
    Given published entries in the view
    When the query plans of a filtered list by frequency, a topic-filtered list by lemma, a topic listing by level, and a search are explained
    Then each walks or searches an index of the view tables and the full-text index, and none scans a view table

  @public-view/edge-cache @domain
  Scenario: The edge keeps lists for their max-age, keyed by the language used
    Given a public read
    When a response is public with a max-age, and when it is a document, an error, or a HEAD
    Then the first is kept at the edge under its URL and the served language its Accept-Language reads, a hit is served with its Age and Vary, and nothing else is kept

  @public-view/rate-limit @api
  Scenario: Public reads are rate limited per client address
    Given a client address that has used up its reads
    When it reads an entry or searches
    Then the API answers 429 rate_limited with Retry-After, while another address reads on
