# MCP Test Configuration

This file contains test credentials for validating WAHA MCP functionality.

## Test Credentials

```
Session: default
Chat ID: 120363403529636285@g.us
```

## Test Scenarios

### 1. Send Text Message
Test the `waha_send_text` tool to verify message ID serialization.

```json
{
  "session": "default",
  "chatId": "120363403529636285@g.us",
  "text": "Test message from WAHA MCP"
}
```

**Expected Result**: Should return a properly serialized message ID as a string (not an object).

### 2. Send Image
Test the `waha_send_image` tool.

```json
{
  "session": "default",
  "chatId": "120363403529636285@g.us",
  "fileUrl": "https://example.com/image.jpg",
  "caption": "Test image"
}
```

### 3. Check Number Status
Test the `waha_check_number` tool.

```json
{
  "session": "default",
  "phone": "1234567890"
}
```

### 4. Get Session Info
Test the `waha_get_session` tool.

```json
{
  "session": "default"
}
```

## Validation Checklist

After making changes to the MCP service, test the following:

- [ ] `waha_send_text` returns `id` as string
- [ ] `waha_send_image` returns `id` as string
- [ ] `waha_send_file` returns `id` as string
- [ ] `waha_check_number` returns `chatId` as string (if exists)
- [ ] `waha_get_contact` returns `id` as string
- [ ] `waha_get_session` returns `me.id` as string
- [ ] No MCP validation errors (error -32602)

## Notes

- These tests assume the WAHA instance is running with WEBJS engine
- The session must be authenticated and active
- The chat ID is a group chat for testing purposes
