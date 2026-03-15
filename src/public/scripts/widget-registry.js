import { renderLtftFormWidget } from "./ltft-widget.js";

export function createWidgetRegistry({
  chat,
  input,
  scrollToBottom,
  streamResponse,
  setUI,
  iconCheck
}) {
  return {
    ltft_form: {
      preamble:
        "OK, I will give you a form to complete so I can calculate your new CCT date.",
      render(widgetId) {
        renderLtftFormWidget({
          widgetId,
          chat,
          input,
          scrollToBottom,
          streamResponse,
          setUI,
          iconCheck
        });
      }
    }
  };
}
