Feature: Search
  Learners and developers find entries by an English headword or its start, by the words of a
  gloss or example, or by a Chinese word of a translation. Search reads the public view's
  full-text index and matches exactly as spelled after case folding: no typo correction, no
  stemming, no fallback.

  @search/rank @api
  Scenario: Hits rank by what matched, each entry once
    Given published entries whose lemmas, glosses, translations, and examples hold the query
    When anyone searches, page by page
    Then the exact lemma comes first, then lemmas that start with the query, then glosses, translations, and examples that hold every word of it, each entry once at its best rank, then by frequency and lemma, as word summaries with what matched; a misspelling or another inflection finds nothing

  @search/chinese @api
  Scenario: A Chinese word finds translations in the requested language
    Given published senses translated into Chinese
    When anyone searches a two-character Chinese word, a longer one, or one character, with lang or Accept-Language
    Then the entries whose translations in that served language hold it are found, and a read without a language or in Traditional Chinese finds none

  @search/tokens @domain
  Scenario: Chinese text is indexed by characters and character pairs
    Given a text or a query with Chinese and Latin parts
    When it is indexed or looked up
    Then every Chinese run is stored as its characters and their pairs, a query looks a run up by its pairs (a single character by itself), and Latin words are matched by the tokenizer

  @search/variant @api
  Scenario: A spelling variant finds its main entry
    Given a published entry "colour" with the published variant form "color"
    When anyone searches "color" or looks up the form "color"
    Then "colour" is found as the exact lemma and as the variant's entry, while the entry "color" is not found
