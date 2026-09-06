# Bundled fonts

Noto Sans is the shared font for the application UI, learning content, and IPA.
Both variable font files include weights 100 through 900, Vietnamese characters,
and IPA symbols. They are bundled locally so font rendering does not depend on a
network connection. Actual code and keyboard shortcuts retain the system
monospace stack. Charis SIL remains a fallback for uncommon phonetic glyphs.

Source: https://github.com/google/fonts/tree/main/ofl/notosans

- `NotoSans-Variable.ttf`: upstream `NotoSans[wdth,wght].ttf`
- `NotoSans-Italic-Variable.ttf`: upstream `NotoSans-Italic[wdth,wght].ttf`
- License: `NotoSans-OFL.txt` (SIL Open Font License 1.1)

The standalone HTML export templates use a system sans-serif stack because they
must work outside the application without access to bundled assets.
