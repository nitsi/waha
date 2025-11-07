# WAHA MCP Server

WAHA now includes a built-in Model Context Protocol (MCP) server that allows AI assistants like Claude to interact with WhatsApp through a standardized interface.

## What is MCP?

The Model Context Protocol (MCP) is an open standard that enables AI applications to connect to external systems and tools. With WAHA's MCP server, AI assistants can:

- Send WhatsApp messages (text, images, files)
- Check if phone numbers are registered on WhatsApp
- Get contact information
- Manage WhatsApp sessions
- Access session data through resources

## Enabling the MCP Server

The MCP server is disabled by default. To enable it, set the environment variable:

```bash
WAHA_MCP_ENABLED=true
```

### Session Access Control

By default, when MCP is enabled without additional configuration, **all MCP session access will be blocked**. You must explicitly configure which sessions MCP clients are allowed to access using the `WAHA_MCP_ALLOWED_SESSIONS` environment variable.

```bash
# Allow MCP access to specific sessions (comma-separated list)
WAHA_MCP_ALLOWED_SESSIONS=default,session1,session2

# Example: Allow only the "default" session
WAHA_MCP_ALLOWED_SESSIONS=default
```

**Important Notes:**
- If `WAHA_MCP_ALLOWED_SESSIONS` is not set or is empty, MCP clients will not be able to access any sessions
- MCP tool calls targeting non-allowed sessions will fail with HTTP 403 Forbidden error
- The `waha_list_sessions` tool and `waha://sessions` resource will only return sessions that are in the allowlist
- Session names are case-sensitive and must match exactly
- This restriction applies to both stdio and HTTP transports

**Example Error Response:**
```json
{
  "error": "Session \"unauthorized-session\" is not allowed for MCP access. Allowed sessions: default, session1. Configure WAHA_MCP_ALLOWED_SESSIONS to grant access."
}
```

### Transport Configuration

WAHA MCP server supports two transport modes:

#### Stdio Transport (Default)
For local process communication (e.g., Claude Desktop):
```bash
WAHA_MCP_ENABLED=true
WAHA_MCP_STDIO=true  # Default: enabled when MCP is enabled
```

#### HTTP Transport
For remote MCP clients over network:
```bash
WAHA_MCP_ENABLED=true
WAHA_MCP_HTTP=true  # Default: disabled
```

Both transports can be enabled simultaneously. When HTTP transport is enabled, the MCP server is available at the `/mcp` endpoint.

## Available Tools

The WAHA MCP server exposes the following tools:

### 1. `waha_send_text`
Send a text message via WhatsApp.

**Parameters:**
- `session` (string): Session name
- `chatId` (string): Chat ID (phone number with @c.us or group ID)
- `text` (string): Message text

**Example:**
```json
{
  "session": "default",
  "chatId": "1234567890@c.us",
  "text": "Hello from WAHA MCP!"
}
```

### 2. `waha_send_image`
Send an image via WhatsApp from URL or base64.

**Parameters:**
- `session` (string): Session name
- `chatId` (string): Chat ID
- `file` (object): Image file data
  - `url` (string, optional): Image URL
  - `data` (string, optional): Base64 encoded image
  - `mimetype` (string, optional): MIME type
  - `filename` (string, optional): File name
- `caption` (string, optional): Image caption

### 3. `waha_send_file`
Send a file via WhatsApp from URL or base64.

**Parameters:**
- `session` (string): Session name
- `chatId` (string): Chat ID
- `file` (object): File data (same structure as `waha_send_image`)
- `caption` (string, optional): File caption

### 4. `waha_check_number`
Check if a phone number is registered on WhatsApp.

**Parameters:**
- `session` (string): Session name
- `phone` (string): Phone number in international format

**Returns:**
```json
{
  "numberExists": true,
  "chatId": "1234567890@c.us"
}
```

### 5. `waha_get_contact`
Get contact information from WhatsApp.

**Parameters:**
- `session` (string): Session name
- `contactId` (string): Contact ID (phone number with @c.us)

**Returns:**
```json
{
  "id": "1234567890@c.us",
  "name": "John Doe",
  "pushname": "John",
  "isMyContact": true
}
```

### 6. `waha_list_sessions`
List all WhatsApp sessions.

**Parameters:**
- `all` (boolean, optional): Include stopped sessions

**Returns:**
```json
{
  "sessions": [
    {
      "name": "default",
      "status": "WORKING"
    }
  ]
}
```

### 7. `waha_get_session`
Get detailed information about a WhatsApp session.

**Parameters:**
- `session` (string): Session name

**Returns:**
```json
{
  "name": "default",
  "status": "WORKING",
  "me": {
    "id": "1234567890@c.us",
    "pushName": "My WhatsApp"
  }
}
```

## Available Resources

### `waha://sessions`
Returns a list of all active WhatsApp sessions in JSON format.

## Available Prompts

### `send-message`
Guides through sending a WhatsApp message with step-by-step instructions.

**Parameters:**
- `session` (string): Session name
- `recipient` (string): Recipient phone number or chat ID
- `messageType` (enum): Type of message to send (`text`, `image`, `file`)

## Using WAHA MCP Server

### With Claude Desktop (Stdio Transport)

To use WAHA MCP server with Claude Desktop, add the following to your Claude Desktop configuration file:

**On Windows:** `%APPDATA%\Claude\claude_desktop_config.json`
**On macOS:** `~/Library/Application Support/Claude/claude_desktop_config.json`

```json
{
  "mcpServers": {
    "waha": {
      "command": "node",
      "args": ["dist/main.js"],
      "cwd": "/path/to/waha-2025",
      "env": {
        "WAHA_MCP_ENABLED": "true",
        "WAHA_MCP_ALLOWED_SESSIONS": "default",
        "WHATSAPP_API_PORT": "3000"
      }
    }
  }
}
```

Replace `/path/to/waha-2025` with the actual path to your WAHA installation.

### With Remote Clients (HTTP Transport)

To use WAHA MCP server with remote MCP clients over HTTP:

1. Enable HTTP transport and configure allowed sessions:
```bash
WAHA_MCP_ENABLED=true
WAHA_MCP_HTTP=true
WAHA_MCP_ALLOWED_SESSIONS=default,session1
```

2. Connect using the MCP HTTP endpoint:
```
http://localhost:3000/mcp
```

#### Example with MCP Inspector:
```bash
npx @modelcontextprotocol/inspector http://localhost:3000/mcp
```

#### Example with Claude Code:
```bash
claude mcp add --transport http waha http://localhost:3000/mcp
```

#### Example with VS Code:
```bash
code --add-mcp "{\"name\":\"waha\",\"type\":\"http\",\"url\":\"http://localhost:3000/mcp\"}"
```

### Security Considerations

When enabling MCP server:

**Session Access Control:**
- Always configure `WAHA_MCP_ALLOWED_SESSIONS` to restrict which sessions MCP clients can access
- Only include sessions that should be accessible to AI assistants
- Session names are case-sensitive and must match exactly
- Regularly review and update the allowlist as needed

**HTTP Transport Security:**
- Consider using WAHA's API key authentication (`WAHA_API_KEY`)
- Or use dedicated MCP API key (`WAHA_MCP_HTTP_API_KEY`) for isolated MCP access control
- Use HTTPS in production environments
- Restrict network access to trusted clients only
- Consider using a reverse proxy (nginx, Caddy) for additional security
- Monitor logs for unauthorized access attempts

## Architecture

The MCP server is implemented as a NestJS module that:

1. Integrates with WAHA's existing `SessionManager`
2. Exposes WhatsApp operations as MCP tools with proper schemas
3. Provides session data through MCP resources
4. Supports dual transport modes:
   - **Stdio transport**: For local process communication (Claude Desktop)
   - **HTTP transport**: For remote MCP clients over network (via `/mcp` endpoint)

The implementation follows WAHA's existing patterns:
- Uses the same DTOs and validation
- Leverages existing session management
- Maintains consistent error handling
- Supports all configured WhatsApp engines (WEBJS, NOWEB, GOWS)

### HTTP Transport Implementation

The HTTP transport implementation:
- Creates a new `StreamableHTTPServerTransport` instance per request to prevent request ID collisions
- Handles POST requests to the `/mcp` endpoint
- Supports stateless operation (no session management required)
- Returns JSON responses with proper error handling
- Automatically cleans up transport when the response closes

## Development

The MCP server code is located in `src/mcp/`:

- `waha-mcp.service.ts`: Main MCP server implementation with dual transport support
- `waha-mcp.controller.ts`: HTTP endpoint controller for MCP requests
- `waha-mcp.module.ts`: NestJS module definition

To add new tools:

1. Register the tool in `WahaMcpService.registerTools()`
2. Define input/output schemas using Zod
3. Implement the handler using existing WAHA services
4. Add error handling with try/catch

The same tools are available through both stdio and HTTP transports.

## Limitations

- Some advanced WAHA features (groups, status, channels) are not yet exposed as tools
- Session allowlist uses exact name matching (wildcards/patterns not supported)

## Future Enhancements

Planned improvements include:

1. ~~HTTP transport support for remote MCP clients~~ ✅ Implemented
2. ~~Authentication support for HTTP transport~~ ✅ Implemented
3. ~~Session access control and allowlist~~ ✅ Implemented
4. Additional tools for group management
5. Tools for status/stories management
6. Webhook integration with MCP notifications
7. Session lifecycle management tools (create, start, stop)
8. Message history and chat management resources
9. Wildcard/pattern support for session allowlist
