Feature: Work items
  Agents ask the server for the next work items of one type, the most valuable first, and no two
  agents hold the same item at once. Required slots stay open until a fact fills them; optional
  slots are complete after one honest pass. An item gets at most two passes before it leaves the
  queue as a ticket for a curator.

  @work/gaps @domain
  Scenario: The open work names what the entry lacks
    Given a live entry and its facts in every status
    When the gaps are computed from its pending and published facts
    Then an entry without a live inventory has only its senses gap
    And with one, missing paradigm forms, a pronunciation in either accent, an irregular form's pronunciation, the phrases list, word formation, and syllables of a single word, the productive uses, and the translations of the entry in each served language are entry gaps
    And each core sense lacking the category, parts, synonym, examples, topic, grammar, or collocations its part of speech needs, and each other common sense lacking its examples or grammar, is a sense gap
    And an entry that is not live has no gaps

  @work/sense-list-scope @domain
  Scenario: Only the common senses of the inventory count
    Given an entry whose current inventory ranks some senses extra
    When the gaps and completeness are computed
    Then the extra senses have no per-sense gaps, count no slots, and need no translation

  @work/core-senses @domain
  Scenario: Only core senses need the network, topic, and collocation slots
    Given an A1 entry whose inventory lists four nouns, two verbs, and an adjective as common in that order and a rare sense as extra
    When the gaps and completeness are computed
    Then the first three common senses, the first verb, and the first adjective are core and keep every slot their part of speech needs, with two examples
    And the fourth noun and the second verb need only their examples and grammar, the rare sense nothing, and completeness counts only the slots each sense's scope needs

  @work/core-senses-api @api
  Scenario: A published inventory narrows the items of the senses beyond the core ones on a real database
    Given a live entry
    When its inventory of four adjective senses and two verb senses, all common in that order, publishes
    Then the first three adjectives and the first verb have their synonym and collocation items, the first verb its topics item too, and the fourth adjective and the second verb have only their example and grammar items

  @work/translations-gap @domain
  Scenario: The translations gap lists every item of the entry a learner reads without a translation
    Given an entry with common and extra senses, examples, a pending correction of an example, collocations, and translations in every status
    When the gaps are computed
    Then one translations gap per served language lists each common sense, the sentence of each current example, and each live collocation with no live translation in that language, naming what each is
    And a pending correction stands for the example it corrects, a sentence several examples share is one slot, and the gap needs one slot per listed item

  @work/sayings-gap @domain
  Scenario: A headword's sayings need their meaning and their translation
    Given a headword whose phrases list names a saying, pending and then published
    When the gaps are computed
    Then a pending list asks nothing, and the published one opens a sayings gap naming each saying with no live meaning and adds each saying to the translations gap, until a meaning and a translation are live

  @work/translations-api @api
  Scenario: The translations item covers the whole entry in one language
    Given a live entry with a published inventory, an example, and a collocation
    When an agent claims its translations item and submits a zh translation of every listed item, and one translation is rejected
    Then the item names each sense, example, and collocation with what it is, its context carries the entry view, the pass with every translation published closes it, and a rejected one reopens the item naming only that item

  @work/claim-criteria @domain
  Scenario: A claimed item carries the standard its facts are reviewed by
    Given an item of any type
    When its criteria are rendered
    Then each kind of fact that fills it comes with the decision models asked, their exact questions, and how their scores settle a pass, the exact LLM rubric with placeholder values, and the kind's write rules
    And a topics item lists the taxonomy, and every item carries the write rules every submission meets

  @work/claim-criteria-api @api
  Scenario: The claim response carries each item's criteria
    Given an entry with a published noun sense
    When an agent claims its topics item and its synonyms item
    Then the topics item's criteria give the topic rubric with the seeded taxonomy and Jev and luna as its decision models, and the synonyms item's give Jev's synonym threshold

  @work/inventory-retry @api
  Scenario: A rejected inventory brings its item back once with the reasons, then it becomes a ticket
    Given a live entry whose senses item each pass works by submitting an inventory
    When review rejects the first pass's inventory, the second pass submits another, and review rejects it too
    Then the item comes back with one attempt and the rejected inventory with its review in its context's rejections, and after the second rejection no senses item is claimable and the entry has an open stuck_work ticket

  @work/relation-slots @domain
  Scenario: Relations fill slots, with no quotas and with layers
    Given a core noun sense with no relations, a biology hypernym, an everyday hypernym, its own part_of, parts attached to it, or a synonym or antonym in either direction
    When the gaps are computed
    Then it needs one everyday category, which a domain hypernym does not fill; once it has one it needs a part attached to it, which its own part_of does not fill; and it needs one synonym or antonym, which a live hypernym to a sense that can show, in any layer, also fills

  @work/relations-visible-ends @domain
  Scenario: A relation fills a slot only while its other end can show
    Given a sense whose live relations lead to senses listed by a live entry's inventory, by a dropped sense of a corrected inventory, or by an entry that is not live
    When the gaps are computed from the entry and the inventories at the other end of its relations
    Then only the relations whose other sense a live entry's current inventory lists fill the category, parts, or synonym slot

  @work/relations-visible-ends-api @api
  Scenario: A relation's other end leaving the dictionary reopens its slot on a real database
    Given an entry whose noun sense has two published everyday hypernyms, each to a sense of another entry
    When a curator corrects one other entry's inventory to drop the target sense, and the other entry stops being live
    Then the category slot stays filled while one hypernym can show, and opens once none can, rescored in the same request

  @work/relation-slots-by-pos @domain
  Scenario: The relation slots a sense needs depend on its part of speech
    Given a core sense of each part of speech
    When the gaps and completeness are computed
    Then only nouns need a category, nouns, verbs, adjectives, and adverbs a synonym or antonym, and pronouns and every other part of speech no relation slot

  @work/topics-gap @domain
  Scenario: Core nouns and verbs need a topic
    Given a core sense of each part of speech
    When the gaps are computed
    Then a noun or verb sense with no live topic fact has a topics gap, and every other part of speech has none
    And a pending topic fact closes the gap while a rejected one does not

  @work/usage-gaps @domain
  Scenario: Grammar, collocations, and word formation are gaps where a learner needs them
    Given an entry with a common sense of each part of speech
    When the gaps are computed
    Then noun, verb, adjective, adverb, determiner, and pronoun senses need one grammar fact, core noun, verb, adjective, adverb, determiner, preposition, and conjunction senses one collocation, and a single word, not a phrase, one word formation

  @work/slot-counts @domain
  Scenario: An entry's slots split into those published facts fill and those only pending facts fill
    Given an entry with every slot published, one filled only by a pending fact, and a pending inventory correction
    When the entry is assessed
    Then the slots total what completeness counts, the pending fill counts as pending, and the published count never exceeds what the live facts fill

  @work/scores @domain
  Scenario: An entry's completeness and credibility come from its facts and passes
    Given an entry with some slots filled, some optional slots passed without a value, and published facts settled by different review paths
    When the entry is assessed
    Then completeness is the filled share of the slots its gaps count, a passed slot counting as filled, and credibility is the lowest credibility of its published facts and its empty optional passes, 1 with none

  @work/credibility @domain
  Scenario: A fact is as credible as its kind and review path are measured right
    Given published facts settled by a curator, by a decision model alone, by the LLM after a decision model, and by the LLM alone, a pending fact, and an optional slot passed without a value
    When their credibility is read
    Then a curator's is 1, a decision model's pass and the LLM after one each have their measured rate, the LLM alone the measured rate of its kind, a pending fact none, and an empty optional pass a low rate so audits reach it

  @work/awaiting-review @domain
  Scenario: A piece of open work waits for the reviews that may change it
    Given an entry with pending facts that fill a gap, an unrelated open gap, a pending relation into a sense, and a pending inventory
    When the open work is computed over the live facts and over the published ones alone
    Then exactly the pieces the two computations disagree on await review and the others stay workable

  @work/item-priority @domain
  Scenario: The priority policy puts the batch first, then the band, then the entry's frequency, then the stage
    Given items of every type on entries of two batches, of every CEFR level, and without a level
    When their priority is computed
    Then every item of an earlier batch comes first; within a batch the bands go A1 to C2, then entries without a level, every stage of a band before the next band; within a band the more frequent entry comes first, and an entry's stage (1 identity, 2 network, 3 translation, 4 usage) orders its own work

  @work/item-upsert @domain
  Scenario: A rescore converges the stored items on the open work
    Given stored items and the open work of a rescore
    When they are reconciled
    Then each piece of open work updates the stored item of its type and node, keeping its id, or is new, and every other stored item is deleted

  @work/item-attempts @domain
  Scenario: A pass makes progress only when it fills more of the gap
    Given a worked item whose gap is unchanged, reshuffled, awaiting review, or partly filled, and an item nobody worked
    When the item is reconciled
    Then a pass that filled more of the gap starts the attempts over, an unchanged or reshuffled gap counts an attempt, and the awaiting and unworked items keep their attempts

  @work/optional-pass @domain
  Scenario: An optional slot is complete after a pass that found none
    Given a worked optional item whose pass found none, a worked required item, and a slot a pass completed
    When the item is reconciled and the gaps are computed
    Then the optional item is passed and leaves the open work, the required item is judged on its gap, and a completed slot counts as filled and has no gap

  @work/item-curation @domain
  Scenario: Two passes that do not fill an item make it a ticket
    Given items with fewer than two attempts, awaiting review, or with two
    When their state is read
    Then they are open, awaiting review, or a ticket

  @work/attempt-verdicts @domain
  Scenario: The rescore draws a verdict on every worked item it judges
    Given worked items whose gaps closed, filled more, stayed as claimed, stayed as claimed on the second pass, found none for an optional slot, or still await review, and items nobody worked
    When the items are reconciled
    Then they are closed, progressed, no progress, stuck, or passed, and the awaiting and unworked ones get no verdict

  @work/item-awaiting @usecase
  Scenario: An item a pending fact may change is not served
    Given an entry with a pending pronunciation
    When agents claim pronunciation and syllables items
    Then the pronunciation item awaits review and is not served, while the syllables item is

  @work/item-attempts-usecase @usecase
  Scenario: Passes that add nothing hand an item to the curators
    Given an item whose passes add nothing
    When two passes complete
    Then it is open with one attempt and then a ticket, it is no longer claimable, and a curator's fact or settled slot closes it

  @work/item-review-verdict @usecase
  Scenario: A worked item is judged once its facts are reviewed
    Given a pass that submits a pronunciation and completes before its review
    When review rejects it, and a later pass's pronunciation is published
    Then the item awaits review after each pass, the rejection counts one attempt, and the published fact closes the gap

  @work/item-review-api @api
  Scenario: A rejection after the lease counts the attempt on a real database
    Given a pass that submits syllables and completes
    When review rejects them
    Then the item awaits review and is not claimable until the verdict, then comes back with one attempt and the rejected fact in its context's rejections

  @work/found-none @usecase
  Scenario: An optional slot completes with found_none
    Given a leased optional item
    When its holder completes it with found_none and a note
    Then the slot is recorded as passed with the note and the holder, the item closes, and its entry's completeness counts the slot

  @work/required-slot @usecase
  Scenario: A required slot cannot be passed by a worker
    Given a leased required item
    When its holder completes it with found_none or blocked_on
    Then it is refused as invalid_request and the lease stays held

  @work/blocked-reopen @usecase
  Scenario: Admitting a blocked-on word reopens the slot
    Given an optional slot passed with blocked_on naming a lemma that is no entry
    When a curator admits that lemma as a headword
    Then the pass and its block are deleted and the slot's item is open again

  @work/stuck-ticket @usecase
  Scenario: A second pass that does not fill an item opens a stuck_work ticket
    Given an item one pass left unfilled
    When the second pass leaves it unfilled too
    Then a stuck_work ticket on the item's node names the type and the last note, and a third rescore opens no second one

  @work/found-none-api @api
  Scenario: Optional slots are passed honestly over HTTP
    Given a live entry with a phrases item and a synonyms item
    When an agent completes the phrases item with found_none and no note, then with a note, and the synonyms item with found_none, a note, and blocked_on
    Then the first is 400, the second closes the phrases item and the entry's completeness counts the slot, and the synonyms item closes with its block recorded

  @work/required-slot-api @api
  Scenario: found_none and blocked_on on a required slot are 400
    Given a leased syllables item
    When its holder completes it with found_none, and with blocked_on
    Then each is 400 invalid_request, and a plain completion with a note still works

  @work/blocked-reopen-api @api
  Scenario: Importing a blocked-on word reopens the slot on a real database
    Given a synonyms item completed with found_none and blocked_on naming "enormous", which is no entry
    When a curator admits "enormous" as a headword
    Then the synonyms item is open again with no attempts and claimable, and admitting another word reopens nothing

  @work/stuck-ticket-api @api
  Scenario: The curators handle an item two passes left unfilled
    Given a syllables item two passes left unfilled
    When a curator reads the tickets, a producer agent tries to settle the slot, and the curator settles it
    Then the item is no longer claimable, there is one open stuck_work ticket naming the item's type and last note, the producer gets 403, and the curator's settle closes the item

  @work/claim-one-type @usecase
  Scenario: A claim leases items of one type, the most valuable first
    Given live entries of several CEFR levels with no inventory
    When agents claim with and without a limit and a type filter
    Then the first claim leases senses items in learner order up to its limit, the next one the rest, and a claim for pronunciation items leases only those with the entry context

  @work/claim-context @usecase
  Scenario: A claimed item carries the context its type needs
    Given a C2 and an A1 noun with their inventories
    When an agent claims category and translations items
    Then the category items come first, each with its gap, its entry's level and senses, its sense, the facts about that sense, and its rejections, and the translations items carry the entry view

  @work/claim-context-dead-ends @domain
  Scenario: A claimed item never shows a sense that cannot show as a live end
    Given a sense whose relations end at a sense a live entry's published inventory lists, a sense only a pending inventory lists, and a sense of an entry that is not live
    When its synonyms item's context is built
    Then the related senses carry their gloss only while they can show, and null for the other two

  @work/claim-api @api
  Scenario: Claim and complete over HTTP
    Given a live headword with no inventory
    When an agent claims work, another agent claims, completes, and the holder completes with its items
    Then the first claim leases the senses item with the entry's management view, the other agent gets 204 or the next type and 409 on the holder's lease, an item from another lease is 422, and a repeated complete is 404

  @work/claim-race @api
  Scenario: Concurrent claims get distinct items
    Given several items of one type
    When agents claim one item each at the same moment
    Then each claim gets a different item, and the claims beyond the item count get no content

  @work/claim-expired-race @api
  Scenario: Concurrent claims split expired leases
    Given every item of one type has an expired lease
    When more agents than items claim at the same moment
    Then each expired item goes to exactly one agent

  @work/lease-expiry-api @api
  Scenario: An expired lease is claimable again and cannot be completed
    Given an agent whose lease has expired
    When the first agent completes its lease and another agent claims work
    Then the first agent gets 409 conflict and the other agent gets the same items

  @work/claim-priority @api
  Scenario: Items are claimed by batch, then learner priority, re-ranked by every reference import
    Given headwords of batches 1 and 2 with CEFR levels, with a frequency and no level, and with neither
    When agents claim items, and again after a reimport changes the levels and the leases lapse
    Then every batch 1 item comes before any batch 2 item; within a batch A1 entries come first, then the higher levels in order, then entries without a level, the more frequent first, and a more frequent entry's later stages come before a less frequent entry's first; a capitalized lemma has the frequency of its lowercase word form, and the reimport's levels decide the next claim

  @work/claim-lease @usecase
  Scenario: A claimed item is leased to one agent
    Given an agent holds the lease on the only item of a type
    When another agent claims it before and after the lease expires, the first agent completes late, and the expired lease is purged a day later
    Then nothing is claimable before expiry, the other agent gets it after, the late complete is a conflict, and after the purge it is not found

  @work/complete @usecase
  Scenario: Only the holder completes its own items, once
    Given an agent holds a lease on two items
    When another agent or an admin completes it, the holder names an item of another lease, and the holder completes one item twice
    Then the others get conflict, the foreign item is an invalid reference, the named item gains an attempt, the other is released without one, and the repeat is not found

  @work/claim-live @api
  Scenario: Only a live entry has items
    Given an entry that exists but is neither an imported headword nor a listed phrase
    When an agent claims work, then a curator admits it as a headword
    Then no item of it is claimable until it is admitted, and then its senses item is

  @work/claim-empty @api
  Scenario: The queue empties once every slot is filled or passed
    Given a live entry whose every required slot is filled and every optional slot filled or passed
    When an agent claims work, and a fact is retracted
    Then the claim answers no content, until the retraction reopens its slot

  @work/claim-index @api
  Scenario: A claim does not sort the items
    Given the next-type and lease statements
    When their query plans are read
    Then they walk the queue indexes and build no temporary sort

  @work/rescore @usecase
  Scenario: Stale worklist rows drain a batch at a time
    Given stale worklist rows
    When the rescore runs with a limit
    Then it rescores at most that many and reports how many stay stale

  @work/rescore-api @api
  Scenario: An admin drains stale scores
    Given every worklist row stale
    When an agent and then an admin call the rescore with a limit
    Then the agent gets 403, a limit out of range is 400, and the admin's calls rescore up to the limit until none is stale

  @work/field-gaps @domain
  Scenario: Syllables and irregular form pronunciations are gaps
    Given an entry with an inventory and forms
    When its gaps are listed
    Then a single word lacks syllables, and each irregular form without a live pronunciation is named, a pending correction that adds one standing for its original

  @work/form-paradigm @domain
  Scenario: The forms gap names the inflections the paradigm needs
    Given a single word with verb, noun, adjective, or adverb senses and forms labelled, unlabelled, pending, or rejected
    When the gaps are computed
    Then a verb needs its four forms, a noun with a countable sense its plural, an adjective of one syllable or two ending in y, or one with a recorded inflected comparison, its comparative and superlative, and an adverb with a recorded inflected comparison the rest of it
    And a form fills a slot by its label or, unlabelled, by the meaning it shows under, a periphrastic comparison fills nothing, and a phrase, an uncountable noun, and an invariable word need no form

  @work/pronunciation-accents @domain
  Scenario: An entry needs a pronunciation in both accents
    Given an entry with strong and weak pronunciations
    When the gaps are computed
    Then the pronunciation gap names each accent of us and uk with no live strong pronunciation

  @work/function-word-usage @domain
  Scenario: Function words and adverbs need the usage a learner's dictionary gives them
    Given core senses of each function-word part of speech and an adverb
    When the gaps are computed
    Then every adverb needs grammar, a collocation, and a synonym, a determiner grammar and a collocation, a pronoun grammar and no relation, and a preposition or conjunction a collocation, and an interjection none of them

  @work/number-senses @domain
  Scenario: A number sense needs examples and none of the usage slots
    Given a common number sense, cardinal ("two") or ordinal ("first")
    When the gaps are computed
    Then it needs its examples and a translation, and no category, parts, synonyms, topics, grammar, collocations, or forms

  @work/core-examples @domain
  Scenario: Core senses of A1 and A2 entries need two examples
    Given a common sense with one example of an entry at each CEFR level or none
    When the gaps are computed
    Then a core sense of an A1 or A2 entry has an examples gap asking for two and counting the one it has, and other senses and entries need one

  @work/productive-use-gaps @domain
  Scenario: Each part of speech of the common senses needs a productive use
    Given an entry whose inventory has common verb and noun senses and an extra adjective sense
    When the gaps are computed
    Then a usage-stage productive_use gap lists the verb and noun until a live productive use fills each, a rejected one fills nothing, and the extra adjective needs none

  @work/phrase-type-slots @domain
  Scenario: A phrase entry has the slots of its type
    Given a multiword entry typed phrasal_verb, compound, idiom, or fixed_phrase by the earliest published list naming it, or by none
    When the gaps are computed
    Then every type needs senses, examples, translations, synonyms, and productive uses; a compound also its category, parts, and topics; a phrasal verb its grammar; none a pronunciation or collocations; and an untyped multiword entry keeps every slot

  @work/phrases-gap @domain
  Scenario: Every single-word headword with an inventory has a phrases slot
    Given single-word and multiword entries with and without an inventory and a live phrases list
    When the gaps are computed
    Then a single word with an inventory and no live phrases list has a phrases gap, and a phrase or a word with a live list has none, unless that list is one the migration converted from untyped phrases

  @work/family-gap @domain
  Scenario: An A1 or A2 single word needs a word family member
    Given a single-word entry, its level, and the live entries whose morphology names it as a base
    When the gaps are computed
    Then an A1 or A2 single word with none has a family gap that one such entry or a pass fills, and a phrase or a higher level has none

  @work/family-api @api
  Scenario: A derivative naming its base fills the base's family gap at once
    Given an A1 word whose family item is claimed
    When a derivative's morphology names a lemma that is no live entry, names a lemma on a suffix, names the word, and is later retracted
    Then the unknown lemma is an invalid reference, the misplaced lemma a validation error, the formation rescores the word with its gap filled in the same request and shows the base's lemma publicly, and the retraction reopens the gap
