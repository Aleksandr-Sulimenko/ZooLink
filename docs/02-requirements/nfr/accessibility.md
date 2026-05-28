# Accessibility Non-Functional Requirements: ZooLink

## Purpose
Defines accessibility requirements to ensure the platform is usable by people with diverse abilities, including visual, auditory, motor, and cognitive impairments. Complies with WCAG 2.1 AA standards and considers Russian Federal Law No. 381-FZ "On Accessibility of the Environment for Persons with Disabilities".

## Scope
Applies to all user-facing components: web application (SPA/PWA), documentation, and user-generated content guidelines.

## Accessibility Principles (POUR)
1. **Perceivable**: Information and UI components must be presentable in ways users can perceive.
2. **Operable**: UI components and navigation must be operable.
3. **Understandable**: Information and UI operation must be understandable.
4. **Robust**: Content must be robust enough to be interpreted reliably by a wide variety of user agents.

## WCAG 2.1 AA Compliance Target
The platform aims to meet WCAG 2.1 Level AA success criteria. Key areas of focus:

### 1. Perceivable
- **Text Alternatives**:
  - All non-decorative images have meaningful alt text
  - Icons have accessible names (aria-label or visible text)
  - Complex images (charts, diagrams) have longer descriptions when needed
  - Audio content has transcripts (future: for video content)
  - Video content has captions and audio descriptions (planned for Фаза 2+)

- **Time-based Media**:
  - No auto-playing audio/video longer than 3 seconds without controls
  - Pausable, stoppable, hideable for moving/blinking/scrolling content
  - No content that flashes more than 3 times per second (or below general flash and red flash thresholds)

- **Adaptable**:
  - Information and structure can be determined programmatically (proper semantic HTML)
  - Logical reading and navigation order
  - Instructions do not rely solely on sensory characteristics (e.g., "click the red button")
  - Content does not restrict view/operations to single display orientation (portrait/landscape both supported)

- **Distinguishable**:
  - Color is not used as the only visual means of conveying information
  - Text contrast ratio: minimum 4.5:1 for normal text, 3:1 for large text
  - Large text (18pt+ or 14pt bold) meets 3:1 contrast
  - UI components and graphical objects: 3:1 contrast ratio
  - Text can be resized up to 200% without loss of content or functionality
  - Text spacing (line height, paragraph spacing, letter spacing, word spacing) can be adjusted
  - Content does not require horizontal scrolling at 320px width equivalent
  - Text spacing overrides do not cause loss of content or functionality
  - Hover/focus content: dismissable, hoverable, persistent

### 2. Operable
- **Keyboard Accessible**:
  - All functionality available via keyboard
  - No keyboard traps (focus can be moved away using only keyboard)
  - Visible focus indicator for all interactive elements
  - Logical tab order following visual order
  - Skip navigation links available (to bypass repetitive content)
  - Access keys not used (to avoid conflicts with assistive tech)

- **Enough Time**:
  - For each time limit set by content, users can:
    - Turn it off
    - Adjust it
    - Extend it
  - Exceptions: real-time events (live auctions - Фаза 2+), essential timing
  - Users warned before time expires and given opportunity to extend
  - No content designed to cause seizures or physical reactions

- **Seizure and Physical Reactions**:
  - No content flashes more than 3 times per second
  - General flash threshold: no more than 3 general flashes
  - Red flash threshold: no more than 3 red flashes

- **Navigable**:
  - Way to bypass repeated content blocks (skip links)
  - Page titles descriptive and informative
  - Focus order logical and preserves meaning
  - Link purpose clear from link text or context
  - Multiple ways to locate pages (navigation, search, sitemap)
  - Headings and labels describe topic/purpose
  - Visible focus indicator
  - Keyboard shortcuts (if provided) can be remapped or turned off

### 3. Understandable
- **Readable**:
  - Language of page identifiable (lang attribute on html element)
  - Language of parts identifiable (for multilingual content in Фаза 2+)
  - Text readable and understandable (avoid jargon, explain abbreviations)
  - Unusual words defined (via glossary or tooltip)
  - Abbreviations expanded (first use)
  - Reading level considered (aim for clear, simple language)

- **Predictable**:
  - On focus: does not initiate change of context
  - On input: does not initiate change of context unless previously explained
  - Consistent navigation mechanisms
  - Consistent identification of functional elements with same function

- **Input Assistance**:
  - Errors identified and described in text
  - Error suggestions provided when possible
  - Error prevention (legal, financial, data changes): reversible, checked, confirmed
  - Help contextual and accessible
  - Instructions provided for complex forms

### 4. Robust
- **Compatible**:
  - Maximize compatibility with current and future user agents
  - Valid HTML where possible (minimize validation errors that impact accessibility)
  - Name, role, value: for all UI components
  - Status messages: programmatically determinable through role or aria-live
  - No reliance on specific technology or browser

## Platform-Specific Accessibility Requirements
### Web Application (SPA/PWA)
- **Semantic HTML**:
  - Use proper HTML5 elements: header, nav, main, section, article, aside, footer
  - Heading levels (h1-h6) used hierarchically and sequentially
  - Lists (ul, ol, dl) used for grouping related items
  - Tables used only for tabular data with proper th, caption, scope
  - Forms use label elements properly associated with inputs

- **ARIA Usage**:
  - Use ARIA only when native HTML insufficient
  - Prefer native elements over ARIA roles (e.g., use button instead of div role="button")
  - ARIA attributes validated for correctness
  - Live regions used appropriately for dynamic content (polite/assertive)
  - Modal dialogs: trap focus, return focus to trigger, background inert
  - Navigation landmarks: banner, navigation, main, complementary, contentinfo
  - Disclosure widgets: use disclosure pattern with aria-expanded

- **Keyboard Navigation**:
  - All interactive elements reachable and operable via keyboard
  - Custom widgets follow ARIA authoring practices
  - Skip to main content link present and functional
  - Keyboard focus visible and clear (minimum 2px contrast, not just outline:none)
  - Focus management: when opening dialogs, menus, etc., focus moves appropriately
  - Focus returned to logical place after closing
  - No positive tabindex values (use 0 or -1 only when needed)

- **Color and Contrast**:
  - Text and interactive elements meet contrast ratios
  - UI components (buttons, inputs, etc.) have 3:1 contrast against adjacent colors
  - Instructions do not rely solely on color (e.g., "required fields in red")
  - Color blindness considerations: use patterns, icons, text in addition to color
  - Dark/light mode: both themes meet contrast requirements (to be evaluated)

- **Typography and Readability**:
  - Base font size minimum 16px (or browser default)
  - Line height minimum 1.5 for paragraphs
  - Paragraph spacing minimum 2x font size
  - Fonts chosen for readability (sans-serif preferred for UI)
  - Text alignment: left-aligned for LTR languages (center/justified avoided for large blocks)
  - Letter and word spacing adjustable via user stylesheet
  - Avoid text images; use actual text that can be resized and read by screen readers

- **Forms and Inputs**:
  - Every form field has associated label
  - Required fields indicated with text and/or aria-required (not just color)
  - Error messages associated with inputs via aria-describedby or live region
  - Input constraints described (min/max, pattern) in accessible way
  - Autocomplete attributes used appropriately
  - Fieldsets and legends used for grouping related fields
  - Error prevention: confirmation for irreversible actions
  - Submit and reset buttons distinguishable
  - Touch targets minimum 44x44 CSS pixels (with spacing)

- **Media and Non-text Content**:
  - Alt text: descriptive, not redundant, empty string for decorative (alt="")
  - Complex images: describe essential information
  - Infographics: provide data table or summary
  - Icons: accessible names, SVG preferred with title/desc
  - Audio: controls, volume adjustment, no auto-play
  - Video: controls, captions, transcripts, audio description (Фаза 2+)
  - Animated content: can be paused, stopped, hidden
  - Emoji: used sparingly, with understanding they may be read literally

- **Responsiveness and Touch**:
  - Content reflows correctly at 320px width
  - Touch targets: minimum 44x44 dp with sufficient spacing
  - Gestures: simple tap/click preferred; complex gestures have alternatives
  - Motion actuation: alternatives provided for device motion/user movement
  - Pointer gestures: single point actions where possible

### User-Generated Content Guidelines
- **Listing Descriptions**:
  - Encourage clear, concise descriptions
  - Suggest avoiding excessive abbreviations or jargon
  - Recommend placing critical information in text (not just in photos)
  - Guidelines provided in UI: "Describe the animal clearly: breed, age, health status"

- **Photo Guidelines**:
  - Encourage photos that clearly show the animal
  - Suggest multiple angles for livestock (conformation, udder/testes, side views)
  - Warn against misleading photos (stock images, unrelated animals)
  - Alt text generation: system will prompt for description or use AI suggestion (Фаза 2+)

- **Communication**:
  - Encourage clear, respectful communication
  - Guidelines against harassment or discriminatory language
  - Reporting mechanism accessible for abusive content

## Accessibility Testing & Validation
### Automated Testing
- **Tools**: axe-core, Lighthouse, pa11y, or similar integrated into CI pipeline
- **Frequency**: On every pull request and nightly against main branch
- **Rules**: WCAG 2.1 AA, Section 508, EN 301 549
- **Failure Threshold**: No new critical or serious violations; existing violations require remediation plan
- **Manual Review**: Automated tools supplemented with manual testing

### Manual Testing
- **Keyboard Navigation**: 
  - Tab through entire application
  - Test all custom widgets (modals, dropdowns, date pickers)
  - Verify focus order and visibility
  - Test skip links and landmark navigation
- **Screen Reader Testing**:
  - Primary: NVDA (Windows) + Firefox or JAWS + IE/Edge
  - Secondary: VoiceOver (macOS/iOS) + Safari
  - Test common user journeys: registration, listing creation/search, contact reveal
  - Check for: announcement of dynamic content, proper labeling, logical reading order
- **Color Contrast**: 
  - Manual checks using contrast checkers
  - Verification of text over images/gradients
  - Focus indicator visibility
- **Zoom and Text Resize**:
  - Test at 200% zoom (no loss of content/functionality)
  - Test text-only zoom (browser setting)
  - Verify reflow and readability
- **Mobile Accessibility**:
  - Test with TalkBack (Android) and VoiceOver (iOS)
  - Verify touch target size and spacing
  - Test orientation changes (portrait/landscape)
  - Verify responsive breakpoints

### User Testing
- **Involve People with Disabilities**:
  - Recruit users with various impairments for usability testing
  - Focus groups for feedback on accessibility features
  - Paid testing sessions recommended
- **Scenarios to Test**:
  - Registration and profile setup
  - Creating and editing animal profiles
  - Creating, moderating, and viewing listings
  - Searching and filtering results
  - Contact reveal process
  - Moderator workflow (if applicable)
  - Help and support access

## Roles and Responsibilities
### Designers
- Ensure wireframes and mockups consider accessibility from start
- Specify focus orders, alternative text for images, accessible color palettes
- Document accessibility considerations in design system
- Validate color contrast in designs

### Developers
- Implement semantic HTML and proper ARIA usage
- Ensure keyboard operability of all interactive components
- Validate accessibility in browsers and assistive technologies
- Fix accessibility bugs with same priority as functional bugs
- Use accessibility linters in development workflow

### Content Creators
- Provide meaningful alt text for images they upload
- Write clear, concise, and understandable text
- Use headings correctly in longer descriptions
- Ensure linked text makes sense out of context

### QA/Testers
- Include accessibility test cases in test plans
- Perform keyboard-only and screen reader testing
- Report accessibility defects with same severity as functional defects
- Verify fixes and regressions

### Product Owners
- Prioritize accessibility features in backlog
- Ensure accessibility acceptance criteria in user stories
- Allocate time for accessibility testing and remediation
- Advocate for accessibility in stakeholder discussions

## Exceptions and Alternative Access
### Documented Exceptions
- Any exception to WCAG 2.1 AA must be:
  - Documented with justification
  - Approved by accessibility owner/product owner
  - Accompanied by equivalent facilitation plan
  - Reviewed periodically
- Examples of potential exceptions:
  - Complex historical data visualizations (may provide table alternative)
  - Third-party embeds with limited control (may provide link to accessible version)
  - Real-time collaborative features (may have asynchronous alternative)

### Alternative Access Methods
- If certain features cannot be made accessible, provide equivalent facilitation:
  - Phone support for completing actions
  - Email-based workflow
  - Assistance through intermediary (with privacy considerations)
  - Note: Alternative must provide equivalent opportunity, not inferior service

## Accessibility Roadmap
### MVP (Facза 1)
- Semantic HTML and proper heading structure
- Keyboard navigable all core functionality
- Sufficient color contrast (WCAG AA)
- Accessible forms with proper labeling
- Focus management for modals and menus
- Skip to main content link
- Alternative text for all meaningful images
- Responsive design that reflows at 320px width
- Touch targets minimum 44x44px
- Basic screen reader testing

### Фаза 2 (Growth)
- Advanced ARIA patterns for complex widgets
- Live regions for dynamic content updates
- Audio captions for video content (if added)
- Enhanced focus visible indicators
- Customizable text spacing (via user settings)
- Sign language consideration for video content (Фаза 2+)
- Expanded screen reader testing with multiple tools/languages
- Accessibility statement published with contact for feedback

### Фаза 3 (Maturity)
- Personalization options (contrast themes, font sizes, etc.)
- Advanced keyboard shortcuts (with conflict avoidance)
- Implementation of WAI-ARIA Authoring Practices 1.2
- Regular accessibility audits by third party
- Accessibility certification consideration (VPAT, etc.)
- Inclusive design practices integrated into lifecycle
- User testing with diverse disability groups scheduled regularly

## References
- WCAG 2.1: https://www.w3.org/TR/WCAG21/
- WCAG 2.1 AA Quick Reference: https://www.w3.org/WAI/WCAG21/quickref/
- EN 301 549: Accessibility requirements for ICT products and services
- Section 508 of the Rehabilitation Act (US)
- Federal Law No. 381-FZ "On Accessibility of the Environment for Persons with Disabilities" (Russia)
- GOST R 52872-2007 "Услуги связи. Телефонная связь. Общие технические требования"
- Apple Accessibility Guidelines
- Google Accessibility Guidelines
- Microsoft Accessibility Guidelines
- WAI-ARIA Authoring Practices 1.2
- Inclusive Design Principles
