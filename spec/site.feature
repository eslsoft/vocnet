Feature: Public site
  Learners and developers use the dictionary without signing in. The site shows
  what the public API delivers and how to call it; the console sits under
  /console behind the admin sign-in.

  @site/sources @web
  Scenario: Every page credits the reference data sources
    Given the reference sources of GET /v1/sources
    When anyone opens a public page
    Then the footer names each source with its version and licence, and its attribution and licence terms on demand
