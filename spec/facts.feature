Feature: Facts and review
  Every claim is one fact. Each fact is reviewed and published on its own, by Jev
  when it is a checkable proposition and by a general LLM otherwise. When Jev does
  not pass a proposition, the LLM gives a second opinion that decides.

  @facts/review-flow @api
  Scenario: A submitted fact is reviewed through the queue and published
    Given an agent submits a fact
    When the review queue consumer processes its job and the reviewer passes it
    Then the fact is published and visible on the public API

  @facts/review-publish @usecase
  Scenario: A passing review publishes the fact and records what was judged
    Given a pending fact
    When Jev passes it
    Then the fact is published with the reviewer, model, verdict, confidence, and context

  @facts/publish-with-flaws @domain
  Scenario: Uncertain reviews publish; only failures reject
    Given a review verdict
    When the decision is made
    Then pass and uncertain publish the fact and fail rejects it

  @facts/jev-policy @domain
  Scenario: Jev probabilities map to a verdict
    Given Jev answers for every question
    When all are at least 0.8, any is below 0.5, or neither
    Then the verdict is pass, fail, or uncertain, with the minimum answer as confidence

  @facts/reviewer-routing @domain
  Scenario: Each kind has one reviewer chain
    Given the fact-kind registry
    Then entry, sense, form, relation, topic, grammar, and morphology go to Jev and then the LLM, and pronunciation, example, translation, and collocation go to the LLM

  @facts/second-opinion @domain
  Scenario: Only a Jev pass settles a proposition
    Given a reviewer in a chain
    When it answers pass, uncertain, or fail
    Then Jev settles only a pass, and the LLM settles every verdict

  @facts/relation-jev-floor @domain
  Scenario: A relation Jev all but rules out gets no second opinion
    Given a relation fact
    When Jev answers below the relation floor, far under its fail line
    Then the fail settles the fact without asking the LLM
    And a Jev fail above the floor still goes to the LLM

  @facts/second-opinion-chain @usecase
  Scenario: The LLM second opinion decides what Jev does not pass
    Given a pending proposition fact
    When Jev passes it, or Jev fails or is unsure and the LLM passes, fails, or is unsure
    Then a Jev pass publishes without asking the LLM, and otherwise the LLM verdict decides with its confidence
    And the review names both reviewers and records both opinions
    And an unreachable LLM leaves the fact pending for a retry

  @facts/second-opinion-api @api
  Scenario: The second opinion through the queue on a real database
    Given Jev fails a submitted entry and the LLM passes it
    When the queue consumer reviews it
    Then the entry is published with reviewer jev+llm and both opinions

  @facts/second-opinion-context @domain
  Scenario: The second opinion sees the claim in context
    Given an entry, sense, or form fact
    When its second opinion is planned
    Then the LLM prompt names the lemma, the part of speech, and the entry's other senses

  @facts/entry-lexical-unit @domain
  Scenario: A multiword entry is admitted only as a lexical unit
    Given an entry fact for a single word or for a multiword lemma
    When its review is planned
    Then a single word is asked whether it is an established word, as before
    And a multiword lemma is asked whether it is a fixed lexical unit that speakers learn as a whole
    And its rubric passes idioms, phrasal verbs and fixed grammatical phrases even when transparent, and everyday names of one kind of thing
    And it fails only a phrase that meets none of those, such as a descriptive phrase or a coined category label, judged from the phrase itself without any external word list

  @facts/second-opinion-relation-type @domain
  Scenario: The second opinion fails a relation of the wrong type
    Given a relation fact
    When its second opinion is planned
    Then the LLM is asked whether the claim holds and its type is the most accurate one
    And the rubric says substitutable senses are synonyms, hypernyms are strict kind-of links between nouns or verbs with informative heads, and part_of is a distinct component, not a material, ingredient, or generic part
    And it judges the relation between the words, not a detail one gloss mentions and the other omits

  @facts/hypernym-question @domain
  Scenario: Jev's hypernym question rules out synonymy and generic heads
    Given a hypernym relation fact
    When its Jev question is planned
    Then the question says mutual substitutability is synonymy, hypernymy holds only between nouns or verbs, and a generic head does not count

  @facts/translation-rubric @domain
  Scenario: Translations are judged as a bilingual dictionary would
    Given a translation fact
    When its review is planned
    Then the rubric accepts verb-like or descriptive renderings of function words and bracketed usage notes
    And accepts, for a noun sense, an equivalent that also reads as a verb or adjective, since Chinese does not mark part of speech
    And rejects a wrong meaning, a different sense, a noun-only equivalent of a verb sense, unnatural wording, or equivalents of unrelated senses

  @facts/example-offensive-sense @domain
  Scenario: An example of an offensive sense is judged as an illustration of that sense
    Given an example of a vulgar, offensive, or derogatory sense
    When its review is planned
    Then the rubric accepts a sentence that shows the sense in ordinary use
    And rejects one that uses another sense, is ungrammatical, or adds offence the sense does not need

  @facts/form-word-class @domain
  Scenario: A form is judged in the word class it inflects
    Given a form fact such as the past tense "breaded" of "bread"
    When its review is planned
    Then the Jev question names the word class that form type belongs to, such as verb for tenses, noun for plurals, and adjective or adverb for comparison
    And a spelling variant is asked about the word as a whole

  @facts/unreviewable @domain
  Scenario: A meaning-dependent fact cannot be judged without a gloss
    Given an example, translation, or relation whose sense has no live gloss
    When its review is planned
    Then it is rejected as unreviewable without asking a reviewer

  @facts/independent @usecase
  Scenario: A fact never waits for another fact
    Given an example whose sense gloss is still pending
    When the example is reviewed
    Then it is judged against the pending gloss and decided on its own

  @facts/dedupe @usecase
  Scenario: Resubmitting a live fact returns it
    Given a pending or published fact
    When an agent submits the same content again
    Then the existing fact is returned with created=false and nothing is enqueued

  @facts/submit-api @api
  Scenario: Submission over HTTP
    Given an agent key
    When it submits a fact twice, a fact about the wrong node type, and an invalid payload
    Then the API answers 201, 200, 422 invalid_reference, and 400 invalid_request

  @facts/symmetric-relation-once @usecase
  Scenario: A symmetric relation is one fact per pair of senses
    Given two senses of different entries
    When an agent submits a synonym or antonym from one sense and then from the other
    Then both submissions return the same fact, stored with the smaller sense id as its subject
    And a hypernym or part_of relation keeps the direction it was submitted in

  @facts/relation-across-entries @usecase
  Scenario: A relation links senses of two different entries
    Given two senses of one entry
    When an agent submits a relation between them, or from a sense to itself
    Then the submission is rejected as an invalid reference

  @facts/gloss-format @domain
  Scenario: A gloss is written in dictionary style
    Given a sense gloss to submit
    When it starts in lowercase, has no final period, is too short or too long, or embeds an example
    Then the submission is invalid and the message names each rule to fix
    And glosses stored before the rule still read

  @facts/ipa-format @domain
  Scenario: A pronunciation holds one broad IPA transcription
    Given a pronunciation to submit
    When its ipa packs two transcriptions, carries slashes or brackets, or uses a symbol outside broad English IPA
    Then the submission is invalid and the message names the symbols to replace, such as ɹ with r

  @facts/write-labels @domain
  Scenario: Facts carry optional usage labels
    Given a sense register, a form part of speech, or a pronunciation strength and part of speech
    When the fact is reviewed and published
    Then the reviewer is asked about the labelled form, and the public entry shows each label

  @facts/write-rules-api @api
  Scenario: Write rules over HTTP
    Given an agent key and senses of different entries
    When it submits a mirrored antonym, a relation inside one entry, a malformed gloss, and two packed transcriptions
    Then the API answers 200 with the first fact, 422 invalid_reference, and 400 invalid_request with the rules to fix

  @facts/orient-stored-relations @api
  Scenario: Stored symmetric relations take the stored orientation
    Given synonyms and antonyms stored before orientation, including a live mirrored pair
    When the orientation migration runs
    Then each keeps its review with the smaller sense id as subject, and a live duplicate stays for an agent to retract

  @facts/subject-validation @usecase
  Scenario: A fact must be about the right kind of node
    Given a kind whose subject is a sense
    When an agent submits it about an entry
    Then the submission is rejected as an invalid reference

  @facts/supersede-rules @usecase
  Scenario: Corrections supersede only a published fact of the same kind and subject
    Given a fact to correct
    When the correction names a missing, different, or unpublished fact
    Then the submission is rejected

  @facts/correction-needs-published @usecase
  Scenario: A correction goes live only while its original is published
    Given a published fact and a correction of it, submitted or rejected and re-reviewed
    When an admin re-reviews the original after the correction's checks read it but before its write
    Then the correction's write, which checks the original is published in the same statement, is refused as 409 conflict
    And no correction is live while its original is pending

  @facts/one-live-correction @usecase
  Scenario: A fact has at most one live correction
    Given a published fact with a live correction
    When an agent submits another correction of it, or an admin re-reviews a rejected correction of it
    Then it answers 409 conflict saying the fact already has a live correction

  @facts/single-gloss @usecase
  Scenario: A sense has one gloss
    Given a sense with a live gloss
    When an agent submits another gloss without superseding it, or a second correction
    Then the submission conflicts

  @facts/exclusive-slot-race @api
  Scenario: Concurrent corrections cannot both go live
    Given a sense with a published gloss
    When two agents submit different corrections of it at the same time
    Then one is pending and the other conflicts, so the sense holds one published and one pending gloss

  @facts/correction @usecase
  Scenario: A published correction supersedes the original in the same write
    Given a published gloss and a pending correction of it
    When the correction is published
    Then the original is superseded; a rejected correction leaves the original published

  @facts/supersede-api @api
  Scenario: A correction replaces the original atomically on a real database
    Given a published gloss and a pending correction of it
    When the review queue publishes the correction
    Then the original is superseded and the public entry shows only the correction

  @facts/revalidate-dependents @usecase
  Scenario: Facts judged against a corrected gloss are re-reviewed in place
    Given a sense with published examples, translations, and relations in both directions
    When a correction of its gloss publishes
    Then each of those facts is marked and enqueued for revalidation, stays published and public meanwhile, and is reviewed against the new gloss

  @facts/pending-dependent-current-gloss @usecase
  Scenario: A pending dependent cannot publish against a replaced gloss
    Given a pending example whose review read a gloss
    When a correction of that gloss publishes before the example's review is written
    Then the example's review is discarded, the example stays pending, marked, and enqueued
    And its next review reads the corrected gloss

  @facts/pending-dependent-api @api
  Scenario: A pending dependent is re-reviewed against the corrected gloss on a real database
    Given a pending example and a pending correction of its gloss
    When the correction publishes while the example is under review
    Then the example stays pending, and the next delivery publishes it judged against the corrected gloss

  @facts/relabel-no-revalidate @usecase
  Scenario: A register-only correction does not re-review dependents
    Given a sense with published examples, translations, and relations
    When a correction that keeps the gloss text and changes only its register publishes
    Then it supersedes the gloss, and nothing is marked or enqueued for revalidation

  @facts/correction-marks-live-dependents @usecase
  Scenario: Only a correction that changes the gloss marks pending and published dependents
    Given a sense with a published example and a pending example
    When a correction of the sense publishes
    Then a new gloss text marks and enqueues both examples, and a register-only correction marks and enqueues neither

  @facts/relabel-api @api
  Scenario: A register-only correction on a real database
    Given a published gloss with a published example and incoming relation
    When the queue publishes a correction that only adds a register
    Then the original is superseded, the public sense shows the register, and its dependents stay unmarked

  @facts/revalidation-outcome @domain
  Scenario: Revalidation unpublishes only on failure
    Given a published fact under revalidation
    When its new review is pass, uncertain, or fail
    Then it stays published with the new review, or moves to rejected
    And with no live gloss to judge against, it stays published with its standing review and loses only the mark

  @facts/revalidate-gloss-retracted @api
  Scenario: A retracted correction does not reject the facts waiting to revalidate against it
    Given a published gloss correction whose dependents are marked for revalidation
    When the correction is retracted before the queue delivers their jobs
    Then the dependents stay published with their standing reviews, unmarked, and no reviewer is asked

  @facts/revalidate-api @api
  Scenario: Revalidation through the queue on a real database
    Given a corrected gloss whose example and incoming relation were published
    When the queue delivers their revalidation jobs
    Then they stay published with reviews of the new gloss, and a fact about another sense is untouched

  @facts/retract-no-cascade @usecase
  Scenario: Retracting a gloss does not cascade
    Given a sense whose published gloss has dependent facts
    When the gloss is retracted
    Then nothing is marked or enqueued, and the sense and its facts drop out of the public view

  @facts/review-idempotent @usecase
  Scenario: Duplicate deliveries change nothing
    Given a fact that is already decided
    When its review job is delivered again
    Then the review is skipped and the status is unchanged

  @facts/transport-retry @usecase
  Scenario: A reviewer outage is not a verdict
    Given the reviewer gateway is unreachable
    When a fact is reviewed
    Then the fact stays pending and the error propagates

  @facts/transport-retry-api @api
  Scenario: The queue retries a job when the gateway is down
    Given the reviewer gateway answers 503
    When the queue consumer processes the job
    Then the message is retried and the fact stays pending

  @facts/review-batch-concurrent @api
  Scenario: The queue consumer reviews the facts of one batch concurrently
    Given a batch of review jobs for independent facts
    When the queue consumer processes the batch
    Then their reviewer calls overlap and every fact is decided

  @facts/reconcile @usecase
  Scenario: Stuck facts are re-enqueued
    Given facts pending for more than five minutes
    When the reconciler runs
    Then their review jobs are enqueued again

  @facts/reconcile-revalidation @usecase
  Scenario: Stuck revalidations are re-enqueued
    Given published facts marked for revalidation more than five minutes ago
    When the reconciler runs
    Then their review jobs are enqueued again

  @facts/retract @usecase
  Scenario: Retract a fact
    Given an agent's own pending or published fact
    When it retracts the fact
    Then the fact is retracted; another agent may not, and retracting twice is a no-op

  @facts/rereview @usecase
  Scenario: Admins send a decided fact back through review
    Given a published or rejected fact
    When an admin re-reviews it
    Then it is pending again and enqueued, unless another live fact took its place

  @facts/rereview-under-correction @usecase
  Scenario: A fact under correction is not revived
    Given a fact that a pending or published correction supersedes
    When an admin re-reviews the fact
    Then it answers 409 conflict pointing at the correction, and the fact keeps its status

  @facts/rereview-api @api
  Scenario: A rejected fact goes back through review and publishes
    Given a fact the reviewer rejected
    When an admin re-reviews it and the reviewer then passes it
    Then it moves from rejected to pending to published and is publicly visible

  @facts/rereview-conflict @api
  Scenario: A re-review never makes a second live fact
    Given a published gloss with a pending correction, and a rejected example whose text is live again
    When an admin re-reviews the gloss or the rejected example
    Then each answers 409 conflict and nothing changes

  @facts/rereview-orphaned-correction @api
  Scenario: A rejected correction cannot come back once its original is gone
    Given a published gloss, a rejected correction of it, and a second correction that published
    When an admin re-reviews the rejected correction
    Then it answers 409 conflict, the correction stays rejected, and the live gloss can still be corrected

  @facts/manage-api @api
  Scenario: Fact management over HTTP
    Given an agent's fact
    When the agent tries to re-review it, retracts it, and reads stats
    Then re-review is forbidden, retraction succeeds, and stats count it

  @facts/usage-formats @domain
  Scenario: Grammar, word formation, and collocations are written in a fixed form
    Given a grammar, morphology, or collocation fact to submit
    When grammar names no property or a pattern twice, a part is spelt without its role's hyphen or out of written order, a word formation has no base or root or is one part that is not a base, or a collocation is one word
    Then the submission is invalid and the message names each rule to fix

  @facts/grammar-by-pos @domain
  Scenario: Grammar fits the part of speech of its sense
    Given a grammar fact about a sense
    When it is submitted
    Then a noun sense takes only and always its countability, a verb sense always its transitivity and optionally patterns, and an adjective sense its position or adjective patterns
    And grammar of any other part of speech is refused by the kind's parts of speech, and a property or pattern that does not fit is an invalid reference that names what to remove

  @facts/grammar-review @domain
  Scenario: Grammar is reviewed one property at a time
    Given a grammar fact about a glossed sense
    When its review is planned
    Then Jev is asked one yes/no question per property and pattern, about that sense only
    And the LLM second opinion lists every claim, passes when each holds, and does not fail a pattern left out

  @facts/morphology-parts @domain
  Scenario: A word formation spells its single word
    Given a morphology fact about an entry
    When it is submitted
    Then a multiword entry is an invalid reference
    And parts whose letters do not spell the word, allowing two changed letters where each pair of parts joins, are an invalid reference

  @facts/morphology-review @domain
  Scenario: A word formation is judged as a learner's dictionary analyses the word
    Given a morphology fact
    When its review is planned
    Then Jev is asked whether the word is formed from exactly these parts with these meanings, or for one base part whether it is a simple word
    And the LLM rubric fails a wrong, missing, or extra part, a wrong meaning, folk etymology, and letters that only look like an affix

  @facts/collocation-contains-word @domain
  Scenario: A collocation contains its word
    Given a collocation fact about a sense
    When it is submitted
    Then its text must contain the lemma or one of the entry's live forms as whole words, or it is an invalid reference
    And a typographic apostrophe matches a straight one

  @facts/rereview-admits @usecase
  Scenario: A revived fact must still fit its subject
    Given a rejected fact whose subject has since changed so that the payload no longer fits it, such as a collocation whose form was retracted
    When an admin re-reviews it
    Then it answers 422 invalid reference with the same reason a submission gets, and the fact stays rejected

  @facts/collocation-cap @usecase
  Scenario: A sense holds at most five live collocations
    Given a sense with five live collocations
    When another collocation is submitted
    Then it is a conflict, a resubmission of a live one returns it, and a correction that supersedes one takes its place

  @facts/collocation-rubric @domain
  Scenario: A collocation is a combination natives commonly use with this sense
    Given a collocation fact about a glossed sense
    When its review is planned
    Then the LLM is asked whether natives commonly use it with this sense in the claimed pattern
    And it fails free combinations, another sense, rare or unnatural wording, and the wrong pattern

  @facts/usage-admission-api @api
  Scenario: Submissions that do not fit their subject are refused on a real database
    Given an adjective sense, a single-word entry, and a phrase entry
    When an agent submits noun grammar or a verb pattern for the adjective, a word formation for the phrase or one that does not spell the word, or a collocation without the word
    Then each is 422 invalid_reference with a message naming the rule, and a one-word collocation is 400 invalid_request

  @facts/usage-corrections-api @api
  Scenario: Grammar and collocations are corrected one correction at a time on a real database
    Given a sense with a published grammar fact and five published collocations
    When an agent submits a correction of the grammar and of one collocation, then a second correction of each
    Then each first correction is accepted, the collocation's although the sense is at its limit, and each second one is 409 conflict naming the live correction
    And once reviewed, each correction is published, its original superseded, and the sense still holds five live collocations
