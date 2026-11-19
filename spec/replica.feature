Feature: Public replica
  Until production moves online, the facts are produced on a local deployment and
  a public replica serves the public reads. A sync copies each public entry's view
  rows to the replica, and only the entries that changed since the last sync, so
  the replica holds no facts and runs no reviews.

  @replica/plan @domain
  Scenario: A sync copies only what changed
    Given the source's public entries and the replica's manifest of what it holds
    When a sync is planned
    Then it pushes the entries the replica lacks or holds with other rows, removes the ones the source no longer serves, and leaves the rest

  @replica/serve @api
  Scenario: A replica serves the pushed entries without their facts
    Given published entries linked by a relation, with a form and a topic tag, pushed to an empty replica
    When the replica is read, and its scheduled work runs
    Then the entry, sense, form, list, topic, search, and member reads answer as they did on the source, and feedback, which needs the facts, is not found

  @replica/update @api
  Scenario: A later sync updates and removes entries
    Given a replica synced from the source
    When an entry changes and another stops being public, and the source syncs again
    Then the replica serves the changed entry and answers 404 for the removed one
