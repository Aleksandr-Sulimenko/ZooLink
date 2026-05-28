---
version: "1.2"
lastUpdated: "2026-05-28"
author: "System Analyst"
status: "Approved"
---

# Spec: Testing Strategy

## Outcome
Define a comprehensive testing strategy for ZooLink that ensures high code quality, reliability, and maintainability. Achieve test coverage ≥ 90–95% with a focus on unit, integration, and end-to-end tests where applicable. Implement TDD/BDD practices where possible.

## Scope & Boundaries
**In Scope:**
- Unit testing for frontend and backend components
- Integration testing for API endpoints and service interactions
- End-to-end (E2E) testing for critical user flows
- Test coverage measurement and reporting
- Test-driven development (TDD) and behavior-driven development (BDD) guidelines
- Test environment setup and CI/CD integration
- Mocking strategies for external dependencies

**Out of Scope:**
- Performance testing (load, stress) - deferred to phase 2
- Security penetration testing - deferred to phase 2
- Accessibility testing (a11y) - deferred but considered in component design
- Usability testing - deferred to product team
- Visual regression testing - deferred to phase 2

## План нагрузочного и стресс‑тестирования (k6/Locust)

Для оценки производительности системы под нагрузкой в фазе 2 и выше рекомендуется использовать k6 или Locust для имитации реалистичных сценариев использования.

### Рекомендуемые сценарии
1. **Всплеск регистрации пользователей** – 1000 новых пользователей за 5 минут (Simulating peak load during marketing campaigns)
2. **Конкурентное создание объявлений** – 500 активных пользователей одновременно создающих объявления
3. **Гео‑поиск под нагрузкой** – 1000 запросов/сек с более чем 100k объявлений в базе
4. **Смешанный рабочий нагруз** – Комбинация просмотра объявлений, поиска, создания объявлений и аутентификации

### Целевые показатели
- 95-й перцентиль задержки < 2s для критических пользовательских потоков
- Частота ошибок < 0.1%
- Stability: система остается отзывчивой во время часового теста устойчивой нагрузки
- Потребление ресурсов: CPU < 70%, RAM < 80% при пиковой нагрузке

### Инструменты
- **k6** – предпочтителен для скриптового тестирования на JavaScript/TypeScript, хорошая интеграция с CI
- **Locust** – удобен для сценарного тестирования на Python, распределенное тестирование


## Constraints
- **Coverage Target:** ≥ 90–95% overall code coverage (with exceptions only for trivial code like getters/setters)
- **Technology:** Must align with selected stack (NestJS/Jest for backend, React Testing Library/Jest/Vitest for frontend, Cypress/Playwright for E2E)
- **Speed:** Unit tests should run fast (<5s for backend unit suite, <10s for frontend unit suite)
- **Reliability:** Tests should be deterministic and not flaky
- **Maintainability:** Tests should be easy to write, read, and modify
- **Isolation:** Unit tests should isolate the unit under test using mocks/spies
- **CI/CD:** Tests must run on every pull request and merge to main

## Prior Decisions
- **Backend Testing:** 
  - Framework: Jest with supertest for API testing
  - Mocking: Jest mocks for external services (Twilio, Redis, etc.)
  - Database: Use SQLite in-memory or transactional rollbacks for tests
  - Coverage Tool: Jest built-in coverage or nyc
  
- **Frontend Testing:**
  - Framework: Jest with React Testing Library (or Vitest if switching)
  - Mocking: Mock service workers (MSW) for API calls
  - User Events: Testing Library user-event or Cypress for interaction
  
- **End-to-End Testing:**
  - Framework: Cypress (chosen for its maturity and ease of use)
  - Alternative: Playwright considered but Cypress selected for better DX
  - Scope: Critical user flows (registration, listing creation, search, moderation)
  
- **Test Organization:**
  - Backend: `src/**/*.spec.ts` alongside source files
  - Frontend: `src/**/*.test.tsx` or `__tests__` folders
  - E2E: `cypress/` or `e2e/` directory at project root
  
- **BDD/TDD Approach:**
  - Encourage writing tests before implementation (TDD) where feasible
  - Use Given/When/Then comments in tests for BDD-like readability
  - Focus on testing behavior, not implementation details

## Task Breakdown
1. **Backend Testing Setup**
   - [ ] Configure Jest in backend project (already in package.json)
   - [ ] Set up test database configuration (separate from dev/prod)
   - [ ] Create test utilities: mock services, test data factories
   - [ ] Implement transactional test helper for Prisma (rollback after each test)
   - [ ] Create example unit test for IdentityService
   - [ ] Create example integration test for AuthController
   - [ ] Set up coverage threshold in package.json (--coverageThreshold)
   - [ ] Configure test timeout and isolation settings

2. **Frontend Testing Setup**
   - [ ] Create frontend package.json with testing dependencies
   - [ ] Install React Testing Library, Jest, @types/jest
   - [ ] Set up jest.config.js for frontend
   - [ ] Create test utilities: custom render function, mock providers
   - [ ] Set up MSW (Mock Service Worker) for API mocking
   - [ ] Create example unit test for a domain use case
   - [ ] Create example component test for a view component
   - [ ] Configure testing library user-event

3. **End-to-End Testing Setup**
   - [ ] Install Cypress at project root
   - [ ] Create cypress.config.js
   - [ ] Set up baseUrl for testing (point to local dev environment)
   - [ ] Create custom commands for common actions (login, create listing)
   - [ ] Set up test data seeding/cleanup before/after tests
   - [ ] Create example E2E test for user registration flow
   - [ ] Create example E2E test for listing creation and search
   - [ ] Configure Cypress to run on CI

4. **Test Data Factories**
   - [ ] Create backend test data factories (using libraries like factory-ts or custom)
   - [ ] Create frontend test data factories/mocks
   - [ ] Ensure test data is realistic and covers edge cases
   - [ ] Implement test data cleanup strategies

5. **CI/CD Integration**
   - [ ] Configure GitHub Actions to run tests on pull requests
   - [ ] Set up separate jobs for backend, frontend, and E2E tests
   - [ ] Configure coverage reporting (upload to codecov or similar)
   - [ ] Set up test result artifacts and notifications
   - [ ] Configure test caching to speed up CI

6. **Testing Guidelines and Best Practices**
   - [ ] Document testing conventions (naming, structure, mocking)
   - [ ] Create CONTRIBUTING.md section on testing
   - [ ] Encourage test reviews as part of code review
   - [ ] Set up pre-commit hooks to run relevant tests (optional)
   - [ ] Define what constitutes a "good test" vs. brittle test

## Verification Criteria
- [ ] Backend unit tests achieve >90% coverage for all modules
- [ ] Frontend unit tests achieve >85% coverage for domain and system layers (view layer may be lower)
- [ ] Integration tests cover all API endpoints with positive and negative cases
- [ ] E2E tests cover critical user flows: registration, login, create listing, search, moderation
- [ ] Tests are deterministic: running same test suite multiple times gives same result
- [ ] Test suite runs fast: backend unit tests <5s, frontend unit tests <10s, full E2E suite <5m
- [ ] CI/CD pipeline fails on test failures and blocks merges
- [ ] Coverage reports show no significant drop over time
- [ ] Documentation: testing guidelines are clear and followed by contributors
