const PROPOSED_WTE_OPTIONS = [
  { value: "", label: "Select…" },
  { value: "0.5", label: "50% — half time" },
  { value: "0.6", label: "60%" },
  { value: "0.7", label: "70%" },
  { value: "0.8", label: "80%" }
];

export function renderLtftFormWidget({
  widgetId,
  chat,
  input,
  scrollToBottom,
  streamResponse,
  setUI,
  iconCheck
}) {
  if (typeof widgetId !== "string" || widgetId.trim() === "") return;

  const safeId = widgetId.replaceAll(/[^a-zA-Z0-9-]/g, "");
  const card = document.createElement("div");
  card.className = "widget-card";
  card.dataset.widgetId = safeId;

  const header = document.createElement("div");
  header.className = "widget-header";

  const titleRow = document.createElement("div");
  titleRow.className = "widget-title";
  titleRow.innerHTML =
    '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>';
  titleRow.appendChild(document.createTextNode(" LTFT CCT Calculator"));

  const subtitle = document.createElement("p");
  subtitle.className = "widget-subtitle";
  subtitle.textContent =
    "Fill in your training details and I'll calculate your new CCT date.";

  header.appendChild(titleRow);
  header.appendChild(subtitle);
  card.appendChild(header);

  const form = document.createElement("form");
  form.className = "widget-form";
  form.id = `ltft-form-${safeId}`;
  form.noValidate = false;

  form.appendChild(
    makeWidgetField({
      id: `prog-${safeId}`,
      label: "Programme name",
      optional: true,
      child: makeInput(
        "text",
        `prog-${safeId}`,
        "programme_name",
        "e.g. Core Medical Training",
        false
      )
    })
  );

  form.appendChild(
    makeWidgetField({
      id: `cct-${safeId}`,
      label: "Current CCT date",
      child: makeInput("date", `cct-${safeId}`, "current_cct_date", "", true)
    })
  );

  form.appendChild(
    makeWidgetField({
      id: `prop-wte-${safeId}`,
      label: "Proposed working percentage",
      child: makeWteSelect(
        `prop-wte-${safeId}`,
        "proposed_work_percentage",
        PROPOSED_WTE_OPTIONS,
        ""
      )
    })
  );

  form.appendChild(
    makeWidgetField({
      id: `start-${safeId}`,
      label: "Proposed start date",
      child: makeInput(
        "date",
        `start-${safeId}`,
        "proposed_start_date",
        "",
        true
      )
    })
  );

  const submitBtn = document.createElement("button");
  submitBtn.type = "submit";
  submitBtn.className = "widget-submit-btn";
  submitBtn.textContent = "Calculate new CCT date →";
  form.appendChild(submitBtn);

  card.appendChild(form);
  chat.appendChild(card);

  form.addEventListener("submit", async event => {
    event.preventDefault();

    const payload = buildPayload(new FormData(form));
    if (
      Number.isNaN(payload.proposed_work_percentage) ||
      payload.proposed_work_percentage === 0
    ) {
      showWidgetError(
        form,
        submitBtn,
        "Please select a proposed working percentage."
      );
      return;
    }

    submitBtn.disabled = true;
    submitBtn.textContent = "Submitting…";
    clearWidgetError(form);

    card.innerHTML = "";
    const confirmation = document.createElement("div");
    confirmation.className = "widget-submitted";
    confirmation.innerHTML =
      iconCheck() +
      "<span>Details submitted — calculating your new CCT date…</span>";
    card.appendChild(confirmation);
    scrollToBottom();

    setUI(true);
    try {
      await streamResponse(JSON.stringify(payload));
    } catch (err) {
      console.error("Widget submit error:", err);
    } finally {
      setUI(false);
      input.focus();
    }
  });

  scrollToBottom();
}

function buildPayload(formData) {
  const programmeName = getFormValueAsString(formData, "programme_name").trim();
  return {
    ...(programmeName ? { programme_name: programmeName } : {}),
    current_cct_date: getFormValueAsString(formData, "current_cct_date"),
    proposed_work_percentage: Number.parseFloat(
      getFormValueAsString(formData, "proposed_work_percentage")
    ),
    proposed_start_date: getFormValueAsString(formData, "proposed_start_date")
  };
}

function getFormValueAsString(formData, key) {
  const value = formData.get(key);
  return typeof value === "string" ? value : "";
}

function makeWidgetField({ id, label, optional = false, child }) {
  const wrap = document.createElement("div");
  wrap.className = "widget-field";

  const labelEl = document.createElement("label");
  labelEl.htmlFor = id;
  labelEl.textContent = label;

  if (optional) {
    const optionalEl = document.createElement("span");
    optionalEl.className = "widget-optional";
    optionalEl.textContent = " (optional)";
    labelEl.appendChild(optionalEl);
  }

  wrap.appendChild(labelEl);
  wrap.appendChild(child);
  return wrap;
}

function makeInput(type, id, name, placeholder, required) {
  const input = document.createElement("input");
  input.type = type;
  input.id = id;
  input.name = name;
  input.placeholder = placeholder;
  input.required = required;
  return input;
}

function makeWteSelect(id, name, options, defaultValue) {
  const select = document.createElement("select");
  select.id = id;
  select.name = name;
  select.required = true;

  for (const option of options) {
    const optionEl = document.createElement("option");
    optionEl.value = option.value;
    optionEl.textContent = option.label;
    if (option.value === defaultValue) optionEl.selected = true;
    select.appendChild(optionEl);
  }

  return select;
}

function showWidgetError(form, beforeEl, message) {
  clearWidgetError(form);
  const err = document.createElement("p");
  err.className = "widget-error";
  err.textContent = message;
  beforeEl.before(err);
}

function clearWidgetError(form) {
  form.querySelector(".widget-error")?.remove();
}
