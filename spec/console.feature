Feature: Console
  Admins watch the dictionary through the console: how complete and reliable it
  is, what agents are filling in now, and what was published with flaws. The
  console is read-only except for API keys; agents make every other change
  through the API.

  @console/navigation @web
  Scenario: The sidebar shows what needs a look beside each page
    Given entries, flagged facts, open tickets, and stuck tasks
    When the admin opens the console
    Then the sidebar lists Overview, Entries, Facts, Tickets, Tasks, and API Keys
    And Entries shows the entry count, Facts the flagged count, Tickets the open count, and Tasks the stuck count
    And the public dictionary, developer guide, and API reference are linked below
    And on a narrow screen the sidebar opens from a menu button and closes after navigating

  @console/overview @web
  Scenario: The overview shows completeness, quality, open tasks, and pending review
    Given entries at several CEFR levels, flagged facts, open tasks with a forecast, and facts pending review
    When the admin opens the overview
    Then it shows the average completeness, the quality as the share of live facts not flagged, and how many tasks are open
    And when A1 and all open tasks will be done at the current net rate, or that they are growing
    And how many facts wait for review and, past one hour, how long the oldest has waited
    And the completeness of each CEFR level, entries without a level last

  @console/needs-attention @web
  Scenario: Each thing needing attention links to the page that shows it
    Given flagged facts, stuck tasks, open tickets, timed-out tasks, and facts pending review over an hour
    When the admin opens the overview
    Then each is counted and links to the facts, tasks, or tickets it counts

  @console/facts-by-type @web
  Scenario: Facts by type split into linked status segments
    Given facts of several kinds in several statuses, some flagged
    When the admin opens the overview
    Then each kind shows a bar of published, flagged, pending, and rejected facts with flagged, pending, and total counts
    And each segment opens the facts of that kind and status

  @console/forbidden @web
  Scenario: A signed-in user who is not an admin sees why nothing loads
    Given the management API answers 403
    When the user opens the overview
    Then the server's message is shown at once
    And the console does not retry the request

  @console/task-queue @web
  Scenario: The task queue shows open work, throughput, forecast, and who works on what
    Given open tasks of several types and stages, closed and created counts, a forecast by level, and agent leases
    When the admin opens Tasks
    Then it shows open, in progress, waiting on review, stuck, and closed tasks with the median time to close
    And the closed, created, and net tasks per hour with a chart, and when all open tasks and each level will be done, or that they are growing
    And each task type grouped by stage with its open, in review, stuck, and closed counts, median time, and success rate
    And each agent at work with its task type, task count, first entries, and time left, or that its lease timed out
    And the window switches between the last 24 hours and 7 days in the URL

  @console/task-activity @web
  Scenario: Browse completed attempts, newest first
    Given attempts by several agents at several task types with several results
    When the admin opens the activity and filters by entry, result, task, and agent
    Then each attempt shows when it finished, the agent, its try number among the task's attempts, the entry and sense, the task, the result, the time spent, and the facts submitted
    And the filters stay in the URL and each page is appended to the last

  @console/task-detail @web
  Scenario: A task opens read-only with what is missing and every attempt
    Given a task that agents have attempted
    When the admin opens it from the activity
    Then the sheet says in plain words what the entry is missing and how many tries made no progress
    And when it was created, how many attempts, agent time, and time in queue
    And each attempt with its try number, agent, result, duration, the facts it submitted with their status, and its note
    And it offers no action, only a note that agents pick up tasks through the API

  @console/entry-list @web
  Scenario: Watch every entry's completeness, quality, and open tasks
    Given more entries than one page at several levels with flagged facts and open tasks
    When the admin opens the entries page and loads more
    Then each entry shows its level, senses, completeness split into published and pending, quality, open tasks, and when it was last updated
    And quality below 97% and stuck tasks stand out, and an entry with no open tasks says None
    And clicking an entry opens its inspector

  @console/entry-list-filter @web
  Scenario: Narrow the entry list by prefix, level, flagged facts, and stuck tasks
    Given entries with different lemmas, levels, flagged facts, and stuck tasks
    When the admin types a prefix, picks a level, and toggles the flagged and stuck filters
    Then the URL keeps every filter and only matching entries are listed
    And a filter nothing matches says so, and clearing them lists every entry again

  @console/entry-inspector @web
  Scenario: Inspect an entry's facts and gaps in place
    Given an entry with senses whose facts are published, pending, flagged, and rejected, relations pointing in, and open tasks
    When the admin opens the entry
    Then it heads the entry with its pronunciation, CEFR levels, frequency rank, and completeness, quality, and open-task scores
    And each sense in its agreed order lists its facts with their state, the relations pointing at it, and each open task where its fact would go
    And replaced facts stay out of the way, later senses fold away, and a fact opens its detail
    And an unknown lemma shows the server's not-found message

  @console/entry-reference @web
  Scenario: The inspector outlines the senses, the word details, and the reference data
    Given an entry with ordered, less common, and unordered senses, entry facts, entry tasks, and reference data from several sources
    When the admin opens the entry
    Then the senses are outlined in their agreed order with the less common and unordered counted apart
    And each word detail shows its facts and the status of the task filling it
    And the reference data shows the frequency rank and CEFR levels and credits each source it came from

  @console/entry-tasks @web
  Scenario: An entry's open tasks in their own tab
    Given an entry with open tasks about the entry and its senses
    When the admin opens the Tasks tab
    Then each task shows its type, the sense it is about, what is missing, and its status

  @console/facts-browse @web
  Scenario: Browse facts beside the one selected
    Given more facts than one page about several entries
    When the admin filters by entry, flagged only, type, status, level, and author
    Then each fact shows its entry, read with the list, its type, readable claim, state, and when it changed
    And the filters stay in the URL and each page is appended to the last

  @console/flagged-facts @web
  Scenario: Facts published with flaws stand out
    Given published facts reviewed as pass, uncertain, and fail, and pending, rejected, and replaced facts
    When the admin browses facts
    Then uncertain facts are flagged with their confidence and failed ones say review failed
    And pending, rejected, and replaced facts show their status, rejected ones struck through

  @console/fact-detail @web
  Scenario: A fact opens read-only with its claim, review, task, and history
    Given a flagged correction of a published fact with a task fixing it
    When the admin selects it
    Then the detail shows its entry and sense, the claim typeset by kind, and technical details collapsed
    And the review's verdict, confidence, reason, reviewer, and model, tinted when flagged or failed
    And the task fixing it and the facts it replaced, each opening in turn
    And it offers no retract or re-review action

  @console/tickets @web
  Scenario: Read tickets by status with what they are about
    Given open, assigned, resolved, and dismissed tickets about a fact, a sense, and an entry
    When the admin opens a tab and selects a ticket, or follows a link to one
    Then the tabs list open, assigned, resolved with dismissed, and all tickets, each tab with its count, and each ticket with its entry and target type
    And the ticket shows its message, the fact or entry it is about, the task fixing it, its assignee, resolution note, and fixes
    And it offers no action, only a note that agents resolve tickets through the API

  @console/agent-issue @critical @web
  Scenario: Issue an agent key and see it exactly once
    When the admin issues a key for a named agent
    Then the key is shown once with a copy button and the agent is listed as active
    And reopening the dialog shows an empty form, not the key

  @console/agent-revoke @web
  Scenario: Revoke an agent after confirming
    Given an active agent
    When the admin confirms its revocation
    Then the agent is listed as revoked and can no longer be revoked
