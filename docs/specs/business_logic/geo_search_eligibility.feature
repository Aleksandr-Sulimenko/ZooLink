Feature: Geo-search eligibility for listings
  As a user
  I want to search for animals within a specific radius
  So that I can find listings near my location

  Background:
    Given the system supports geo-search with radius between 1km and 100km
    And the user's location is set to latitude 55.7558, longitude 37.6176 (Moscow)

  Scenario: Search within minimum radius (1km)
    Given there is a listing located 0.5km from the user
    When the user searches for listings within 1km radius
    Then the listing should be included in the results

  Scenario: Search at exact minimum radius boundary (1km)
    Given there is a listing located exactly 1km from the user
    When the user searches for listings within 1km radius
    Then the listing should be included in the results

  Scenario: Search just outside minimum radius (1.0001km)
    Given there is a listing located 1.0001km from the user
    When the user searches for listings within 1km radius
    Then the listing should NOT be included in the results

  Scenario: Search within maximum radius (100km)
    Given there is a listing located 50km from the user
    When the user searches for listings within 100km radius
    Then the listing should be included in the results

  Scenario: Search at exact maximum radius boundary (100km)
    Given there is a listing located exactly 100km from the user
    When the user searches for listings within 100km radius
    Then the listing should be included in the results

  Scenario: Search just outside maximum radius (100.0001km)
    Given there is a listing located 100.0001km from the user
    When the user searches for listings within 100km radius
    Then the listing should NOT be included in the results

  Scenario: Invalid radius too small (0.5km)
    Given the user attempts to search with radius 0.5km
    When the search is executed
    Then an error should be returned indicating radius must be at least 1km

  Scenario: Invalid radius too large (150km)
    Given the user attempts to search with radius 150km
    When the search is executed
    Then an error should be returned indicating radius must be at most 100km

  Scenario: Valid radius within range (50km)
    Given the user searches with radius 50km
    When the search is executed
    Then the search should proceed without validation errors