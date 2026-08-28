---
name: pr-permalink
description: Convert a GitHub PR diff URL to a blob permalink that auto-expands in PR comments
user-invocable: true
---

# PR Permalink

Converts a GitHub PR diff URL (from the Files Changed tab) into a blob permalink that GitHub auto-expands into an embedded code snippet when pasted in a comment.

## Usage

User provides a URL like:
```
https://github.com/<owner>/<repo>/pull/<number>/files#diff-<hash><L|R><start>-<L|R><end>
```

Run the script:
```bash
unset GH_TOKEN && python3 ~/.claude/scripts/pr-permalink.py "<url>"
```

Return the output URL to the user. That's it.

## How it works

1. Parses the PR diff URL to extract owner, repo, PR number, diff hash, side (L=base, R=head), and line range
2. Uses `gh api` to list PR files, SHA256-hashes each file path to match the diff hash back to a filename
3. Gets the base SHA (for L-side) or head SHA (for R-side) from the PR
4. Constructs a `/blob/<sha>/<path>#L<start>-L<end>` URL
