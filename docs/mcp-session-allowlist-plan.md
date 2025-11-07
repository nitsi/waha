# MCP Session Allowlist Plan

## Objective
- Allow operators to define a configuration-driven allowlist of session names that MCP clients are permitted to act on, preventing accidental or malicious control over unauthorized sessions.
- Enforcement should cover every MCP transport (stdio and HTTP) without impacting regular REST/WebSocket clients unless explicitly configured to share the same policy.

## Strategy Overview
1. **Configuration surface**
   - Introduce a dedicated env var such as `WAHA_MCP_ALLOWED_SESSIONS` (comma-separated) and expose it via `WhatsappConfigService` to keep parsing logic centralized.
   - Update `ConfigModule.forRoot` validation schema(s) to accept the new variable.
2. **Policy evaluation layer**
   - Extend `WhatsappConfigService` with helpers (`getMcpAllowedSessions()`, `isMcpSessionAllowed(name)`) that normalize names (trim, dedupe, drop blanks).
   - Log misconfigurations (empty list, invalid characters) during `onApplicationBootstrap`.
3. **MCP enforcement points**
   - Inside `WahaMcpService` tool handlers (send_text/image/file, check number, contact lookup, session management), call a shared guard (e.g., `assertMcpSessionAllowed(session)`).
   - The guard should throw a `ForbiddenException` (or `UnprocessableEntityException`) with a clear message and optionally surface the allowed names.
   - Ensure both stdio and HTTP transports funnel through the same guard so no bypass exists.
4. **Resource exposure**
   - Filter `waha_list_sessions`, `waha_get_session`, and any `resources` exposed through MCP to hide entries that the allowlist disallows (or retain them but mark as inaccessible; decide in design clarification).
5. **Authentication & HTTP guard coordination**
   - Optionally thread the allowlist into `McpHttpAuthGuard` so the guard can reject at the HTTP layer before the tool handler executes, giving faster feedback.
6. **Operator-facing documentation**
   - Document the new env var, precedence, and sample `.env`/compose overrides in README + MCP docs.
   - Explain that MCP calls fail fast when the session is outside the permitted set.
7. **Testing & validation**
   - Add/extend unit tests for `WhatsappConfigService` parsing and `WahaMcpService` behavior (mock session manager) to ensure allowed/disallowed flows behave as expected.
   - Validate both MCP transports manually or via integration tests if available, then run `pre-commit`, `yarn build`, and `yarn test`.

## Detailed Implementation Steps
1. **Config plumbing**
   - Update `src/core/app.module.core.ts` (and Plus module when applicable) `ConfigModule.forRoot` schema to include the optional string var.
   - In `src/config.service.ts`, parse the env value once, store the array, and expose helper methods dedicated to MCP access control.
   - Keep behavior simple: when the MCP list is empty, block all MCP session access (no fallback list exists).
2. **Shared guard helper**
   - Add `assertMcpSessionAllowed(sessionName: string)` to `WahaMcpService` (or a dedicated utility) that uses the config service to evaluate access and throws when disallowed.
   - Reuse this helper across all tool/resource handlers right after extracting `session`.
   - Consider caching the boolean results per session for performance if the list grows large (probably unnecessary now).
3. **Tool/resource adjustments**
   - Verify every `this.mcpServer.registerTool` handler that accepts a `session` argument invokes the guard before calling `sessionManager`.
   - For `waha_list_sessions` and resource listings, either filter the returned array by allowed names or include a metadata flag (e.g., `accessible: false`) depending on UX decisions.
4. **HTTP transport hook (optional)**
   - Extend `McpHttpAuthGuard` (or introduce a new guard) to fail early when the request payload targets a forbidden session; this requires inspecting the request body, so weigh complexity vs. benefit.
5. **Docs & release notes**
   - Update `docs/MCP.md`, README config tables, and any deployment examples.
   - Highlight that MCP access will error with HTTP 403 / MCP error when sessions fall outside the allowlist.

## Open Questions & Assumptions
- How should errors be surfaced to MCP clients—HTTP 403, tool-level error response, or both? **Decision: surface both (HTTP 403 for HTTP transport plus structured MCP tool errors)**.
- Do we need per-transport overrides (e.g., stdio allowed sessions differ from HTTP)? **Decision: no transport-specific overrides; one list applies everywhere.**
- Should the allowlist support wildcards/prefixes, or is an explicit list sufficient? **Decision: explicit lists only.**
- What is the expected behavior when the allowlist is empty? (Current assumption: no MCP session access allowed.) **Decision confirmed: empty list blocks all MCP session access.**
