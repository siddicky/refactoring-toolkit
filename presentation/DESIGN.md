# Presentation design contract

Reference: the user's existing presentation at `https://delvee.siddicky.ca/`, inspected on 29 September 2026. The Vercel homepage uses that page's DOM, inline styles, and interactions as its visual and content contract. The separately recorded cx9 presentation remains at `cx9.html`.

## Tokens

- Accent `#9fef00`; canvas `#0b111d`; panel `#111927`; raised panel `#182334`.
- Divider `#29374c`; muted text `#a4b1cd`; primary text `#f5f7fa`.
- Reading type: Instrument Sans. Display type: Geist. Data labels: Geist Mono.
- Content width: 1180 px. Full-page panels and evidence sections have fine dividers, square corners, and compact uppercase mono labels.

## Layout and interactions

- Sticky 76 px header with geometric lime mark and a section index.
- Hero: outlined label, two-line regular-weight headline with lime phrase, paragraph, two actions, then an illustrative workflow panel.
- The page continues with context, architecture, workflow, recovery, evidence, dashboard, fit, and discussion sections.
- The workflow simulation, scenario controls, code comparison, and evidence drawer are real DOM interactions.
- At narrow widths, navigation and grids adapt to the reference page's media queries. Links and controls retain visible focus states.

## Evidence boundary

The homepage reproduces the cx-5e presentation and its saved artifacts. It labels the workflow simulation as illustrative and the dashboard captures as static. The cx9 run is a separate recorded presentation at `cx9.html` with its own evidence and limits.

The Biome override preserves the reference's keyboard-focusable scroll regions and interactive SVG groups. Both have explicit accessible labels and keyboard handlers; replacing them with HTML buttons would change the SVG diagram structure.
