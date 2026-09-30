# Workflow
Never work directly on main.
Branches: feat/<task>-name, fix/<task>-name, chore/<task>-name.

Cycle: read PROJECT_STATE → current BACKLOG task → verify bindings → feature branch → inspect relevant files only → brief plan → implement → targeted tests → fix → commit → update state/backlog → continue only if task boundary is clear and usage/context healthy.

Human approval before main merge, production deploy/migration, production infrastructure, spending, core architecture/scope/security changes or material deletion.

Token efficiency: Git/files are durable memory; no full-project recap on resume; exact file paths; targeted search/tests; concise output; checkpoint at boundaries. If near usage limit, update PROJECT_STATE and stop rather than starting a new task.

Resume instruction:
"Resume Open Stall from PROJECT_STATE.md. Follow CLAUDE.md. Continue only the next approved backlog task."
