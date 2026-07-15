# The Core Telemetry Categories

## Strategic Value

Pensieve identifies moments where the developer's reasoning materially improved the quality or direction of the work.

Examples include:

* rejecting an unsafe architecture;
* identifying a concurrency issue;
* simplifying an overengineered solution;
* recognizing an overlooked product requirement;
* correcting an incorrect AI assumption;
* introducing a reusable system pattern;
* reframing a vague task into a clear execution plan.

Example output:

> Prevented a potential data consistency issue by identifying that the proposed write flow lacked transactional boundaries across the billing and account services.

## Decision Record

Pensieve preserves important technical and product decisions together with their rationale.

This includes:

* what decision was made;
* what alternatives were considered;
* which constraints influenced the decision;
* why the final direction was selected;
* and what risks remain.

Example output:

> Chose asynchronous document processing over synchronous API execution to avoid request timeouts and support retryable workloads. Accepted additional operational complexity in exchange for reliability and scalability.

## Friction Audit

Pensieve identifies work that consumed disproportionate time without producing equivalent value.

Examples include:

* repeated environment failures;
* dependency and configuration issues;
* unclear internal documentation;
* unstable AI-generated changes;
* repetitive prompt correction;
* tool integration failures;
* excessive context rebuilding.

Example output:

> Spent approximately 90 minutes resolving local environment incompatibilities across Node.js versions and package-lock state.

The purpose is not to criticize the developer. It is to reveal where systems, tools, or workflows should improve.

## High-Potential Seeds

Pensieve captures promising ideas that emerge during active work but are not immediately pursued.

These may include:

* product opportunities;
* reusable abstractions;
* internal tooling ideas;
* architectural improvements;
* automation opportunities;
* research questions;
* alternative implementation paths.

Example output:

> Consider creating a schema-aware migration reviewer that compares application assumptions against production database constraints before deployment.

These ideas are stored in a private sandbox for later review.

## AI Leverage

Pensieve identifies where AI meaningfully accelerated work and where the developer successfully delegated execution.

Example output:

> Used the coding agent to generate repetitive API adapters after first defining the interface contract, error model, and test expectations.

This helps developers understand which patterns of delegation work well.

## AI Correction Load

Pensieve measures cases where the developer had to repeatedly correct, redirect, or constrain the AI.

Example output:

> The agent repeatedly introduced stateful logic into a stateless service despite explicit constraints. Three implementation attempts were rejected before the approach was corrected.

This can reveal weak prompts, insufficient context, unreliable tools, or tasks that should not yet be delegated.
