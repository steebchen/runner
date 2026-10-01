# Suneiro identity

Suneiro brings independent threads of coding work together. The desktop interface is an operating tool: dense, readable and familiar, with branding concentrated in the mark, wordmark and color tokens.

- **Mark:** two interlocking strokes form an S. `public/suneiro-mark.svg` is the single source for the in-app mark, favicon and generated desktop icons. Keep it monochrome, uncropped and at least 24px in the app.
- **App icon:** warm ivory mark on a flat ink-blue rounded tile. Run `pnpm icons` to regenerate the desktop PNG, ICNS and ICO assets from the source mark.
- **Light palette:** white `#ffffff`, neutral gray panel `#f5f5f5`, ink text `#20374e`, accent `#285b7d`. Use neutral grays for supporting surfaces, without beige or yellow tints. Tokens live in `src/styles.css`.
- **Dark palette:** background `#141e29`, panel `#192633`, ivory text `#f3f0e7`, accent `#92c5e5`. System dark and explicit dark use the same values.
- **Type:** platform sans for native controls and readable dense text; system monospace for code. The wordmark uses semibold weight and -0.025em tracking.
- **Placement:** a small mark and wordmark above sidebar navigation, and a larger mark in the welcome state. Preserve the titlebar's traffic-light clearance, existing shortcuts and resizable panels.
- **Status:** retain distinct green additions, red deletions/errors and amber warnings. Brand colors must not replace semantic colors.

Do not add ornamental gradients, new card layouts or marketing claims to task screens. Keep focus on the user's code and agents.
