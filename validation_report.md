# Concert data validation report

_Auto-generated · 120 concerts scanned · internal-consistency pass only (no API calls)._


## 1. Spelling clusters

Bands whose name appears with multiple spellings in your spreadsheet. Same-named bands that look like distinct entries are grouped here using the same normalization the app uses (lowercase, drop leading 'The', strip punctuation/spaces). Most-frequent spelling is the likely canonical form; rarer variants are flagged as **suspects** to review.


_No spelling clusters found — every band name is consistent._


## 2. Structural concerns in opener cells

Rows where the `Opening Acts` cell has formatting issues that look like data-entry slips: stray commas, duplicate openers within one show, or unusually short opener names that may be truncated.


**2 rows with concerns:**


- **row 87** · 2023-09-07 · `Blue Ridge Rock Festival` @ Virginia International Raceway
  - opener cell: `Slipknot, Danzig, Motionless in White, Sleep Token, Knocked Loose, Lorna Shore, Polyphia, Testament, VV, Electric Callboy, Coal Chamber, Flyleaf, The Black Dahlia Murder, Job For Cowboy, After The Burial, Woe Is Me, Like Moths to Flames, The Acacia Strain, Of Mice & Men, Chelsea Grin, Catch Your Breath, Black S. Cherry, Upon A Burning Body, Afterlife, Struggle Jennings, Angelmaker, Crown the Empire, Conquer Divide, TrustCompany, Savage Hands, Demun Jones, Archers, Starbenders, Oliver Anthony`
  - ⚠ very short opener name: `'VV'`

- **row 99** · 2024-05-19 · `Sonic Temple Festival` @ Historic Crew Stadium
  - opener cell: `Slipknot, Limp Bizkit, A Day to Remember, Royal Blood, Bad Religion, Saliva, Sleep Theory, 311, Architects, Wage War, Of Mice & Men, Reignwolf, Kim Dracula, Blind Channel, Clutch, Baroness, Helmet, Red Fang, Crobot, Plush, Moon Fever, Return to Dust, Tech N9ne, L7, While She Sleeps, Taproot, Bad Nerves, Dead Poet Society, Eva Under Fire`
  - ⚠ very short opener name: `'L7'`

---

_Next pass: API cross-check against setlist.fm to validate that the openers you've listed match what setlist.fm has for each show. Run after fixing anything actionable above._
