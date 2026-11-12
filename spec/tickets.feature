Feature: Tickets
  Everything that needs a human lands in one list: work two passes did not fill, reader
  feedback, audits of low-credibility facts, and missing words. A curator resolves each ticket
  with the facts that fixed it, or dismisses it, and can settle any slot nothing can fill.

  @tickets/feedback @usecase
  Scenario: Feedback opens a feedback ticket, one open per target
    Given a public target with and without an open feedback ticket
    When a reader reports it
    Then a new open feedback ticket is created only when the target has none, and the open one is returned otherwise

  @tickets/resolve @usecase
  Scenario: A curator resolves or dismisses an open ticket
    Given an open ticket
    When a curator resolves it with fact ids and a note, or dismisses it with a note, and a producer tries either
    Then resolved records the existing facts that fixed it and dismissed records why nothing needed fixing, an unknown fact id is an invalid reference, a closed ticket is a conflict, and the producer is forbidden

  @tickets/settle-slot @usecase
  Scenario: A curator settles a slot nothing can fill
    Given an entry's open item on a required or an optional slot
    When a curator records a pass on the slot with a note, and a producer tries to
    Then the slot counts as filled and its item closes, an unknown entry is not found, and the producer is forbidden

  @tickets/list-api @api
  Scenario: Tickets list oldest first with their entry, filtered by status and type
    Given a stuck_work ticket, feedback tickets about an entry, a sense, and a fact, and a resolved ticket
    When a curator lists the tickets by status and type, page by page, and reads one by id and an unknown id
    Then each comes oldest first with its type, target, message, status, and the id and lemma of the entry its target is or belongs to, the filters keep only matching tickets, pages continue, and the unknown id is 404

  @tickets/resolve-api @api
  Scenario: Resolving and dismissing tickets over HTTP
    Given open tickets and a fact a curator submitted to fix one
    When a producer agent resolves one, a curator resolves one with the fact, dismisses another, and resolves the first again, and names an unknown fact
    Then the producer gets 403, the resolved ticket records the note and fact ids, the dismissed one its note, the repeat is 409, and the unknown fact is 422

  @tickets/settle-slot-api @api
  Scenario: A curator settles a required slot over HTTP
    Given a single word whose forms item nothing can fill ("main" has no -er comparative)
    When a producer agent and then a curator post a pass on the slot
    Then the producer gets 403, the curator's call answers 204, the forms item closes, and the entry's completeness counts the slot
