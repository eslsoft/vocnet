Feature: Notes
  Capture short text notes.

  # The id is the @<capability>/<slug> tag; the second tag is the layer that proves it.

  @notes/create @web @critical
  Scenario: Create and list a note
    Given an empty notes list
    When the user submits a note
    Then the note appears in the list

  @notes/validate @api
  Scenario: Reject an empty note
    Given the notes form
    When the user submits blank text
    Then the note is rejected

  @notes/owner-scope @api
  Scenario: A user only sees their own notes
    Given another user has created a note
    When the current user lists notes
    Then that note is not in the list

  @notes/paginate @api
  Scenario: List notes a page at a time
    Given more notes than the page limit
    When the user pages through with the cursor
    Then every note is returned exactly once

  @notes/invalid-cursor @api
  Scenario: Reject an invalid pagination cursor
    Given a malformed notes cursor
    When the user requests the next page
    Then the API rejects the cursor instead of silently starting over
