const SORRY_MESSAGE =
  "Sorry, something went wrong while processing the response. Please try again.";

export async function streamChatResponse({
  message,
  history,
  conversationId,
  createAssistantMessage,
  getWidgetPreamble,
  renderWidget,
  onDone
}) {
  const handlers = createAssistantMessage();
  const streamState = {
    suppressAssistantText: false,
    receivedAssistantText: false,
    injectedWidgetPreamble: false
  };

  const response = await fetch("/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      message,
      history,
      conversationId
    })
  });

  if (!response.ok) {
    handlers.appendText(SORRY_MESSAGE);
    return;
  }

  const reader = response.body?.getReader();
  if (!reader) {
    handlers.appendText(SORRY_MESSAGE);
    return;
  }

  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    buffer = await processFrames({
      buffer,
      handlers,
      streamState,
      getWidgetPreamble,
      renderWidget,
      onDone
    });
  }

  if (buffer.trim()) {
    await processFrame({
      frame: buffer,
      handlers,
      streamState,
      getWidgetPreamble,
      renderWidget,
      onDone
    });
  }
}

async function processFrames({
  buffer,
  handlers,
  streamState,
  getWidgetPreamble,
  renderWidget,
  onDone
}) {
  const frames = buffer.split("\n\n");
  const remainder = frames.pop() ?? "";

  for (const frame of frames) {
    await processFrame({
      frame,
      handlers,
      streamState,
      getWidgetPreamble,
      renderWidget,
      onDone
    });
  }

  return remainder;
}

async function processFrame({
  frame,
  handlers,
  streamState,
  getWidgetPreamble,
  renderWidget,
  onDone
}) {
  const event = parseSseEvent(frame);
  if (!event) return;

  switch (event.type) {
    case "text":
      if (streamState.suppressAssistantText) return;
      handlers.appendText(event.text);
      streamState.receivedAssistantText = true;
      return;

    case "tool_use":
      handlers.showToolBadge(event.name, true);
      return;

    case "tool_result":
      handlers.resolvePendingBadge(event.name, event.success);
      return;

    case "widget":
      if (
        !streamState.receivedAssistantText &&
        !streamState.injectedWidgetPreamble
      ) {
        const preamble = getWidgetPreamble?.(event.widgetType, event);
        if (preamble) {
          handlers.appendText(preamble);
          streamState.receivedAssistantText = true;
          streamState.injectedWidgetPreamble = true;
        }
      }
      renderWidget(event.widgetType, event.widgetId);
      streamState.suppressAssistantText = true;
      return;

    case "error":
      handlers.appendText(`\n\n_Error: ${event.message}_`);
      return;

    case "done":
      handlers.finish();
      await onDone?.(event);
      return;

    default:
      return;
  }
}

function parseSseEvent(frame) {
  const lines = frame
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(Boolean);

  const dataLines = lines
    .filter(line => line.startsWith("data:"))
    .map(line => line.slice(5).trimStart());

  if (dataLines.length === 0) return null;

  const payload = dataLines.join("\n");
  try {
    return JSON.parse(payload);
  } catch {
    return null;
  }
}
