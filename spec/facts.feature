Feature: Facts and review
  Every claim is one fact. Each fact is reviewed once and published on its own: the decision
  models a kind names (Jev, luna) settle a pass when their scores reach its thresholds, and the
  LLM decides everything they do not settle. A sense inventory, a phrases list, and one
  translation per translated item and language are facts like any other.

  @facts/review-flow @api
  Scenario: A submitted fact is reviewed through the queue and published
    Given an agent submits a fact
    When the review queue consumer processes its job and the reviewer passes it
    Then the fact is published and visible on the public API

  @facts/review-publish @usecase
  Scenario: A passing review publishes the fact and records what was judged
    Given a pending fact
    When its decision model passes it
    Then the fact is published with the reviewer, model, verdict, confidence, and context

  @facts/publish-with-flaws @domain
  Scenario: Uncertain reviews publish; only failures reject
    Given a review verdict
    When the decision is made
    Then pass and uncertain publish the fact, and fail or a context with nothing to judge rejects it

  @facts/jev-policy @domain
  Scenario: A decision model's scores map to a verdict
    Given a decision model's answers to every question and its pass threshold
    When its opinion is recorded
    Then its score is its lowest answer, at the threshold it reads pass, below 0.5 fail, and uncertain between

  @facts/reviewer-routing @domain
  Scenario: Each kind names the decision models that judge it first
    Given the fact-kind registry
    Then senses, form, relation, grammar, morphology, phrases, sentence_meaning, and productive_use ask Jev, translation and topic ask Jev and luna, syllables asks luna, and pronunciation, example, and collocation go to the LLM alone
    And a plan may skip straight to the LLM, which ends every chain

  @facts/second-opinion @domain
  Scenario: The decision models settle only a pass
    Given a decision request with its models, how they combine, and their thresholds
    When the models answer
    Then min settles when every model reaches its threshold, any when one does, and mean when the mean score reaches the mean threshold
    And whatever they do not settle goes to the LLM, whose verdict is final, the review naming every reviewer asked and keeping each opinion

  @facts/one-shot-review @usecase
  Scenario: A fact is reviewed once by the decision models and then the LLM
    Given a pending fact whose kind names decision models
    When the decision models settle a pass, or do not and the LLM passes, fails, or is unsure
    Then a settled pass publishes without asking the LLM, and otherwise the LLM verdict decides with its confidence
    And an unreachable reviewer leaves the fact pending for a retry

  @facts/second-opinion-api @api
  Scenario: The one-shot review through the queue on a real database
    Given a translation of a sense that Jev and luna score low and the LLM passes, and one that luna alone passes
    When the queue consumer reviews them
    Then the first is published with reviewer jev+luna+llm and every opinion, and the second with reviewer jev+luna without asking the LLM

  @facts/second-opinion-context @domain
  Scenario: The LLM sees the claim in context
    Given a sense inventory, a form, or a fact about a sense
    When its review is planned
    Then the LLM prompt names the lemma, the part of speech, and the entry's senses

  @facts/proper-nouns @domain
  Scenario: Inventory and phrase review admit the proper nouns a learner's dictionary prints
    Given a sense inventory or a phrases list
    When its review is planned
    Then its questions and rubric state one proper-noun rule
    And an established country, continent, nationality, language, people, religion, adherent, scripture, festival or holiday, day or month, major world city, or well-known geographical feature counts, such as "London", "New York", or "the Pacific"
    And a personal name, a brand or company name, an organisation, or a minor place does not count, nor does a proper noun as a sense of a spelling with other capitalization

  @facts/variant-british-main @domain
  Scenario: Spelling variants are recorded on the British entry
    Given a variant form fact
    When its review is planned
    Then the LLM alone judges it, failing a British spelling recorded as a variant of an American one

  @facts/second-opinion-relation-type @domain
  Scenario: The relation rubric fails a relation of the wrong type
    Given a relation fact
    When its review is planned
    Then the LLM is asked whether the claim holds and its type is the most accurate one
    And the rubric says substitutable senses are synonyms, hypernyms are strict kind-of links between nouns or verbs with informative heads, and part_of is a distinct component, not a material, ingredient, or generic part
    And it judges the relation between the words, not a detail one gloss mentions and the other omits

  @facts/relation-rubric-audit @domain
  Scenario: The relation rubric names the failures an audit found
    Given a relation fact
    When its review is planned
    Then the rubric fails a body part as part of a person-type noun, a hypernym the substitution test shows is a synonym, a hypernym without a named distinguishing feature, and a near-generic head
    And it fails co-hyponyms of one set as antonyms, and a light verb as a synonym of a full verb

  @facts/relation-decision @domain
  Scenario: Jev judges an everyday relation against its type's threshold
    Given an everyday synonym, antonym, hypernym, and part_of, and a domain hypernym
    When their reviews are planned
    Then Jev is asked about each everyday relation with the rules of its type in the question, passing a synonym at 0.7, an antonym at 0.9, and a hypernym or part_of at 0.8, and the LLM decides the rest
    And a domain hypernym goes to the LLM alone

  @facts/relation-target-senses @usecase
  Scenario: The relation reviewer sees the target's other senses
    Given a relation to a sense of an entry with several senses
    When the LLM reviews it
    Then the rubric lists the target entry's other senses
    And fails the relation when another sense of the target is the better match

  @facts/relation-one-type-per-entry @domain
  Scenario: A sense relates to another entry by one type only
    Given a live relation from a sense to a sense of another entry
    When a relation of another type is submitted between that sense and any sense of that entry, from either end of a symmetric type
    Then it is refused with the live relation it conflicts with
    And a relation of the same type, or from another sense, is admitted, and a rejected relation revived beside a rival is refused too

  @facts/relation-one-layer @domain
  Scenario: A broader term belongs to one layer
    Given a sense with an everyday hypernym to a sense of an entry, or a biology one
    When a hypernym of the other layer to a sense of the same entry is submitted
    Then it is refused naming the layer that holds it, while another hypernym of the same layer is admitted

  @facts/relation-layers @domain
  Scenario: A hypernym carries its layer in its claim
    Given an everyday hypernym, a biology hypernym, a medicine hypernym submitted from its target end, and a synonym with a domain
    When their content keys and orientation are computed and the synonym is validated
    Then the domain extends the content key, a directed relation keeps its direction and domain, and only a hypernym may carry a domain

  @facts/relation-layer-rubric @domain
  Scenario: Each layer has its own rubric, and a part attaches to its most general whole
    Given an everyday hypernym, a biology hypernym, and a part_of between two senses
    When their reviews are planned
    Then the everyday rubric accepts the school-science classes (mammal, bird, fish, insect, reptile, amphibian) beside everyday categories and fails a technical taxon below them and a word a learner would not use as its category, the biology rubric passes only a real term of that taxonomy and fails an invented node, and the part_of rubric fails a part attached to a narrower kind of its whole

  @facts/relation-no-hypernym-cycle @domain
  Scenario: Two entries are never each a kind of the other
    Given a live hypernym from a sense of one entry to a sense of another
    When a hypernym is submitted the other way between any of their senses
    Then it is refused

  @facts/relation-write-rules-api @api
  Scenario: The relation write rules answer 422
    Given a published synonym between two entries
    When an agent submits a hypernym between the same sense and the other entry, or a hypernym that closes a 2-cycle
    Then the API answers 422 invalid_reference naming the rule and the live relation

  @facts/relation-shown-ends @usecase
  Scenario: A relation links only senses a published inventory of a live entry lists
    Given a sense of a live entry with a published inventory, a sense listed only by a pending inventory, and a sense of an entry that is not live
    When an agent submits a relation to each, or a fact about a sense no published inventory lists
    Then only the first is accepted, and the others are invalid references that say to name the word in blocked_on

  @facts/relation-shown-ends-api @api
  Scenario: A relation to a word without a published inventory is refused over HTTP
    Given an entry whose inventory is published and one whose inventory is still pending
    When an agent submits a synonym between their senses, and again once the second inventory publishes
    Then the first is 422 invalid_reference naming blocked_on, and the second is 201

  @facts/hypernym-question @domain
  Scenario: Jev's hypernym question rules out synonymy and generic heads
    Given a hypernym relation fact
    When its decision question is planned
    Then the question says mutual substitutability is synonymy, hypernymy holds only between nouns or verbs, and a generic head does not count

  @facts/translation-rubric @domain
  Scenario: Translations are judged as a bilingual dictionary would
    Given a translation of a sense, of a sentence, and of a collocation
    When their reviews are planned
    Then a sense equivalent asks Jev at 0.9 and luna at 0.8, either settling a pass, and the LLM decides otherwise with a rubric that accepts verb-like or descriptive renderings of function words, bracketed usage notes, and for a noun sense an equivalent that also reads as a verb or adjective, and rejects a wrong meaning, a different sense, a noun-only equivalent of a verb sense, unnatural wording, or equivalents of unrelated senses
    And a sentence or collocation translation goes to the LLM alone, which fails a rendering that is unfaithful to the text or unnatural, names the sense a sentence is an example of, and for a saying names its meaning and also passes an established saying of the language with the same meaning
    And a translation whose subject is not what it claims to translate is unreviewable

  @facts/translation-of @domain
  Scenario: A translation names what it translates and is about it
    Given translations of a sense, a sentence, and a collocation
    When they are submitted
    Then each names what it translates in of (sense, sentence, or collocation; example is no longer one), a sense equivalent is about the sense and at most 200 characters, a sentence translation about the sentence, a collocation translation about that fact, and any other subject is an invalid reference
    And an example names its sentence, by id or by text, and a translation is keyed by its language, what it translates, and its text, one live per subject and language

  @facts/translation-per-item-api @api
  Scenario: Each translated item has its own translation fact
    Given a sense with a published example and a published collocation
    When an agent submits a zh translation of the sense, of the example's sentence, and of the collocation, a second zh translation of the sense, and one about the wrong subject
    Then the three are created and reviewed on their own, the second is 409 conflict, the wrong subject is 422, and the public entry shows the sense equivalent, the example translation, and the collocation translation in zh
    And once the example is superseded by one with another sentence its translation no longer shows and the entry's translations item names the new sentence

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

  @facts/unreviewable @domain
  Scenario: A meaning-dependent fact cannot be judged without a gloss
    Given an example, translation, or relation whose sense no live inventory lists
    When its review is planned
    Then it is rejected as unreviewable without asking a reviewer

  @facts/independent @usecase
  Scenario: A fact never waits for another fact
    Given an example of a sense whose inventory is still pending
    When the example is reviewed
    Then it is judged against the pending inventory's gloss and decided on its own

  @facts/dedupe @usecase
  Scenario: Resubmitting a live fact returns it
    Given a pending or published fact
    When an agent submits the same content again
    Then the existing fact is returned with created=false and nothing is enqueued

  @facts/rejected-before @usecase
  Scenario: Content a review rejected is refused without a new review
    Given a fact review rejected
    When an agent submits the same kind, subject, and content again
    Then it is refused as rejected_before with the earlier fact and its reason, nothing is enqueued, and a curator may still submit it

  @facts/rejected-before-api @api
  Scenario: Resubmitting rejected content answers 409 rejected_before
    Given syllables a review rejected
    When an agent submits them again, and then a different division
    Then the first is 409 rejected_before naming the rejected fact and its reason with no reviewer asked, and the second is 201

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
    Given a sense of an inventory to submit
    When its gloss starts in lowercase, has no final period, is too short or too long, or embeds an example
    Then the submission is invalid and the message names each rule to fix
    And inventories stored before the rule still read

  @facts/inventory-format @domain
  Scenario: An inventory lists every sense once, the common ones first
    Given a sense inventory to submit
    When it has no common sense, puts a common sense after an extra one, or names an existing sense twice
    Then the submission is invalid naming the rule, and a stored inventory names every sense by id

  @facts/inventory-admission @domain
  Scenario: An inventory keeps only senses of its entry
    Given an entry with senses and an inventory naming sense ids
    When the inventory is admitted
    Then an id that is not a sense of the entry is an invalid reference naming it, and new senses without ids are admitted

  @facts/inventory-current @domain
  Scenario: An entry's current inventory is the live one no live correction supersedes
    Given an entry's inventories in every status, a pending correction of a published one, and a filter of published only
    When its current inventory and its senses are read
    Then the pending correction stands for its original, the published-only read keeps the original, and an entry with no live inventory has none and no senses

  @facts/inventory-assigns-ids @usecase
  Scenario: Submitting an inventory creates its new senses
    Given an entry with an existing sense
    When an agent submits an inventory that keeps it by id and adds senses without ids
    Then each new sense gets a sense row of its part of speech and the stored inventory names every sense by id, the kept one by its own

  @facts/inventory-settled @usecase
  Scenario: A published inventory is decided once
    Given an entry whose sense inventory is published
    When a producer agent submits another inventory, as a correction or not
    Then it is refused as inventory_settled, while a curator may submit a correction that supersedes it

  @facts/inventory-api @api
  Scenario: An inventory is reviewed, published, and settled on a real database
    Given an entry with no inventory
    When an agent submits an inventory of new senses and the queue reviews it, then another inventory, then a curator corrects it dropping a sense
    Then Jev is asked one question per gloss and the LLM judges the whole inventory unless Jev settles it, the published inventory gives the entry its senses with ids in the public entry, the second submission is 403 inventory_settled, and the curator's correction removes the dropped sense from the public entry

  @facts/inventory-rubric @domain
  Scenario: An inventory is judged as a learner's dictionary's sense inventory
    Given a sense inventory of an entry
    When its review is planned
    Then Jev is asked one question per sense about its gloss and labels, and the LLM rubric numbers every sense with its part of speech and gloss, common in order and then extra
    And it fails only a list that misses a main general-knowledge sense a learner's dictionary lists for A1 to B1 learners, holds two duplicate or over-split common senses, puts a rare, archaic, technical, legal, specialist, or regional-only sense in common, gives a sense a part of speech whose grammatical function it does not have, puts a main sense in extra, leaves the word's best-known meaning out of the first three common senses, or has a wrong gloss or label
    And it passes every other list, never failing for another order of common senses, a borderline placement, a missing rare sense, an idiom or fixed phrase not labelled idiom, phrase, or saying, or the main sense of an entry whose every sense is technical, specialist, or regional ranked common, and its reason names each sense to change

  @facts/sense-list-capitalization @domain
  Scenario: An inventory is never failed for the senses of a differently capitalized entry
    Given an inventory of an entry, and the other live entries spelled like its lemma but for letter case
    When its review is planned
    Then the rubric judges only the exact spelling, says a sense of a differently capitalized spelling belongs to that other entry and is never missing, and names each such entry as separate

  @facts/sense-list-capitalization-api @api
  Scenario: The review of an inventory loads the live entries that differ only in letter case
    Given live entries "may" and "May", and an entry "MAY" that is not live
    When the queue consumer reviews an inventory of "may"
    Then its review context carries "May" alone as a case variant, and the rubric names "May" as a separate entry

  @facts/phrases-format @domain
  Scenario: A phrases list names typed phrases, each once
    Given a phrases list to submit
    When an item has no type or one outside phrasal_verb, compound, idiom, fixed_phrase, and saying, a phrase item is one word, a saying is not a complete sentence or names a sense, an item gives both an id and a text, or a phrase is named twice in any letter case
    Then the submission is invalid naming the rule, and a stored list names every item by id

  @facts/phrases-admission @domain
  Scenario: A phrases list belongs to a single-word headword and names phrases containing it
    Given a phrases list on a headword
    When it is admitted
    Then a list on a multiword entry, or naming a phrase that does not contain the headword, is an invalid reference naming the phrases, and its content key is its typed items as a set

  @facts/productive-use-review @domain
  Scenario: A productive use is judged by one Jev question per tier, worded for the claimed value
    Given a productive use of a part of speech of the entry's common senses, claiming native and learner each active or passive
    When it is planned for review
    Then Jev is asked about native and learner with the word, the part of speech, the common senses of that part of speech with their labels, and the word's frequency
    And an active claim is asked whether the tier uses the word itself, a passive one whether the word is of a passive kind, both must reach 0.8, and below that the LLM judges both tiers together
    And a part of speech with no common sense in the live inventory is unreviewable

  @facts/productive-use-admission @api
  Scenario: An entry holds one productive use per part of speech of its common senses
    Given an entry with common verb and noun senses and an extra adjective sense
    When an agent submits productive uses
    Then one per part of speech is created, a second for the same part of speech is 409 conflict, the adjective is 422 invalid_reference, and native false with learner true is 400

  @facts/phrases-typed @domain
  Scenario: A typed phrases list names each target once, a saying as a sentence, and a sense of the headword
    Given a phrases list with entry items, sayings, and items filed under a sense
    When it is admitted
    Then a target named twice, a saying that is not a complete sentence, and a sense the headword's current inventory does not list are invalid references naming each

  @facts/phrases-resolve @usecase
  Scenario: A phrases list names its entries and sayings by text
    Given a headword with a published inventory
    When an agent submits a list naming phrases and a saying by text, a list that does not fit the headword, and the same list by ids
    Then each phrase resolves to the entry with exactly that lemma, created not live when there is none, and the saying to the sentence with that text, created when there is none; a refused list creates nothing; the list by ids is the same live fact; and an unknown id is an invalid reference

  @facts/sentence-resolve @usecase
  Scenario: An example names its sentence, found or created by text
    Given senses of two entries
    When an agent submits examples with the same text in another letter case or spacing, one by sentence id, and one by an unknown id
    Then one sentence holds the text, every example stores its id as its payload and object and content key, and the unknown id is an invalid reference; a submission about no subject creates no sentence

  @facts/sentence-meaning @domain
  Scenario: A saying's meaning is a dictionary-style gloss of what it means
    Given a sentence meaning about a saying
    When it is submitted and its review is planned
    Then it is a gloss in dictionary style about a sentence, one live per sentence, and Jev is asked whether the saying means it, then the LLM rubric fails a literal meaning, a wrong one, or the saying quoted as its gloss

  @facts/phrases-rubric @domain
  Scenario: A phrases list is judged item by item
    Given a phrases list of a headword
    When its review is planned
    Then Jev is asked one question per item naming its type and, when given, its sense: whether a learner's dictionary prints it as that type of the headword, or for a saying whether it is an established saying
    And the LLM rubric numbers each item with its type and sense, passes idioms, fixed phrases, and phrasal verbs a learner's dictionary prints, fails a plain description ("white rice"), a coined combination ("telephone in"), a wrong type, a complete sentence not typed saying, or a sense the phrase does not belong to, never fails for a missing phrase, a missing sense, or an idiom typed fixed_phrase or the reverse, and names each wrong item by number

  @facts/phrases-admit @usecase
  Scenario: A published phrases list admits its entry items as entries
    Given a headword of a batch
    When its phrases list publishes, and later a correction that drops one phrase publishes
    Then each entry item is a live entry of the headword's batch, a saying admits nothing, and the dropped phrase stops being live unless another published list still names it

  @facts/phrases-api @api
  Scenario: A phrases list admits its phrases on a real database
    Given live headwords "give" and "front", and "give up" listed under "give"
    When phrases lists of "give" and "front" publish through the queue, one naming "in front of", and a curator corrects the list of "give" to drop "give up"
    Then "give up" and "in front of" are live entries in their headword's batch with items of their own and are listed among the headword's phrases, a phrases list on a phrase is 422, and once dropped "give up" is no longer live and has no items

  @facts/phrases-typed-api @api
  Scenario: A typed list files a compound under a sense and keeps a saying a sentence
    Given a headword with a published sense
    When an agent submits a list with a sense of no inventory, a lowercase saying, and then a compound under the sense and a saying, and its saying gets a meaning and a translation
    Then the first is 422 and creates nothing, the second 400, the managed view shows each item with its text, the compound is a live entry typed compound, the saying no entry, the headword has a sayings item until the meaning publishes, and the public entry files the compound under its sense and shows the saying with its meaning and translation, which GET /v1/sentences/{id} serves too

  @facts/ipa-format @domain
  Scenario: A pronunciation holds one broad IPA transcription
    Given a pronunciation to submit
    When its ipa packs two transcriptions, carries slashes, brackets, or syllable dots, uses a symbol outside broad English IPA or the r-coloured ɚ and ɝ, or an American ipa writes ɛ
    Then the submission is invalid and the message names the symbols to replace, such as ɹ with r, ɚ with ər, and ɛ with e in American, in a pronunciation and a form ipa alike

  @facts/translation-language @domain
  Scenario: A translation is submitted in a served language
    Given a translation to submit
    When its language is zh, or another tag such as zh-Hans, zh-Hant, or fr
    Then zh is accepted, any other tag is invalid and the message names the served languages

  @facts/write-labels @domain
  Scenario: Facts carry optional usage labels
    Given a sense register or region in an inventory, a form part of speech, or a pronunciation strength and part of speech
    When the fact is reviewed and published
    Then the reviewer is asked about the labelled form, and the public entry shows each label

  @facts/write-rules-api @api
  Scenario: Write rules over HTTP
    Given an agent key and senses of different entries
    When it submits a mirrored antonym, a relation inside one entry, an inventory with a malformed gloss, two packed transcriptions, and a translation in an unserved language
    Then the API answers 200 with the first fact, 422 invalid_reference, and 400 invalid_request with the rules to fix

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
    Given a published fact and a correction of it
    When the original leaves published after the correction's checks read it but before its write
    Then the correction's write, which checks the original is published in the same statement, is refused as 409 conflict

  @facts/one-live-correction @usecase
  Scenario: A fact has at most one live correction
    Given a published fact with a live correction
    When an agent submits another correction of it, or an admin re-reviews a rejected correction of it
    Then it answers 409 conflict saying the fact already has a live correction

  @facts/exclusive-slot-race @api
  Scenario: Concurrent corrections cannot both go live
    Given a sense with a published grammar fact
    When two agents submit different corrections of it at the same time
    Then one is pending and the other conflicts, so the sense holds one published and one pending grammar fact

  @facts/correction @usecase
  Scenario: A published correction supersedes the original in the same write
    Given a published fact and a pending correction of it
    When the correction is published
    Then the original is superseded; a rejected correction leaves the original published

  @facts/supersede-api @api
  Scenario: A correction replaces the original atomically on a real database
    Given a published example and a pending correction of it
    When the review queue publishes the correction
    Then the original is superseded and the public entry shows only the correction

  @facts/review-idempotent @usecase
  Scenario: Duplicate deliveries change nothing
    Given a fact that is already decided
    When its review job is delivered again
    Then the review is skipped and the status is unchanged

  @facts/transport-retry @usecase
  Scenario: A reviewer outage is not a verdict
    Given a decision model or the LLM is unreachable
    When a fact is reviewed
    Then the fact stays pending and the error propagates

  @facts/reviewer-timeout @domain
  Scenario: A gateway call that never answers times out as a transport failure
    Given the model gateway accepts a review call and never answers
    When the call has waited the gateway timeout
    Then it fails as a transport error, so the queue retries the job instead of the batch stalling

  @facts/transport-retry-api @api
  Scenario: The queue retries a job when a reviewer is down
    Given the reviewer gateway or the Decisions API answers 503
    When the queue consumer processes the job
    Then the message is retried and the fact stays pending

  @facts/review-batch-concurrent @api
  Scenario: The queue consumer reviews the facts of one batch concurrently
    Given a batch of review jobs for independent facts
    When the queue consumer processes the batch
    Then their reviewer calls overlap and every fact is decided

  @facts/reconcile @usecase
  Scenario: Stuck facts are re-enqueued
    Given facts pending for more than an hour
    When the reconciler runs
    Then their review jobs are enqueued again
    And a fact it re-enqueued is not enqueued again until another hour has passed, however often the reconciler runs

  @facts/reconcile-api @api
  Scenario: The cron re-enqueues a stuck pending fact
    Given a fact pending for more than an hour and one submitted just now
    When the scheduled handler runs
    Then the stuck fact's review job is enqueued and the fresh one's is not

  @facts/retract @usecase
  Scenario: Retract a fact
    Given an agent's own pending or published fact
    When it retracts the fact
    Then the fact is retracted; another agent may not, and retracting twice is a no-op

  @facts/rereview @usecase
  Scenario: Admins send a rejected fact back through review
    Given a rejected fact, and a published one
    When an admin re-reviews it
    Then the rejected fact is pending again and enqueued, unless another live fact took its place, and a published fact is a conflict

  @facts/rereview-under-correction @usecase
  Scenario: A fact under correction is not revived
    Given a rejected fact that a pending or published correction supersedes
    When an admin re-reviews the fact
    Then it answers 409 conflict pointing at the correction, and the fact keeps its status

  @facts/rereview-api @api
  Scenario: A rejected fact goes back through review and publishes
    Given a fact the reviewer rejected
    When an admin re-reviews it and the reviewer then passes it
    Then it moves from rejected to pending to published and is publicly visible, and re-reviewing the published fact is 409

  @facts/rereview-conflict @api
  Scenario: A re-review never makes a second live fact
    Given a rejected example whose text a curator resubmitted, so it is live again
    When an admin re-reviews the rejected example
    Then it answers 409 conflict and nothing changes

  @facts/rereview-admits @usecase
  Scenario: A revived fact must still fit its subject
    Given a rejected fact whose subject has since changed so that the payload no longer fits it, such as a collocation whose form was retracted
    When an admin re-reviews it
    Then it answers 422 invalid reference with the same reason a submission gets, and the fact stays rejected

  @facts/manage-api @api
  Scenario: Fact management over HTTP
    Given an agent's fact
    When the agent tries to re-review it, retracts it, and reads stats
    Then re-review is forbidden, retraction succeeds, and stats count it

  @facts/usage-formats @domain
  Scenario: Grammar, word formation, and collocations are written in a fixed form
    Given a grammar, morphology, or collocation fact to submit
    When grammar names no property, a pattern or a preposition twice, no preposition or more than four, or a preposition outside the closed list, a part is spelt without its role's hyphen or out of written order, a word formation has no base, names a Latin or Greek root, or is one part that is not a base, or a collocation is one word
    Then the submission is invalid and the message names each rule to fix

  @facts/grammar-by-pos @domain
  Scenario: Grammar fits the part of speech of its sense
    Given a grammar fact about a sense
    When it is submitted
    Then a noun sense always takes its countability (or number plural_only in its place) and optionally its number, article, noun patterns, and prepositions, a verb sense always its transitivity and optionally verb patterns and prepositions, an adjective sense its position, adjective patterns, or prepositions, an adverb sense its usual position or prepositions, and a determiner or pronoun sense always its agreement
    And grammar of any other part of speech is refused by the kind's parts of speech, and a property or pattern that does not fit is an invalid reference that names what to remove

  @facts/grammar-plural-only @domain
  Scenario: A plural-only noun is marked plural in place of countable or uncountable
    Given grammar of a plural-only noun such as "jeans"
    When it is submitted and its review is planned
    Then number plural_only stands in place of countability, so grammar naming it needs no countability and grammar naming both is an invalid reference that says to remove countability
    And the questions and the rubric claim it is used only in the plural, with a plural verb and never with "a" or "an"

  @facts/grammar-review @domain
  Scenario: Grammar is reviewed one property at a time
    Given a grammar fact about a glossed sense
    When its review is planned
    Then Jev is asked one yes/no question per property, pattern, and named preposition, about that sense only
    And the LLM rubric lists every claim, passes when each holds, does not fail a pattern or preposition left out, and fails a named preposition that is wrong or rare with the sense

  @facts/morphology-parts @domain
  Scenario: A word formation spells its single word
    Given a morphology fact about an entry
    When it is submitted
    Then a multiword entry is an invalid reference
    And parts whose letters do not spell the word, allowing two changed letters where each pair of parts joins, are an invalid reference
    And an abbreviation or contraction such as "a.m.", "o'clock", or "Mrs" is one base part

  @facts/morphology-shortened @domain
  Scenario: A shortened word states what it shortens
    Given a word formation of an abbreviation, contraction, clipping, or blend
    When it is submitted, keyed, and its review is planned
    Then it gives shortened with its type and the words it shortens, its parts are one base part without a lemma or the submission is invalid, and what it shortens is part of the content key
    And the rubric claims a shortened word of that type and source, and fails a wrong source or type and a shortened word claimed as a plain simple word

  @facts/plural-only-shortened-api @api
  Scenario: Plural-only grammar and a shortened word's source are published through the queue
    Given a plural-only noun sense and a shortened word's entry
    When an agent submits grammar naming countability with plural_only, grammar naming plural_only alone, and a word formation with its shortened source, and the queue reviews them
    Then the first is refused as an invalid reference, and the public entries show the plural-only grammar without countability and the word formation with what it shortens

  @facts/function-word-grammar @domain
  Scenario: Adverbs state their usual position and determiners and pronouns what they agree with
    Given grammar of an adverb, a determiner, a pronoun, and an adjective
    When it is submitted and its review is planned
    Then an adverb takes front, mid, or end and never an adjective position, an adjective never an adverb position, a determiner or pronoun its agreement keyed in a stable order, and the questions and rubric ask about each claim

  @facts/morphology-base-lemma @domain
  Scenario: A base part names the entry it is
    Given a word formation whose base names a lemma
    When it is keyed, admitted, and its review is planned
    Then the lemma is part of the content key and a reference the write must find live, a base naming the word itself is refused, and the rubric names the base's word and fails a base that is not the present-day word the meaning comes from ("student" is study + -ent, not stud + -ent)

  @facts/morphology-base-lemma-usecase @usecase
  Scenario: A base lemma must be a live entry
    Given a derivative entry
    When its formation names a base lemma that is not a live entry, then the base is admitted, and the formation is retracted
    Then the first submission is an invalid reference that says to name the word in blocked_on, and the base lists the derivative in its family only while the formation is live

  @facts/morphology-review @domain
  Scenario: A word formation is judged as a learner's dictionary analyses the word
    Given a morphology fact
    When its review is planned
    Then Jev is asked whether the word is formed from exactly these parts by one synchronic rule, with the word's first senses in the state, and its pass settles
    And the rubric passes a simple word for a word not built on a present-day English word, and fails a Latin or Greek root part, a wrong, missing, or extra part, a wrong meaning, etymology or folk etymology, letters that only look like an affix, and a transparent derivative ("teacher") claimed as simple

  @facts/morphology-synchronic @domain
  Scenario: A word formation names no Latin or Greek root
    Given a word formation to submit
    When one of its parts is a root
    Then the submission is invalid, saying a word not built on a present-day English word is a simple word, one base part, while a simple word and a formation on a present-day base are accepted

  @facts/morphology-conversion @domain
  Scenario: A word made from another without an affix names that word
    Given a word formation of one base part, the word itself, naming another entry's lemma ("shelve" naming "shelf")
    When it is admitted and its review is planned
    Then it is admitted with that lemma as its reference, and the rubric claims the word is made from that word without a prefix or suffix, never a simple word

  @facts/collocation-contains-word @domain
  Scenario: A collocation contains its word
    Given a collocation fact about a sense
    When it is submitted
    Then its text must contain the lemma or one of the entry's live forms as whole words, or it is an invalid reference
    And a typographic apostrophe matches a straight one, a word with a fused clitic also reads as the word it is fused to, and the closed-class forms of be, have, and do count as forms of their lemma

  @facts/collocation-cap @usecase
  Scenario: A sense holds at most five live collocations
    Given a sense with five live collocations
    When another collocation is submitted
    Then it is a conflict, a resubmission of a live one returns it, and a correction that supersedes one takes its place

  @facts/collocation-rubric @domain
  Scenario: A collocation is a combination natives commonly use with this sense
    Given a collocation fact about a glossed sense
    When its review is planned
    Then the LLM alone is asked whether natives commonly use it with this sense in the claimed pattern
    And it fails free combinations, another sense, rare or unnatural wording, and the wrong pattern
    And the patterns include subject_verb ("the room spins"), verb_adjective ("go bankrupt"), and passive ("tormented by guilt"), and the rubric says a particle after a verb is verb_adverb and a verb with a preposition and its noun is verb_preposition

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

  @facts/syllables @domain
  Scenario: Syllables divide a single written word
    Given a syllables fact on an entry
    When it is submitted and reviewed
    Then its syllables must spell the lemma exactly and a phrase is refused, and luna judges the division against the word's careful pronunciation, one part per vowel sound and not its word parts, at 0.9, the LLM deciding otherwise

  @facts/form-irregular @domain
  Scenario: An irregular form is one no regular spelling rule gives
    Given an inflection of a single-word lemma
    When the rules add its suffix plainly, after a doubled letter, a dropped e, a y turned to i, an ie turned to y, or a c taking k
    Then a form none of them spells, such as "went", "children", "better", or "would", is irregular, and a variant or a phrase's form never is

  @facts/form-pronunciation @domain
  Scenario: A form may carry its pronunciation
    Given a form fact with ipa and accent
    When it is submitted and reviewed
    Then the pronunciation is part of its content key, so adding one is a correction, and the LLM alone judges the form with its transcription in that accent

  @facts/periphrastic-forms @domain
  Scenario: A periphrastic comparison is never a form
    Given a comparative spelled "more …" or a superlative spelled "most …"
    When it is submitted, or its entry is shown
    Then the submission is an invalid reference that names the inflected forms to record instead, and such a form is never irregular

  @facts/relation-ends @domain
  Scenario: A relation links common, current senses
    Given a relation whose target, or for a symmetric type either end, is ranked extra in its entry's inventory or is labelled dated
    When it is submitted, or a rejected one is re-reviewed back to life
    Then it is an invalid reference that names the sense, and a directed relation from a rare sense is admitted

  @facts/sense-region @domain
  Scenario: A sense states its region and register, and review enforces them
    Given an inventory sense with or without a region or a register
    When it is keyed and its review is planned
    Then the region is a label of the content key, the gloss question answers no for a sense used in only one variety with no region and for a formal, literary, dated, or ironic sense with no register, and the rubric fails such a sense

  @facts/number-sense-review @domain
  Scenario: A number sense is judged against the learner's dictionary number label
    Given an inventory sense of part of speech number
    When its review is planned
    Then its question asks for an established number (numeral) sense, the rubric says number is the learner's dictionary label of a cardinal or ordinal number, and no grammar fact is admitted on it

  @facts/relation-padding @domain
  Scenario: Relations do not pad a sense
    Given a synonym between two entries one of which records the other as a live spelling variant, and a relation rubric
    When they are submitted or reviewed
    Then the synonym is refused in either direction, a hypernym between them is admitted, and the rubric fails a synonym target an A1 to B2 learner cannot use or of another register

  @facts/relation-padding-usecase @usecase
  Scenario: The relation padding rules read the live store, and no category is capped
    Given entries with a recorded spelling variant, a category sense with many kinds, and a sense with a biology hypernym
    When a synonym between the spellings, a thirteenth kind of the category, and an everyday hypernym to the biology hypernym's entry are submitted
    Then the synonym and the second layer are invalid references, the thirteenth kind is created, and the biology hypernym's content key names its domain

  @facts/relation-padding-api @api
  Scenario: A synonym between spellings of one word is refused over HTTP
    Given "practise" recording "practice" as its spelling variant, each with a verb sense
    When a synonym between them is submitted
    Then it is 422 naming the spellings

  @facts/zh-translation-format @domain
  Scenario: A zh text uses fullwidth punctuation and lists each alternative once
    Given a zh translation
    When it carries ASCII ; , ( or ), or a sense equivalent repeats an alternative such as 建造；建造
    Then the submission is invalid and the message names the fullwidth marks or the repeat, and translations stored before the rule still read

  @facts/completeness-write-rules-api @api
  Scenario: The completeness write rules refuse what the rules would not count
    Given an entry with an adjective sense
    When a periphrastic comparative, a dotted or ɛ American pronunciation, an ASCII-punctuated zh translation, or a synonym to a dated sense is submitted
    Then each is refused, 422 for the write rules and 400 for the formats, with a message that names the fix

  @facts/picture-upload @usecase
  Scenario: A picture is stored once under the SHA-256 of its bytes
    Given a 1024×1024 WebP picture
    When an agent stores it, and stores it again
    Then it is stored once under the SHA-256 of its bytes and both answers give that id and its URL
    And a picture that is not a 1024×1024 WebP of at most 300 KB is an invalid request naming what is wrong

  @facts/image-submit @usecase
  Scenario: An image fact names a stored picture and, when it shows an example, an existing sentence
    Given a sense of a published inventory
    When an agent submits an image fact naming a picture that is not stored, or a sentence that does not exist
    Then the submission is refused as an invalid reference
    And with a stored picture it is pending, keyed by the picture's id, with the sentence it shows as its object

  @facts/image-review @domain
  Scenario: A picture is judged by looking at it, first without the word
    Given an image fact on a glossed sense
    When its review is planned
    Then the LLM first names the headwords the picture shows without being told the word
    And then judges the picture against the lemma, part of speech, and gloss with those guesses: the sense and not another, no literal idiom, no letters or logos, nothing offensive, no visual defects, and never the drawing style
    And a picture of an example is judged against that sentence, with no blind guess expected to name the word
    And a sense without a gloss, or a sentence that does not exist, is unreviewable

  @facts/image-review-flow @usecase
  Scenario: The LLM sees the picture in both steps and its verdict is final
    Given a pending image fact
    When it is reviewed
    Then both the blind look and the judgement are sent the picture, the judgement's verdict publishes or rejects it, and the review keeps the guesses
    And guesses that break their contract are a reviewer failure that leaves the fact pending, never a verdict

  @facts/image-api @api
  Scenario: A picture is stored, reviewed, and shown on a real Worker
    Given an agent key and a sense of a published inventory
    When the agent posts a picture to POST /manage/v1/media and submits an image fact naming it, and the queue reviews it
    Then both LLM calls carry the picture as an image part, and the entry, its sense, and the entry list show it
    And a replica sync lists the picture among the files it copies
    And a wrong-sized picture is 400 and an image fact naming a picture that is not stored is 422

  @media/base-url @api
  Scenario: A picture's URL is composed from the configured base, never stored
    Given a sense with a published image fact and a published topic tag, and a topic with a picture
    When the entry, the topic's senses, and the taxonomy are read
    Then each picture's url or image_url is `${MEDIA_BASE_URL}/<id>`
    And the stored views and their summaries name the picture by id alone, with no path and no host

  @media/base-url-shape @domain
  Scenario: Reading shapes stored picture ids with the base it is given
    Given stored entries and summaries that hold picture ids or none
    When they are shaped for a read with a media base
    Then each picture has `url` and each summary `image_url` under that base, and none when there is no picture

  @facts/cefr-review @domain
  Scenario: A level is estimated and judged by the same rule
    Given a word with common senses and a frequency
    When its level is classified, or a submitted level is reviewed
    Then the LLM alone chooses among the six levels from the senses and the frequency
    And a submitted level passes when it is right or one level off, and a word without common senses is unreviewable
