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

## Using WAHA MCP with Claude Desktop

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
        "WHATSAPP_API_PORT": "3000"
      }
    }
  }
}
```

Replace `/path/to/waha-2025` with the actual path to your WAHA installation.

## Architecture

The MCP server is implemented as a NestJS module that:

1. Integrates with WAHA's existing `SessionManager`
2. Exposes WhatsApp operations as MCP tools with proper schemas
3. Provides session data through MCP resources
4. Uses stdio transport for local process communication

The implementation follows WAHA's existing patterns:
- Uses the same DTOs and validation
- Leverages existing session management
- Maintains consistent error handling
- Supports all configured WhatsApp engines (WEBJS, NOWEB, GOWS)

## Development

The MCP server code is located in `src/mcp/`:

- `waha-mcp.service.ts`: Main MCP server implementation
- `waha-mcp.module.ts`: NestJS module definition

To add new tools:

1. Register the tool in `WahaMcpService.registerTools()`
2. Define input/output schemas using Zod
3. Implement the handler using existing WAHA services
4. Add error handling with try/catch

## Limitations

- Currently supports stdio transport only (for local/desktop use)
- HTTP transport for remote MCP clients is planned for future releases
- Some advanced WAHA features (groups, status, channels) are not yet exposed as tools

## Future Enhancements

Planned improvements include:

1. HTTP transport support for remote MCP clients
2. Additional tools for group management
3. Tools for status/stories management
4. Webhook integration with MCP notifications
5. Session lifecycle management tools (create, start, stop)
6. Message history and chat management resources
