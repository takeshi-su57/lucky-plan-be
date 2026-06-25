---
name: prepare-pull-request
description: Use when opening or updating a pull request so title, description, validation steps, and architecture justifications are complete.
---

# Prepare Pull Request

## Checklist
1. Title uses conventional format: `<type>(<scope>): <short description>`.
2. Description includes: Summary, Motivation (full issue URL), Changes, How to Test.
3. Add screenshots for UI changes.
4. Confirm checklist items (tests/docs/self-review).
5. If adding `apps/service-*`, include microservice justification:
   - performance reason
   - runtime pattern (cron/background)
   - independent scaling/SLO reason
   - Docker/Helm/ArgoCD/CI updates
   - reference `docs/architecture/microservice-decision-matrix.md`
