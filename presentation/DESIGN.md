# Static demo design

This presentation keeps the mission-control dashboard's existing visual language: a dark ink canvas, compact monospace labels, thin blue-gray dividers, and green for verified progress. The page is a recorded run, so its status language must always say "recorded" and its figures must match `assets/cx9-evidence.md` and `assets/report-final.md`.

## Tokens

- Canvas `#0a0e14`, panel `#0e141d`, border `#1c2634`.
- Main text `#b6c2cf`, muted text `#8292a3`, green `#6fdc8c`, blue `#6cb6ff`, amber `#e3b341`.
- System monospace stack for labels and data. System sans stack for the reading headline.
- Spacing uses 4 px increments. Panels use an 8 px radius and a single border.

## Layout and behavior

- Centered content with a 1120 px maximum width, a two-column evidence grid on desktop, and one column on narrow screens.
- Video remains user-controlled, with no autoplay. Links have visible focus states.
- The recorded status is text, not a simulated live indicator. No network polling occurs.
