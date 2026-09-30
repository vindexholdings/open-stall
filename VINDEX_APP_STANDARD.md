# Vindex Application Standard v1
Do not create separate email identities per app merely for isolation. Use Vindex organizations/teams with separate resources per venture.

Default: one GitHub repo, one Supabase project, one Vercel project, one Expo project, unique secrets/IDs, project-local agent instructions.

Agents never infer a target from account-wide lists.

Each repo keeps durable memory: agent rules, PRD, architecture, environment bindings, backlog, PROJECT_STATE, testing/security docs.

AI may implement/test/commit on feature branches. Human approval is required for main merge, production deployment/infrastructure, spending and material scope/security changes.

Favor standard code/infrastructure over no-code lock-in so professional developers can take over the same repo.
