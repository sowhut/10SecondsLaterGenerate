# Official level branch

The public `main` branch intentionally contains no official level bodies.

Production level data lives on the protected `levels` branch:

```text
levels/
  official/L01.json
  official/L02.json
  ...
  playtest-approvals.json
```

The branch uses the editor, schema, validation, and publishing tools inherited
from `main`. Released JSON is public because the game client must download it.
Drafts and unreleased designs should stay under the gitignored `.private/`
directory until they are approved for publication.

For a separate local content directory, run commands with
`LEVELS_CONTENT_DIR=/absolute/path/to/content`. The directory must contain
`official/` and `playtest-approvals.json` with the same layout.
