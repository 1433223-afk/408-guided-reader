# GitHub-safe development mirror

This repository starts with a new root commit containing a filtered snapshot of the Windows
personal stable baseline `df1e3a6c65bd727c037be383c54f0f15653e1cd8` (original tag
`personal-v0.1`). The original repository, its history and tag remain local and unchanged.
The tag is a provenance reference, not a ref included in this repository.

## Included and excluded

Product code, schema/migrations, all 77 test sources, package manifests/lockfile, the empty-key
configuration template, authority documents, Phase briefs and development evidence are preserved.
All four `docs/ui/masters/*.png` images from the source snapshot are excluded because they display
representative textbook/learning content. References in historical briefs remain as provenance;
the image files are intentionally unavailable here. No replacement images were generated.
No original Git objects/history, PDF, SQLite, database backup, OCR export, user learning data,
secret, installed dependency, cache, screenshot or runtime directory was copied.

The only export changes are this document and additional `.gitignore` rules. Source and test
files are byte-identical to the original commit. Test fixtures embedded in test source and
bounded examples in engineering documentation remain; these are not a personal Library export.

## Development and deployment boundary

Follow README.md to install dependencies and run locally. Supply private material and credentials
outside Git. Real-material E2E tests require a separately prepared Library and are not portable
fixtures supplied by this repository. Prior test results in development reports describe the
original baseline; they do not claim a fresh Linux or Beta acceptance run.

This is source backup and a starting point for future FRIENDS_PRIVATE_BETA work, not a deployed
Beta. The existing configuration template still describes the personal edition. Follow the
accepted Beta brief for future server configuration and security implementation.

Do not fetch/merge/push the original personal repository's history or tags into this mirror:
that would reintroduce excluded objects. Transfer future reviewed source changes as patches or
filtered snapshots. Do not use `git push --mirror` or `--tags` against the original repository.
A clone of this repository restores code, not personal PDFs, learning state or credentials.

## Export verification (2026-09-16)

- 230 tracked files: 72 source, 77 test, 70 documentation, one calibration tool and ten root files.
- Original snapshot comparison: only `.gitignore` differs among retained files; this document is new.
- No PDF/SQLite/DB/backup/image master, binary data signature or unresolved secret-pattern match
  was found in the export. API key fields in `.env.example` are empty. Mock test keys are retained.
- Required ignore probes pass, including the four excluded images. `credentials.*` has an exact
  exception for the product source `src/reader_service/agent_runtime/credentials.py`.
- `npm ci --ignore-scripts --no-audit --no-fund` succeeded; installed dependencies stay ignored.
  The seven targeted JS test files used for the personal baseline passed all 14 tests here.
  The initial test attempt before installing dependencies failed on missing `playwright-core`.
- Original tracked-file and Git metadata SHA-256 fingerprints remain unchanged; original status
  is clean and the annotated `personal-v0.1` tag object is unchanged.
- Remote publication is pending at this checkpoint. The GitHub plugin authenticates as
  `1433223-afk`, but exposes no repository-creation operation. The browser creation fallback
  reached a sign-in page and subsequent browser control timed out. No noninteractive GitHub
  Git credential is available locally. No GitHub repository was created and no files uploaded.
