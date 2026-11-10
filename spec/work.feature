Feature: Worklist
  Agents ask the server what to work on next, and no two agents work the same entry at once.

  @work/gaps @domain
  Scenario: A claim names what the entry lacks
    Given an entry and its facts in every status
    When the gaps are computed from its pending and published facts
    Then senses while no sense is live, a sense list while the senses are not settled by one, and missing paradigm forms, a pronunciation in either accent, or word formation of a single word are gaps, and each counted sense with fewer relations than its part of speech needs, or without the examples, a zh translation, or the topic, grammar, and collocations its part of speech needs, is a gap

  @work/sense-list-gap @domain
  Scenario: The sense inventory is settled by a list naming exactly the live senses
    Given an entry with live senses and sense lists in every status, a pending correction of a published list, and senses added or lost since
    When the gaps are computed
    Then the entry has a senses gap while no sense is live, and otherwise a sense list gap unless its current list, the live one no live correction supersedes, names exactly its live senses

  @work/sense-list-scope @domain
  Scenario: Only common senses count toward completeness once a list exists
    Given an entry whose current sense list puts some senses in extra
    When the gaps and completeness are computed
    Then the extra senses have no per-sense gaps and count no slots, while before any list every live sense counts

  @work/sense-list-attempts @domain
  Scenario: Each rejected list changes the sense list gap, up to a bound
    Given an entry with live senses and rejected sense lists naming exactly them, or naming other senses
    When the gaps are computed
    Then the sense list gap counts the rejected lists that name exactly the live senses, up to one less than MAX_SENSE_LIST_ATTEMPTS, so each rejection changes the open work until the bound and another rejection then leaves it unchanged

  @work/sense-list-retry @api
  Scenario: A rejected sense list brings the entry back with the reviewer's reason, until the attempts run out
    Given an entry with senses whose pass submits only a sense list
    When review rejects the list
    Then the entry is claimable again with the rejected list and its review reason among the claim's entry facts, and after the third rejected list of the same senses the entry stalls

  @work/sense-list-rescore @api
  Scenario: The release of sense list gaps rescores every entry and lifts stalls it outdates
    Given entries stalled on open work recorded before sense list gaps existed
    When the rescore migrations run
    Then an entry with senses and no list naming them is no longer stalled, and an entry without senses or whose list settles them keeps its stall

  @work/relations-gap @domain
  Scenario: A relations gap stays open until the sense has the relations it needs
    Given a live noun sense with no, one, or two live relations, as subject or object
    When the gaps are computed
    Then the sense has a relations gap while it has fewer than two, and the gap counts them and names each type and direction it already has

  @work/relations-visible-ends @domain
  Scenario: A relation fills a gap only while its other end can show
    Given a live sense whose live relations lead to senses with a live gloss and entry, a rejected gloss, or a rejected entry
    When the gaps are computed from the entry and the senses at the other end of its relations
    Then only the relations whose other sense has a live gloss and a live entry fact count toward the relations gap

  @work/relations-visible-ends-api @api
  Scenario: A relation's other end leaving live reopens the gap on a real database
    Given an entry whose noun sense has two published relations, each to a sense of another entry
    When one other entry fact is re-reviewed and rejected, and the other gloss is retracted
    Then the entry's stored completeness drops by one relation slot each time, rescored in the same request

  @work/relations-by-pos @domain
  Scenario: The relations a sense needs depend on its part of speech
    Given a live sense of each part of speech
    When the gaps and completeness are computed
    Then nouns, verbs, and adjectives need two relations, adverbs and pronouns one, and every other part of speech none, with no relations gap and no relation slots

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

  @work/scores @domain
  Scenario: An entry's completeness and quality come from its live facts
    Given an entry with some slots filled, some facts published on an uncertain verdict, and some under open feedback
    When the entry is assessed
    Then completeness is the filled share of the slots its gaps count, quality is one minus the weak share of its live facts, and each weak fact is named with its reason

  @work/stall @domain
  Scenario: A completed pass that left the open work as its claim found it stalls the entry
    Given the open work an entry's last claim found, whether that pass completed, and the open work now
    When the stall rule is applied
    Then the entry is stalled only if the pass completed and the open work is unchanged

  @work/admission @domain
  Scenario: Only a live entry with work left that is neither stalled nor awaiting review is claimable
    Given worklist rows that are live or dead, stalled or not, awaiting review or not, stale or scored, with and without work left
    When admission is decided
    Then a live row is claimable when its scores are stale, or when it is not stalled, has no pending fact about it or relation into its senses, and has a gap or a weak fact

  @work/claim-tiers @domain
  Scenario: The claim tier puts gaps before weak facts, then learner priority, then never-claimed before claimed
    Given entries of every CEFR level, with a frequency and no level, with neither, with a gap or only weak facts, claimed or not
    When their claim tiers are computed
    Then every entry with a gap comes before every entry whose only work is weak facts, each by A1, A2, B1, B2, C1, C2, then frequency without a level, then the rest, and within each band never-claimed before claimed

  @work/claim-order @usecase
  Scenario: Learner priority orders the claims, never-claimed by highest frequency, claimed by least recently claimed
    Given never-claimed A1 entries of different frequency, a B2 entry, an entry with a frequency and no level, one with neither, and an A1 entry whose entry fact is retracted
    When agents claim and complete work, each first pass adding a sense, and reviews land between passes
    Then the A1 entries are claimed first by highest frequency and claimed again by least recently claimed, then the B2 entry, the entry with only a frequency, and the entry with neither, every pass that added nothing stalls its entry, and the dead entry is never claimed

  @work/stall-loop @usecase
  Scenario: No loop hands out an entry whose passes make no lasting progress
    Given an entry whose pass submits a relation review rejects, or only adds a second example
    When agents claim and complete work
    Then the entry is stalled after that pass, and claimable again only after another principal's fact or a fact leaving live changes its open work

  @work/awaiting-review @usecase
  Scenario: An entry waits while its facts are under review, so a rejection after its lease stalls it
    Given an entry whose pass submits a relation and completes before the review lands
    When agents keep claiming work, and then review rejects the relation
    Then neither end of the relation is claimed while it is pending, and after the rejection the entry is stalled and claimed no more

  @work/weak-facts @api
  Scenario: A claim names the entry's weak facts
    Given a complete entry with a fact published on an uncertain verdict, and later open feedback on another fact
    When an agent claims work
    Then the claim names each weak fact with its reason, the entry stays claimable until a pass replaces them, and a pass that replaced nothing stalls it until the feedback opens

  @work/claim-empty @api
  Scenario: The worklist empties once every entry is complete and good
    Given entries whose every gap is filled and none of whose facts is weak
    When an agent claims work
    Then the claim answers no content, until a rejection reopens a gap

  @work/stall-api @api
  Scenario: A stalled entry waits until another principal changes its work
    Given an A1 entry whose pass links it to another entry, and review rejects the link after the lease ended
    When agents claim and complete work
    Then neither entry is claimable while the link is pending, the entry is not claimed again, the worklist empties, and another principal's example makes it claimable

  @work/scores-backfill @api
  Scenario: The backfill computes the scores the rescore stores
    Given entries of every part of speech with filled, missing, uncertain, reported, and pending facts, and sense lists that settle, leave out extra senses, are stale, or have a pending correction
    When the backfill migrations run over the rescored worklist
    Then every entry's completeness, quality, and awaiting review are unchanged

  @work/topics-rescore @api
  Scenario: The release of topics gaps rescores every entry and lifts stalls it outdates
    Given entries stalled on open work recorded before topics gaps existed
    When the topics rescore migration runs
    Then an entry with an open topics gap is no longer stalled and one without keeps its stall

  @work/usage-rescore @api
  Scenario: The release of grammar, collocations, and word formation gaps rescores every entry and lifts stalls it outdates
    Given entries stalled on open work recorded before grammar, collocations, and word formation gaps existed
    When the rescore migrations run
    Then an entry with an open grammar, collocations, or word formation gap is no longer stalled and one without keeps its stall

  @work/relation-ends-rescore @api
  Scenario: The release of the relation end rule rescores every entry and lifts stalls it outdates
    Given entries stalled on open work recorded while relations to senses that cannot show still counted
    When the relation ends rescore migration runs
    Then an entry whose open relations gap changed is no longer stalled and one without keeps its stall

  @work/claim-priority @api
  Scenario: Entries are claimed in learner priority, re-ranked by every reference import
    Given entries with CEFR levels, with a frequency and no level, and with neither, one created after the reference import
    When agents claim work, and again after a reimport changes the levels and the leases lapse
    Then A1 entries come first, then the higher levels in order, then frequency without a level, then the rest; within a level the more frequent first and an entry without a frequency last
    And a capitalized lemma has the frequency of its lowercase word form, and the reimport's levels decide the next claim

  @work/claim-gaps-first @api
  Scenario: Completeness comes before quality
    Given a complete A1 entry with a fact published on an uncertain verdict, and an entry with gaps and no reference data
    When agents claim work
    Then the entry with gaps is claimed first, and the complete entry only after it

  @work/priority-backfill @api
  Scenario: The backfill computes the learner priority that creation and the import store
    Given reference data and entries created after it, a capitalized lemma, a lemma with a non-ASCII letter, and a phrase among them
    When the learner priority backfill migration runs over scrambled rows
    Then every row's frequency key, level rank, and frequency are unchanged

  @work/claim-rotation @api
  Scenario: An entry whose lease lapses goes back without stalling
    Given the least complete of three A1 entries is claimed and its lease keeps expiring without a complete
    When agents claim work
    Then the never-claimed entries of the band come first, and then the claimed entries least recently claimed first, so the lapsing entry never comes ahead of one claimed before it

  @work/entry-seed @api
  Scenario: The entry view says whether the entry is a seed entry
    Given an entry created without seed and one created with seed true
    When an agent reads either entry or claims it
    Then the management view and the claim say seed false for the first and seed true for the second

  @work/claim-live @api
  Scenario: Only an entry with a live entry fact is claimable
    Given an entry whose entry fact is retracted
    When an agent claims work, then the entry is submitted again and the agent claims again
    Then the first claim gets no content and the second gets the entry

  @work/claim-index @api
  Scenario: A claim does not sort the worklist
    Given the claim statement
    When its query plan is read
    Then it walks the claim-order index and builds no temporary sort

  @work/claim-lease @usecase
  Scenario: A claimed entry is leased to one agent
    Given an agent holds the lease on the only live entry
    When another agent claims work before the lease expires
    Then nothing is claimable, and after the lease expires the other agent gets the entry

  @work/complete @usecase
  Scenario: Only the holder completes its lease, once
    Given an agent holds a lease
    When another agent completes it, the lease expired, or the holder completes it twice
    Then the other agent and the expired lease get conflict, and the repeat gets not_found

  @work/claim-api @api
  Scenario: Claim and complete over HTTP
    Given a submitted entry
    When an agent claims work, another agent claims or completes, and the holder completes with a note
    Then the claim returns the lease, the management entry view with its completeness and quality, its gaps, and its weak facts; the other agent gets 204 and 409; a repeated complete is 404

  @work/claim-race @api
  Scenario: Concurrent claims get distinct entries
    Given several live entries
    When agents claim work at the same moment
    Then each claim gets a different entry, and the claims beyond the entry count get no content

  @work/claim-expired-race @api
  Scenario: Concurrent claims split expired leases
    Given every live entry has an expired lease
    When more agents than entries claim work at the same moment
    Then each expired entry goes to exactly one agent, and the other claims get no content

  @work/lease-expiry-api @api
  Scenario: An expired lease is claimable again and cannot be completed
    Given an agent whose lease has expired
    When the first agent completes its lease and another agent claims work
    Then the first agent gets 409 conflict and the other agent gets the entry

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
    Then every adverb needs grammar and a collocation, a determiner grammar and a collocation, a pronoun grammar and a relation, and a preposition or conjunction a collocation, each closable by a gap closure, and an interjection none of them

  @work/core-examples @domain
  Scenario: A1 and A2 senses need two examples
    Given a counted sense with one example of an entry at each CEFR level or none
    When the gaps are computed
    Then an A1 or A2 entry's sense has an examples gap asking for two and naming the one it has, and other entries need one

  @work/phrases-gap @domain
  Scenario: A core verb needs three phrases headed by it
    Given a single-word entry with a verb sense, whether a CEFR list names its exact lemma as an A1 or A2 verb, and the live phrasal verbs and verb idioms headed by it
    When the gaps are computed
    Then a core verb with fewer than three has a phrases gap naming the ones it has and the three it needs, each missing phrase is a slot a closure fills, and a phrase, a noun, or a word no list names as an A1 or A2 verb, such as an A1 noun with a verb sense, has none

  @work/phrases-api @api
  Scenario: A live phrasal verb counts on its head at once
    Given a word a CEFR list names as an A1 verb, whose claim names a phrases gap
    When multiword entries are created that only contain the verb, are headed by it with no verb sense, gain a verb sense, or are headed by it with only a noun sense
    Then only the one headed by the verb with a live verb sense counts, and the verb's worklist row is rescored in the same request

  @work/family-gap @domain
  Scenario: An A1 or A2 single word needs a word family member
    Given a single-word entry, its level, and the live entries whose morphology names it as a base
    When the gaps are computed
    Then an A1 or A2 single word with none has a family gap that one such entry or a closure fills, and a phrase or a higher level has none

  @work/family-api @api
  Scenario: A derivative naming its base fills the base's family gap at once
    Given an A1 word whose claim names a family gap
    When a derivative's morphology names a lemma that is no live entry, names a lemma on a suffix, names the word, and is later retracted
    Then the unknown lemma is an invalid reference, the misplaced lemma a validation error, the formation rescores the word with its gap filled in the same request and shows the base's lemma publicly, and the retraction reopens the gap

  @work/gap-closure @domain
  Scenario: A live gap closure closes exactly the gap it names
    Given a gap closure on an entry or a sense, in each status
    When the gaps and completeness are computed
    Then a pending or published closure closes only its gap on its node, its slots count as filled, and a rejected one or one on another node closes nothing

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
