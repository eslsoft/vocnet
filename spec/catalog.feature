Feature: Catalog
  The public dictionary: live entries, the senses of their published inventories, forms,
  relations, phrases, and translations, shown only as far as their facts are published, in a
  learner's shape. Entries are admitted, never created by workers. Lookups are exact; there are
  no fallbacks.

  @catalog/entry-read @api
  Scenario: Read a reviewed entry
    Given a live entry whose inventory, form, example, translation, and relation facts are published
    When anyone requests the entry by its lemma
    Then the API returns the entry with its senses grouped into meanings and no review metadata
    And with include=review each published claim carries its fact id, confidence, and verdict

  @catalog/entry-not-found @api
  Scenario: Unknown or unpublished items are not found
    Given a lemma, form, or sense that does not exist, an entry that is not live, or a sense no published inventory lists
    When anyone requests it
    Then the API responds 404 with the not_found code

  @catalog/no-fallback @usecase
  Scenario: A lemma lookup never falls back to a similar lemma
    Given a published entry "bank"
    When anyone requests "banks" or "Bank"
    Then the lookup is not found instead of returning "bank"

  @catalog/usage-facts @domain
  Scenario: Grammar, word formation, and collocations are part of the public entry
    Given an entry with published, pending, and rejected grammar, morphology, and collocation facts
    When the public view is built
    Then the entry shows its published word formation, with what a shortened word shortens, each sense its published grammar (with its patterns and named prepositions as lists) and collocations, each with its review, and null or empty when none is published

  @catalog/usage-facts-api @api
  Scenario: Grammar, word formation, and collocations are reviewed and published through the queue
    Given an agent submits grammar and a collocation about a verb sense and a word formation about its entry
    When the queue consumer reviews them
    Then Jev answers one question per grammar property, pattern, and named preposition, the LLM judges the collocation, and the public entry and sense show all three

  @catalog/sense-order @domain
  Scenario: Senses come in the order of the published inventory
    Given an entry with a published inventory, a pending correction of it, and a sense no published inventory lists
    When the public view is built
    Then each part of speech is a meaning, in the order of its first sense, its senses come common in inventory order and then extra marked rare, with the gloss and labels the inventory gives, the unlisted sense is not shown, and the entry's review carries the published inventory

  @catalog/meaning-shape @domain
  Scenario: An entry reads as a learner's dictionary entry
    Given an entry with pronunciations with and without a part of speech, inflections, variants, and labelled senses of two parts of speech
    When the public view is built
    Then the default pronunciations are on the entry and the ones particular to a part of speech on its meaning, weak forms marked weak
    And each meaning lists its inflections by type, a type with several forms listing each, variants are on the entry, and a form or pronunciation with no meaning to show it is not shown
    And each sense carries its register as labels

  @catalog/form-placement @domain
  Scenario: A form is shown under the meaning that can carry it
    Given forms with and without a part of speech, of entries whose first meaning is a noun, an auxiliary, a pronoun, or a determiner
    When the meaning each form is shown under is chosen
    Then a labelled form goes to the meaning of its label, an unlabelled one to the meaning of the first part of speech, in its type's preference order, that the entry has, never by display order, and a form no meaning can carry goes nowhere

  @catalog/form-index @domain
  Scenario: Every published form is indexed for lookup whether or not it is shown
    Given an entry with published forms that are shown, a labelled form whose part of speech has no public sense, and a variant
    When the public view is built
    Then the document indexes every published form with its type and the part of speech it is shown under or labelled with, independent of display

  @catalog/relation-groups @domain
  Scenario: Relations are grouped by what they say about the sense
    Given synonym, antonym, hypernym, and part-of relations with the sense at either end
    When the public view is built
    Then synonyms and antonyms show on both senses, a hypernym is broader on its subject and narrower on its target, and a part-of is part_of on its subject and parts on its target
    And each related sense carries its lemma, id, and gloss

  @catalog/language @domain
  Scenario: A read shows one language
    Given senses with translations in two languages and a topic with names in two languages
    When a read asks for a served language, all, a language with no translation, or none
    Then translations are a list in that language, keyed by language for all, empty for a language with none, and absent for none, never another language
    And topic names carry English and the language under its stored tag, and summaries the first sense's first translation in it, none with all

  @catalog/script-safety @domain
  Scenario: A request reads a stored language only in the same script
    Given translations stored as zh, which is Simplified Chinese
    When requests name zh, zh-Hans, zh-CN, zh-SG, zh-Hant, zh-TW, zh-HK, zh-MO, another language, or that language with a region or a script
    Then the Simplified requests read zh, the Traditional ones read nothing, and another language is read only by its own tag or that tag with a region

  @catalog/review-metadata @domain
  Scenario: Review metadata appears only when asked for
    Given a public entry
    When it is read with and without include=review
    Then without it no fact id, confidence, or verdict appears, and with it every published claim the entry shows carries its own

  @catalog/summary @domain
  Scenario: Lists show summaries
    Given public entries with and without senses, CEFR levels, and translations
    When their summaries and the summaries of their tagged senses are built
    Then an entry summary has its lemma, the parts of speech of its meanings, its lowest CEFR level, and its first sense's gloss and translation
    And a sense summary has its id, part of speech, the CEFR level of that part of speech, and its gloss and translation

  @catalog/accept-language @usecase
  Scenario: The language comes from the query or Accept-Language
    Given requests with lang, with Accept-Language, with both, and with neither
    When the read variant is resolved
    Then lang wins, all in any case, else the most preferred Accept-Language tag by quality that reads a served language, ignoring * and q=0, else none
    And the read reports the stored tag it uses, not the tag requested

  @catalog/visibility @domain
  Scenario: Only published facts are visible
    Given an entry with published, pending, and rejected facts
    When the public view is built
    Then only the published facts appear, each with its review

  @catalog/relation-visibility @domain
  Scenario: A relation is visible only when both of its senses are
    Given a published relation whose target sense or target entry is not published
    When the public view is built
    Then the relation does not appear

  @catalog/form-lookup @usecase
  Scenario: Look up an entry by an exact published form
    Given a published plural form "banks" of "bank"
    When anyone looks up the form "banks"
    Then the result is the summary of "bank" with the form type and part of speech that matched

  @catalog/form-lookup-api @api
  Scenario: Form lookup over HTTP
    Given a published form fact
    When anyone requests the form endpoint
    Then the API returns each owning entry as a summary with the forms that matched, and 404 for a form no entry claims

  @catalog/search @api
  Scenario: Page through entries by prefix
    Given more published entries with a prefix than fit on one page
    When a client follows next_cursor
    Then every matching entry is returned exactly once in lemma order as a summary, and a broken cursor is rejected

  @catalog/create-entry @usecase
  Scenario: A curator admits a headword in a batch, idempotently
    Given a curator admits the headword "house" in batch 2
    When it admits the same lemma again in another batch, admits an existing entry that is not live, or a producer agent tries to admit one
    Then the first call creates the live entry in batch 2, the repeat returns it keeping batch 2, the existing entry becomes live in the batch, and the producer is forbidden

  @catalog/import-core @usecase
  Scenario: The core import admits the CEFR headwords that have no entry as batch 1
    Given CEFR headwords of several levels, one of them already an entry, and the single letters "a", "I", and "x"
    When an admin runs the core import a few entries at a time until nothing remains, and once more
    Then each headword without an entry becomes a live batch 1 entry the admin created, lowest level first, nothing is queued for review, and the reopened blocked slots are those of the admitted words
    And "x" is skipped and reported under its rule, the existing entry is left as it was, and the last run creates nothing

  @catalog/import-filter @usecase
  Scenario: A headword import filters its candidates before it admits them
    Given candidates with contractions and clitics, lemmas with digits or dots, regular inflections of a candidate or an entry, and American spellings of a British candidate or entry
    When the import runs
    Then each is skipped and reported under its rule, an inflection the reference list lists stays a headword, a short word never pairs with another ("floor" and "flour"), and an American spelling merged into a British headword the call creates is recorded on it as a curated variant form

  @catalog/retire @usecase
  Scenario: A curator takes an admitted entry off the wordlist
    Given a live headword, and a phrase a published phrases list names
    When a producer and then a curator retire the headword, the curator retires it again, retires an unknown id, and retires the listed phrase
    Then the producer is forbidden, the headword stops being live and the repeat changes nothing, the unknown id is not found, the listed phrase is a conflict, and admitting the headword again makes it live

  @catalog/retire-api @api
  Scenario: Retiring an entry over HTTP
    Given a live headword and a phrase a published list names
    When a producer and a curator post to /manage/v1/entries/{id}/retire
    Then the producer gets 403, the curator 200 with the entry retired, which has no public entry and no claimable work, an unknown id 404, and the listed phrase 409

  @catalog/import-core-api @api
  Scenario: Only an admin runs the core import over HTTP
    Given imported CEFR levels and an entry a curator admitted for one of the headwords in batch 2
    When an agent and then an admin call the core import, one entry per call
    Then the agent gets 403, the admin's calls create the missing entries and report the skipped single letter and what remains
    And the created entries are live in batch 1 with their senses items first in the queue, while the earlier entry keeps batch 2

  @catalog/create-entry-api @api
  Scenario: Only a curator admits entries over HTTP
    Given a producer key, a curator key, and an admin token
    When each posts the lemma "house" in batch 2, and the curator posts it again
    Then the producer gets 403, the first curator call is 201 with the entry and the second 200, the management view says live in batch 2, and its senses item is claimable

  @catalog/manage-entry @api
  Scenario: Management sees every fact in every status
    Given a live entry with a pending inventory and pending facts
    When an agent requests the entry through the management API
    Then every fact about the entry, its senses, their collocations, and its sentences is returned with its status, with whether the entry is live, its batch, its phrase type, its completeness, credibility, and slot counts

  @catalog/view-texts @domain
  Scenario: A view shows each id it names with its text
    Given an entry with examples and a phrases list naming entries and sayings
    When its management view is built
    Then each example carries its sentence's text beside the id and each phrases item its lemma or text, while a node the snapshot did not read keeps its id alone, and the stored payloads hold ids only

  @catalog/manage-entry-list @api
  Scenario: Management lists entries in every status with their progress
    Given live and unlisted entries with pending, published, and retracted facts, one of them worked by an agent
    When an agent pages through the entries by prefix
    Then each page lists entries in lemma order with whether each is live, its inventory size, fact counts by status, and last worked time

  @catalog/manage-entry-list-index @api
  Scenario: Listing entries reads only the page
    Given the statements behind one page of entry summaries
    When their query plans are read
    Then each one searches an index from the page's entries and none reads every live fact of a kind

  @catalog/locate-node @api
  Scenario: Management resolves a node id to its entry
    Given an entry with a sense
    When management asks for the node behind the entry id, the sense id, or an unknown id
    Then it gets the owning entry's id and lemma for both, and 404 for the unknown id

  @catalog/productive-use-read @domain
  Scenario: Each meaning says whether native speakers and a C1 learner use the word, and for which skills
    Given an entry with published and pending productive uses and a part of speech with only extra senses
    When its document is projected
    Then a meaning with a published productive use shows native and learner as true or false with their skills, a meaning without one shows null for both, and a meaning of only extra senses is passive for both
    And an active tier is listen, speak, read, and write and a passive one listen and read, keeping only listen and speak when every common sense is informal, slang, taboo, or offensive, and only read and write when every one is formal or literary

  @catalog/productive-use-api @api
  Scenario: A reviewed productive use is served on its meaning
    Given an entry with an informal British adjective sense and an extra verb sense
    When an agent submits a productive use and Jev answers both questions at 0.8, or below 0.8 and the LLM fails it
    Then the first publishes and the public entry serves it with its skills and its review, the verb passive for both, and the failed one leaves the meaning unmarked until a curator publishes it

  @catalog/new-fields @domain
  Scenario: The entry document shows syllables, form objects, and the translations of each item
    Given an entry with published syllables, a form with a pronunciation, published translations of a sense, an example's sentence, and a collocation, a translation of a superseded example's sentence, and a published phrases list with phrase entries and a saying
    When its document is projected and read
    Then the entry has its syllables, each form is an object with irregular and its pronunciation, and each sense, example, and collocation shows its own translation in the read's language, every one with lang=all, none without a language, and the superseded example's translation nowhere
    And each example carries its sentence_id, a phrase entry its phrase_type, and the headword's phrases are grouped under the sense they are filed under, then as phrasal verbs, idioms and fixed phrases, and compounds, with the sayings and their meaning and translation

  @catalog/new-fields-api @api
  Scenario: The new fields are validated and served through the API
    Given an agent submits syllables, a form with a pronunciation, and a translation of an example
    When the payloads break a rule, or once they are reviewed and published
    Then a malformed ipa, an ipa without an accent, or an unserved language is 400, syllables that do not spell the lemma are 422, and the public entry serves the published fields

  @catalog/picture @usecase
  Scenario: A sense shows its published picture and the entry the first one
    Given published image facts on the second sense of an entry, then on the first
    When the entry is read
    Then each sense shows its picture, and the entry shows the picture of its first sense in inventory order that has one, with that sense's id
    And the summaries of lists and search give that picture's URL, and the review of the image fact with include=review
    And once the first sense's image fact is retracted the entry shows the second sense's picture again

  @catalog/picture-example @usecase
  Scenario: A picture of an example shows only with its published example
    Given a published image fact whose picture shows a published example of its sense
    When the entry is read, and after the example is retracted
    Then the picture shows with the example's sentence while the example is published, and not at all once it is retracted

  @catalog/cefr-level @usecase
  Scenario: A word the reference lists do not level shows its cefr fact's level, marked by where it comes from
    Given words with a curated level, an estimated level, and a reference level
    When they are read and listed
    Then a curated or estimated level is the entry's level and every part of speech's, and is marked curated or estimated in the entry and its summaries
    And a reference level is marked reference and stands over any cefr fact

  @catalog/cefr-api @api
  Scenario: A curated level shows on a real Worker
    Given a word the reference lists do not level
    When a curator submits its level with curation
    Then the entry, its meanings, and the entry list filtered by that level show it as curated, with the fact behind it under include=review
