Feature: Reference data
  Word frequency and CEFR level come from external datasets, imported offline by
  scripts/reference/. They are reference data with provenance, not facts: no agent
  writes them and nothing reviews them. Every value names its source, and every
  source carries its license and the attribution to show with it.

  @reference/cefr-pos @domain
  Scenario: Profile parts of speech map onto ours
    Given CEFR-J and Octanove rows labelled with their own parts of speech
    When the import merges them
    Then lexical labels map one to one, modal, be, do, and have verbs become auxiliary, and "vern" becomes verb
    And numbers, infinitive "to", and unlabeled rows are dropped, slash variants become separate lemmas
    And an unknown label or level fails the import

  @reference/cefr-inflected-forms @domain
  Scenario: Only the base lemma of a verb paradigm becomes a CEFR row
    Given CEFR-J rows labelled be-verb, do-verb, and have-verb for "be", "do", "have" and their inflected forms such as "is", "'s", "done", and "had"
    When the import merges them
    Then only "be", "do", and "have" are kept, as auxiliary
    And the inflected forms are dropped and reported, while modal auxiliaries and the same spellings under another part of speech are kept

  @reference/cefr-precedence @domain
  Scenario: One CEFR level per lemma and part of speech
    Given a lemma and part of speech listed several times in one profile and again in another
    When the import merges them
    Then the profile listed first (CEFR-J) wins, and within a profile the lowest level wins

  @reference/frequency-rank @domain
  Scenario: Frequency keeps single word forms, keyed by lowercase spelling and ranked by Zipf
    Given wordfreq forms with multiword, numeric, symbol, and markup forms among them
    When the import ranks them
    Then only one-token forms of letters, combining marks, apostrophes, and periods remain
    And each is keyed by its lowercase spelling and ranked by Zipf, with ties sharing a rank
    And two forms with one key fail the import

  @reference/entry-read @api
  Scenario: An entry shows the CEFR levels of its exact lemma and the frequency of its word form
    Given an imported frequency for the word "bank" and CEFR rows for "bank" and for "Bank"
    When anyone requests the published entries "bank" and "Bank", and an agent requests "bank" through the management API
    Then the management entry "bank" carries the frequency and every CEFR level of "bank" with their source ids, and the public one the frequency without its source and each meaning the CEFR level of its part of speech
    And "Bank" carries the same frequency but only the CEFR levels of "Bank"
    And an entry whose lemma has no reference rows carries a null frequency and no CEFR levels

  @reference/sources @api
  Scenario: Every reference source is listed with its license and attribution
    Given imported reference sources
    When anyone requests the public sources endpoint, or an agent the management one
    Then each source is returned with its name, version, license and license URL, the changes Vocnet made, attribution, URL, and retrieval date

  @reference/import-idempotent @api
  Scenario: Reimporting a source replaces its rows
    Given the generated reference SQL applied once
    When it is applied again, or a newer import drops a row
    Then each source's rows are exactly those of the last import and nothing is duplicated
