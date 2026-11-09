# Product specs

Behaviour-first product specs in Gherkin `.feature` files — the source of truth for
**what the product does**, independent of implementation. Plain `.feature` files,
no Cucumber runner; tests trace back to scenarios by id.

## Convention

- One `.feature` file per capability.
- Each scenario has a stable `@<capability>/<slug>` id and one canonical proof
  layer tag: `@domain`/`@usecase`, `@web`, `@api`, or `@e2e`. `@critical` adds a
  required E2E proof. The checker derives its inventory directly from these tags.

  ```gherkin
  @notes/create @critical
  Scenario: Create and list a note
    Given an empty notes list
    When the user submits a note
    Then the note appears in the list
  ```

- The id never changes once written (rename = new id).
- Verify each scenario at the **cheapest layer that can prove it**. Require more
  than one layer only when each layer proves a distinct risk. Reserve E2E for
  genuinely cross-stack, hermetic journeys.

## Traceability

Each scenario's home test carries `[spec: <id>]` in its name, so you can trace a
scenario to the test that proves it (and back):

```ts
it('creates and lists a note [spec: notes/create]', …)
```

`pnpm test:behavior` fails unless every required proof exists, integration behavior
coverage is 100%, and critical E2E behavior coverage is 100%.

## Escalation

If a non-technical audience ever needs to *run* the Gherkin, wire `playwright-bdd`
(compiles `.feature` → Playwright, keeps the native runner). These are already real
`.feature` files, so that step is drop-in.
