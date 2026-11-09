export const DEMO_HOME_EN = 'Welcome.md'

// Sample notes use everyday topics only (trip planning, packing, errands).
export const DEMO_NOTES_EN: Record<string, string> = {
  'Welcome.md': `---
tags: [start]
aliases: [Home]
---
# Welcome to Nosidian

A Markdown notes app for your memos and your schedule in one place. It syncs with **GitHub · Google Drive · OneDrive**.

> [!tip] Try this
> - Tap an [[How to Link|internal link]] inside a note to jump to it
> - Open the **Links** button at the top right to see backlinks, the outline and the note graph
> - Open the **Calendar** tab to see your schedule. A line like \`- [ ] 14:00 Dentist\` in a Daily note is an event
> - You can type naturally in the event box, e.g. "tomorrow 3pm dentist"

## To do
- [x] Install the app
- [ ] Connect sync (Settings tab)
- [ ] Write your first note

Related notes: [[How to Link]] · [[Life/Weekend Trip]] · [[Markdown Cheatsheet]]

#start #guide
`,
  'How to Link.md': `# How to Link

Use \`[[Note name]]\` to link to another note. Notes that point to this one show up in the **Backlinks** panel.

- Alias: \`[[Welcome|Home]]\` → [[Welcome|Home]]
- Heading link: [[Markdown Cheatsheet#Math]]
- A note that does not exist yet: [[Note that does not exist yet]] (click to create it)
- Embed: part of another note is inserted below.

![[Markdown Cheatsheet#Callouts]]

#guide
`,
  'Markdown Cheatsheet.md': `# Markdown Cheatsheet

## Formatting
**Bold**, *italic*, ~~strikethrough~~, ==highlight==, \`inline code\`

## Callouts
> [!note] Note
> A plain callout.

> [!warning] Warning
> Back up important files before deleting anything.

> [!faq]- Collapsed callout
> Click to expand.

## Math
Inline $E = mc^2$ and a block:

$$
\\int_0^\\infty e^{-x^2}\\,dx = \\frac{\\sqrt{\\pi}}{2}
$$

## Code
\`\`\`ts
const hello = (name: string) => \`Hello, \${name}\`
\`\`\`

## Table
| Item | Status | Priority |
| --- | --- | --- |
| Flights | Booked | High |
| Hotel | Looking | High |
| Car rental | Comparing | Medium |

## Diagram
\`\`\`mermaid
graph LR
  Plan --> Book --> Pack --> Go
\`\`\`

## Footnotes
Here is a footnote example.[^1]

[^1]: The footnote text goes here.

#guide #syntax
`,
  'Life/Weekend Trip.md': `---
type: trip
status: Planning
with: Family
tags:
  - travel
---
# Weekend Trip

A 3-day trip with the family. The dates show up on the calendar as a range (the \`date\` and \`end\` properties of [[Weekend Trip Dates]]).

- Stay: [[Hotel Options]]
- Packing: [[Packing List]]
- Decided: [[Trip Decisions]]

#travel/weekend
`,
  'Life/Hotel Options.md': `---
type: list
status: Comparing
---
# Hotel Options

| Name | Area | Per night | Notes |
| --- | --- | --- | --- |
| Seaside guesthouse | Coast road | $75 | Breakfast included |
| City hotel | Near airport | $100 | Parking available |

- [ ] Re-read the reviews
- [ ] Check the cancellation deadline

Back to [[Weekend Trip]]
`,
  'Life/Packing List.md': `# Packing List

## Must bring
- [x] ID
- [x] Charger
- [ ] Umbrella
- [ ] First-aid kit
- [ ] Comfortable shoes

## Nice to have
- [ ] Power bank
- [ ] Sunscreen

Packing for the [[Weekend Trip]].

#travel
`,
  'Life/Trip Decisions.md': `# Trip Decisions

We chose a place close to the beach. See [[Hotel Options]] for the candidates.

- Getting around: public transport + taxi instead of a rental car
- Budget: under $350 per person

#decision
`,
}
