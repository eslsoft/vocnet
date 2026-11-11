Feature: Public site
  Learners and developers use the dictionary without signing in. The site shows
  what the public API delivers and how to call it; the console sits under
  /console behind the admin sign-in.

  @site/sources @web
  Scenario: Every page credits the reference data sources
    Given the reference sources of GET /v1/sources
    When anyone opens a public page
    Then the footer names each source with its version and licence, and its attribution and licence terms on demand

  @site/entry @web
  Scenario: An entry reads like a learner's dictionary
    Given a published entry with pronunciations, levels, frequency, forms, senses in two parts of speech, a rare sense, word formation, and phrases
    When anyone opens /words/{lemma}
    Then the headword shows its syllables, UK and US pronunciations, CEFR level, and frequency band
    And meanings are grouped by part of speech with numbered senses: grammar, labels, gloss, Chinese translation, examples with translations, collocations, relations, and topics
    And rare senses wait behind a summary, and relations, the word family, and phrases link to their entries

  @site/entry-api @web
  Scenario: Every block shows the request and JSON slice it came from
    Given an open entry page
    When the reader opens the API toggle of a block
    Then the exact curl request with its jq path and the JSON slice of the response are shown, each with a copy button

  @site/entry-domain @web
  Scenario: The relation layer switch re-reads the entry with a domain
    Given an entry page in the everyday layer
    When the reader picks biology
    Then the URL and the read carry domain=biology and the specialist relations are marked with their domain

  @site/entry-missing @web
  Scenario: An unknown lemma is not in Vocnet yet
    Given no entry is spelled exactly like the lemma
    When anyone opens its page
    Then the page says it is not in Vocnet yet without retrying another spelling, and lists what a search for the same text finds

  @site/relation-link @critical @web
  Scenario: A relation link opens the related sense
    Given an entry with relations
    When the reader follows a related word
    Then its entry page opens at that sense, expanded and highlighted
