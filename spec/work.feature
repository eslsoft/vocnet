Feature: Work items
  Agents ask the server for the next work items of one type, the most valuable first, and no two agents hold the same item at once.

  @work/gaps @domain
  Scenario: The open work names what the entry lacks
    Given an entry and its facts in every status
    When the gaps are computed from its pending and published facts
    Then senses while no sense is live, a sense list while the senses are not settled by one, and missing paradigm forms, a pronunciation in either accent, or word formation of a single word are gaps, and each core sense without the category, parts, synonym, examples, zh translation, topic, grammar, and collocations its part of speech needs, and each other common sense without its example, zh translation, or grammar, is a gap

  @work/sense-list-gap @domain
  Scenario: The sense inventory is settled by a list naming exactly the live senses
    Given an entry with live senses and sense lists in every status, a pending correction of a published list, and senses added or lost since
    When the gaps are computed
    Then the entry has a senses gap while no sense is live, and otherwise a sense list gap naming its live senses unless its current list, the live one no live correction supersedes, names exactly them

  @work/sense-list-scope @domain
  Scenario: Only common senses count toward completeness once a list exists
    Given an entry whose current sense list puts some senses in extra
    When the gaps and completeness are computed
    Then the extra senses have no per-sense gaps and count no slots, while before any list every live sense counts

  @work/core-senses @domain
  Scenario: Only core senses need the network, topic, and collocation slots
    Given an A1 entry whose sense list puts four nouns, two verbs, and an adjective in common in that order and a rare sense in extra, and a sense it does not name yet
    When the gaps and completeness are computed
    Then the first three common senses, the first verb, and the first adjective are core and keep every slot their part of speech needs, with two examples
    And the fourth noun and the second verb need only a zh translation, one translated example, and their grammar, the rare sense nothing, and the unnamed sense every slot until a new list places it
    And before any sense list every counted sense is core, and completeness counts only the slots each sense's scope needs

  @work/core-senses-api @api
  Scenario: A published sense list narrows the items of the senses beyond the core ones on a real database
    Given an entry with four adjective senses and two verb senses, all published
    When its sense list publishes with them in common in that order
    Then the first three adjectives and the first verb keep their synonym, topic, and collocation items, and the fourth adjective and the second verb have only their translation, example, translated example, and grammar items

  @work/core-senses-migration @api
  Scenario: The core_senses migration returns stalled items whose rules changed and rescores every entry
    Given items in the curators' queue of every type, and an item still in production
    When the core_senses migration runs
    Then the sense list, topics, category, parts, and synonyms items return to the production queue with no attempts, every other item keeps its attempts, and every worklist row is stale

  @work/claim-criteria @domain
  Scenario: A claimed item carries the standard its facts are reviewed by
    Given an item of any type, and a weak fact
    When its criteria are rendered
    Then each kind of fact that fills it comes with the exact Jev questions and how their scores decide, a score below the floor failing without appeal, the exact LLM rubric with placeholder values, and the kind's write rules
    And a closable gap comes with its closure rubric, a topics closure listing the taxonomy, and never the rules that weigh a slot's rejected attempts or blocked candidates
    And every item carries the write rules every submission meets, and a weak fact is rendered with its own payload

  @work/claim-criteria-api @api
  Scenario: The claim response carries each item's criteria
    Given an entry with a published noun sense
    When an agent claims its topics item and its synonyms item
    Then the topics item's criteria give the topic rubric and the closure rubric with the seeded taxonomy, and the synonyms item's give the Jev floor of a synonym

  @work/sense-list-attempts @domain
  Scenario: A rejected list leaves the sense list gap as it was
    Given an entry with live senses and rejected or pending sense lists naming exactly them
    When the open work is computed
    Then the sense list gap is the same after any number of rejections, so each rejected pass counts an attempt of its item, and a pending list holds the item for its review

  @work/sense-list-retry @api
  Scenario: A rejected sense list brings its item back with the reviewer's reason, until three attempts hand it to the curators
    Given an entry with senses whose sense list item each pass works by submitting the same list
    When review rejects each list after its pass completes
    Then the item comes back with one more attempt and the rejected lists and their reasons in its context, and after the third no sense list item is claimable

  @work/relation-slots @domain
  Scenario: Relations fill slots, with no quotas and with layers
    Given a live noun sense with no relations, a biology hypernym, an everyday hypernym, its own part_of, parts attached to it, a synonym or antonym in either direction, or a closed category
    When the gaps are computed
    Then it needs one everyday category, which a domain hypernym does not fill; once it has one it needs a part attached to it, which its own part_of does not fill; it needs one synonym or antonym; and a closed category asks for no parts

  @work/relations-visible-ends @domain
  Scenario: A relation fills a slot only while its other end can show
    Given a live sense whose live relations lead to senses with a live gloss and entry, a rejected gloss, or a rejected entry
    When the gaps are computed from the entry and the senses at the other end of its relations
    Then only the relations whose other sense has a live gloss and a live entry fact fill the category, parts, or synonym slot

  @work/relations-visible-ends-api @api
  Scenario: A relation's other end leaving live reopens its slot on a real database
    Given an entry whose noun sense has two published everyday hypernyms, each to a sense of another entry
    When one other entry fact is re-reviewed and rejected, and the other gloss is retracted
    Then the one category slot stays filled while one hypernym can show, and opens, closing the parts slot, once none can, rescored in the same request

  @work/relation-slots-by-pos @domain
  Scenario: The relation slots a sense needs depend on its part of speech
    Given a live sense of each part of speech
    When the gaps and completeness are computed
    Then only nouns need a category, nouns, verbs, adjectives, and adverbs a synonym or antonym, and pronouns and every other part of speech no relation slot

  @work/topics-gap @domain
  Scenario: Nouns and verbs need a topic
    Given a live sense of each part of speech
    When the gaps are computed
    Then a noun or verb sense with no live topic fact has a topics gap, and every other part of speech, adjectives included, has none
    And a pending topic fact closes the gap while a rejected one does not

  @work/usage-gaps @domain
  Scenario: Grammar, collocations, and word formation are gaps where a learner needs them
    Given an entry with a live sense of each part of speech
    When the gaps are computed
    Then noun, verb, adjective, adverb, determiner, and pronoun senses need one grammar fact, noun, verb, adjective, adverb, determiner, preposition, and conjunction senses one collocation, and a single-word entry, not a phrase, one word formation

  @work/slot-counts @domain
  Scenario: An entry's slots split into those published facts fill and those only pending facts fill
    Given an entry with every slot published, one filled only by a pending fact, and a pending sense that unsettles its sense list
    When the entry is assessed
    Then the slots total what completeness counts, the pending fill counts as pending, and the published count never exceeds what the live facts fill

  @work/scores @domain
  Scenario: An entry's completeness and quality come from its live facts
    Given an entry with some slots filled, some facts published on an uncertain verdict, and some under open feedback
    When the entry is assessed
    Then completeness is the filled share of the slots its gaps count, quality is one minus the weak share of its live facts, and each weak fact is a piece of open work with its reason

  @work/awaiting-review @domain
  Scenario: A piece of open work waits for the reviews that may change it
    Given an entry with pending facts that fill a gap, an unrelated open gap, a pending relation into a sense, a pending entry fact, or a rejected entry fact
    When the open work is computed over the live facts and over the published ones alone
    Then exactly the pieces the two computations disagree on await review, the others stay workable, and an entry whose entry fact is not live has no open work

  @work/weak-facts @usecase
  Scenario: A weak fact is an item until a correction replaces it
    Given a fact published on an uncertain verdict
    When its item is claimed, and a correction that supersedes it is submitted and then published
    Then the item is in the weak-fact stage with the fact in its context, it awaits review while the correction is pending, and it closes once the correction publishes

  @work/weak-facts-api @api
  Scenario: A weak fact is claimable over HTTP
    Given a form published on an uncertain verdict
    When an agent claims weak fact items
    Then the item names the fact, its kind, and the reason uncertain, in stage five

  @work/item-priority @domain
  Scenario: The priority policy puts the stage before the learner band
    Given items of every type on entries of every CEFR level, with a frequency and no level, and with neither
    When their priority is computed
    Then A1 and A2 come first through every stage, then the other bands; within each, the stage of the type (1 identity, 2 network, 3 meaning, 4 usage, 5 weak facts) comes first, then A1 to C2, then a frequency without a level, then the rest, then the higher frequency, so every A2 example comes before any B1 sense and an A1 category before an A1 translation

  @work/item-upsert @domain
  Scenario: A rescore converges the stored items on the open work
    Given stored items and the open work of a rescore
    When they are reconciled
    Then each piece of open work updates the stored item of its type and node, keeping its id, or is new, and every other stored item is deleted

  @work/item-attempts @domain
  Scenario: An attempt counts only when a completed pass left the gap as its claim found it
    Given a worked item whose gap is unchanged, awaiting review, or partly filled, and an item nobody worked that another principal changed or left alone
    When the item is reconciled
    Then the unchanged worked item gains an attempt, the awaiting one keeps its attempts and its pending verdict, and any change starts the attempts over

  @work/item-curation @domain
  Scenario: Three attempts move an item to the curators
    Given items with fewer than three attempts, awaiting review, or with three
    When their state is read
    Then they are open, awaiting review, or with the curators

  @work/item-awaiting @usecase
  Scenario: An item a pending fact may change is not served
    Given an entry with a pending pronunciation
    When agents claim pronunciation and syllables items
    Then the pronunciation item awaits review and is not served, while the syllables item is

  @work/attempt-verdicts @domain
  Scenario: The rescore draws a verdict on every worked item it judges
    Given worked items whose gaps closed, changed, stayed as claimed, or stayed as claimed on the third attempt, one still awaiting review, and items nobody worked
    When the items are reconciled
    Then the closed one is closed, the changed one progressed, the unchanged ones made no progress or are stuck, and the awaiting and unworked ones get no verdict

  @work/item-attempts-usecase @usecase
  Scenario: Passes that add nothing hand an item to the curators
    Given an item whose passes add nothing
    When three passes complete
    Then it is open with one and two attempts and then with the curators, it is no longer claimed, the curators' queue lists it with the last note for curators and admins only, and a curator's fact closes it

  @work/item-attempts-api @api
  Scenario: The curators' queue over HTTP
    Given an item three passes left unchanged
    When a producer agent, an admin, and a curator agent read the curators' queue, and the curator submits a curated fact
    Then the producer gets 403, the others the item with its gap, attempts, and last note, filtered by type, and the curated fact empties the queue

  @work/item-review-verdict @usecase
  Scenario: A worked item is judged once its facts are reviewed
    Given a pass that submits a pronunciation and completes before its review
    When review rejects it, and a later pass's pronunciation is published
    Then the item awaits review after each pass, the rejection counts one attempt, and the published fact moves the gap on and starts the attempts over

  @work/item-review-api @api
  Scenario: A rejection after the lease counts the attempt on a real database
    Given a pass that submits syllables and completes
    When review rejects them
    Then the item awaits review and is not claimable until the verdict, then comes back with one attempt and the rejected fact in its context

  @work/claim-one-type @usecase
  Scenario: A claim leases items of one type, the most valuable first
    Given entries of several CEFR levels with no senses
    When agents claim with and without a limit and a type filter
    Then the first claim leases sense items in learner order up to its limit, the next one the rest, and a claim for pronunciation items leases only those, all of them, with the entry context

  @work/claim-context @usecase
  Scenario: A claimed item carries the context its type needs
    Given a C2 and an A1 noun with their sense lists
    When an agent claims category and example items
    Then the category items come first, both of them, each with its gap, its entry's level and senses, its sense, and the facts about that sense

  @work/claim-context-dead-ends @domain
  Scenario: A claimed item never shows a sense that cannot show as a live end
    Given a sense whose relations, retired or rejected, end at a sense with a live gloss, a sense whose gloss was retracted, and a sense whose entry fact was rejected
    When its synonyms item's context is built
    Then the related senses carry their gloss only while they can show, and null for the other two

  @work/claim-api @api
  Scenario: Claim and complete over HTTP
    Given a submitted entry
    When an agent claims work before and after the entry is reviewed, another agent claims and completes, and the holder completes with its items
    Then the first claim is 204, the second leases the senses item with the entry's management view, the other agent gets the next type and 409, an item from another lease is 422, the holder's item is closed, and a repeated complete is 404

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
  Scenario: Items are claimed by stage and learner priority, re-ranked by every reference import
    Given entries with CEFR levels, with a frequency and no level, and with neither, one created after the reference import
    When agents claim items, and again after a reimport changes the levels and the leases lapse
    Then within a type A1 entries come first, then the higher levels in order, then frequency without a level, then the rest, the more frequent first; identity items come before every later stage; a capitalized lemma has the frequency of its lowercase word form, and the reimport's levels decide the next claim

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
    Given an entry whose entry fact is retracted
    When an agent claims work, then the entry is submitted again and reviewed
    Then no item is claimable until the new entry fact publishes

  @work/claim-empty @api
  Scenario: The queue empties once every entry is complete and good
    Given an entry whose every gap is filled and none of whose facts is weak
    When an agent claims work, and a fact is rejected in place
    Then the claim answers no content, until the rejection reopens its gap

  @work/claim-index @api
  Scenario: A claim does not sort the items
    Given the next-type and lease statements
    When their query plans are read
    Then they walk the queue indexes and build no temporary sort

  @work/entry-seed @api
  Scenario: The entry view says whether the entry is a seed entry
    Given an entry created without seed and one created with seed true
    When an agent reads either entry or claims their senses items
    Then the management view and the whole-entry context say seed false for the first and seed true for the second

  @work/priority-backfill @api
  Scenario: The backfill computes the learner priority that creation and the import store
    Given reference data and entries created after it, a capitalized lemma, a lemma with a non-ASCII letter, and a phrase among them
    When the learner priority backfill migration runs over scrambled rows
    Then every row's frequency key, level rank, and frequency are unchanged

  @work/items-migration @api
  Scenario: The work items release brings stored facts to the new relation rules
    Given a relations closure as the earlier release stored it, a published hypernym, a curated part_of, and scored rows
    When the work_items_relation_layers migration runs
    Then the closure is a synonyms closure with the registry's key, marked for review in place with the hypernym, the curated fact is left alone, and every row is stale

  @work/layer-review-migration @api
  Scenario: The layer review release judges every published hypernym and part_of by the rubric
    Given published everyday hypernyms to a technical taxon and to a category word, a part_of, a curated hypernym, and scored rows
    When the relation_layer_review migration runs
    Then the hypernym to the technical taxon gets a pending biology correction that supersedes it, the other hypernym and the part_of are marked for review in place, the curated fact is left alone, and every row is stale

  @work/rescore @usecase
  Scenario: Stale worklist rows drain a batch at a time
    Given stale worklist rows
    When the rescore runs with a limit
    Then it rescores at most that many and reports how many stay stale

  @work/rescore-api @api
  Scenario: An admin drains stale scores after a gap rule change
    Given every worklist row stale
    When an agent and then an admin call the rescore with a limit
    Then the agent gets 403, a limit out of range is 400, and the admin's calls rescore up to the limit until none is stale

  @work/failed-gloss @usecase
  Scenario: A gloss that fails its review in place stays published as a weak fact
    Given a published gloss marked for review in place
    When the review fails it
    Then it stays published and public with the failing review, the entry names it as a weak fact with the reason failed, and a correction that adds the missing label replaces it

  @work/field-gaps @domain
  Scenario: Syllables, irregular form pronunciations, and translated examples are gaps
    Given an entry with senses and forms
    When its gaps are listed
    Then a single word lacks syllables, each irregular form without a live pronunciation is named, and each counted sense has one translated-example slot per live example (at least as many as the examples it needs), naming every live example without a zh translation, a pending correction that adds one standing for its original

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
    Given senses of each function-word part of speech and an adverb
    When the gaps are computed
    Then every adverb needs grammar, a collocation, and a synonym, a determiner grammar and a collocation, a pronoun grammar and no relation, and a preposition or conjunction a collocation, each closable by a gap closure, and an interjection none of them

  @work/number-senses @domain
  Scenario: A number sense needs what every sense needs and none of the usage slots
    Given a counted number sense, cardinal ("two") or ordinal ("first")
    When the gaps are computed
    Then it needs examples, a translation, and translated examples, and no category, parts, synonyms, topics, grammar, collocations, or forms

  @work/core-examples @domain
  Scenario: A1 and A2 senses need two examples
    Given a counted sense with one example of an entry at each CEFR level or none
    When the gaps are computed
    Then a core sense of an A1 or A2 entry has an examples gap asking for two and naming the one it has, and other senses and entries need one

  @work/phrases-gap @domain
  Scenario: A core verb needs three phrases headed by it
    Given a single-word entry with a verb sense, whether a CEFR list names its exact lemma as an A1 or A2 verb, and the live phrasal verbs and verb idioms headed by it
    When the gaps are computed
    Then a core verb with fewer than three has a phrases gap naming the ones it has and the three it needs, each missing phrase is a slot a closure fills, and a phrase, a noun, or a word no list names as an A1 or A2 verb, such as an A1 noun with a verb sense, has none

  @work/phrases-api @api
  Scenario: A live phrasal verb counts on its head at once
    Given a word a CEFR list names as an A1 verb, whose items include a phrases gap
    When multiword entries are created that only contain the verb, are headed by it with no verb sense, gain a verb sense, or are headed by it with only a noun sense
    Then only the one headed by the verb with a live verb sense counts, and the verb's worklist row is rescored in the same request

  @work/family-gap @domain
  Scenario: An A1 or A2 single word needs a word family member
    Given a single-word entry, its level, and the live entries whose morphology names it as a base
    When the gaps are computed
    Then an A1 or A2 single word with none has a family gap that one such entry or a closure fills, and a phrase or a higher level has none

  @work/family-api @api
  Scenario: A derivative naming its base fills the base's family gap at once
    Given an A1 word whose family item is claimed
    When a derivative's morphology names a lemma that is no live entry, names a lemma on a suffix, names the word, and is later retracted
    Then the unknown lemma is an invalid reference, the misplaced lemma a validation error, the formation rescores the word with its gap filled in the same request and shows the base's lemma publicly, and the retraction reopens the gap

  @work/gap-closure @domain
  Scenario: A live gap closure closes exactly the gap it names
    Given a gap closure on an entry or a sense, in each status
    When the gaps and completeness are computed
    Then a pending or published closure closes only its gap on its node, its slots count as filled, and a rejected one or one on another node closes nothing

  @work/usage-family-migration @api
  Scenario: The usage and family release brings stored facts to the new rules
    Given a word formation whose base is spelled like a live entry, a simple word, a synonym between a word and its spelling variant, a phrases closure, a sense list and glosses of an A1 entry common and extra, and a gloss of an entry without a level
    When the completeness_usage_family migration runs
    Then the base names its entry with the key the registry computes, the simple word is unchanged, the synonym is retracted, the A1 common gloss, sense list, closure, and formation of several parts are marked for review in place and the rest are not, and every worklist row is stale

  @work/completeness-migration @api
  Scenario: The completeness release brings stored facts to the new rules
    Given orphaned facts of a retracted sense, periphrastic comparisons, dotted, r-coloured, and American ɛ transcriptions, ASCII-punctuated or repeated zh alternatives, and an uncertain sense list
    When the completeness_rules migration runs
    Then the orphans and periphrastic forms are retracted, each transcription and zh text is rewritten with the key the registry computes, a collision keeps the published or oldest fact and retracts the rest, the sense list is marked for review in place, and every worklist row is stale

  @work/core-verb-phrases-migration @api
  Scenario: The core verb release re-judges recent phrasal verbs
    Given multiword entries an agent created today and earlier, headed by a verb and by a noun, with a verb sense and without, one a CEFR list names, and one an admin created
    When the core_verb_phrases migration runs
    Then only the published entry facts of today's agent-created phrasal verbs headed by a verb that no CEFR list names are marked for review in place, and every worklist row is stale
