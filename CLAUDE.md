# Claude Code Instructions

## Workflow

Tasks are tracked as GitHub Issues. Follow this procedure:

1. **Get task**: Issue number is provided
2. **Analyze**: Read the issue, understand requirements, ask clarifying questions if needed
3. **Branch**: Create a new branch with prefix matching the task type: `feat/`, `bug/`, `chore/`, `refactor/`, etc. followed by issue number and short description (e.g. `feat/42-add-export`)
4. **Implement**: Do the work, including adding relevant tests
5. **Test**: Run tests before opening the PR to make sure everything passes
6. **Visual check**: If the task involves a UI element, request a visual test from the user before proceeding
7. **PR**: Create a PR linked to the issue. Include `Closes #N` in the PR body to auto-close the issue on merge. For larger tasks, open as draft first if useful.
8. **Review**: Address any PR review comments
9. **Merge**: Squash-merge by default, with PR # in the commit title. Preserve granular commit history only when it adds meaningful value.
10. **Update issue**: Add a final summary to the issue.

## Commit Conventions

- In branches: use conventional commits (`feat:`, `fix:`, `chore:`, `refactor:`, etc.)
- For PR merge: single squash commit based on the task description keeping the `feat:`, `fix:`, `chore:`, `refactor:`, etc. (e.g. `fix(server): queue version check job when config changed (#27094)`)

## GitHub

- Always use GitHub MCP tools instead of `gh` CLI
