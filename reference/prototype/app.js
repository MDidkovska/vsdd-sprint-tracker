const STORAGE_KEY = "vsdd-sprint-tracker-prototype-v1";

const STREAMS = [
  {
    id: "MMM",
    teams: [
      { id: "mmm-a", name: "PTSB-VSDD MMM A" },
      { id: "mmm-b", name: "PTSB-VSDD MMM B" },
    ],
  },
  {
    id: "OAH",
    teams: [
      { id: "oah-ils", name: "PTSB-VSDD OAH ILS" },
      { id: "oah-sales", name: "PTSB-VSDD OAH Sales" },
    ],
  },
  {
    id: "GRMB",
    teams: [{ id: "grmb", name: "PTSB-VSDD GRMB" }],
  },
  {
    id: "O24",
    teams: [
      { id: "o24-app", name: "PTSB-VSDD O24 App Modernization" },
      { id: "o24-desktop", name: "PTSB-VSDD O24 Desktop Sunset" },
    ],
  },
  {
    id: "Visa",
    teams: [{ id: "visa", name: "VIS-PMNT" }],
  },
];

const ALL_TEAMS = STREAMS.flatMap((stream) =>
  stream.teams.map((team) => ({ ...team, stream: stream.id })),
);

const TEAM_VARIANTS = {
  "mmm-a": { rag: ["Green", "Amber", "Amber"], updateState: "Submitted", ask: true },
  "mmm-b": { rag: ["Green", "Green", "Amber"], updateState: "Draft", ask: false },
  "oah-ils": { rag: ["Green", "Amber", "Amber"], updateState: "Submitted", ask: true },
  "oah-sales": { rag: ["Green", "Amber", "Red"], updateState: "Draft", ask: false },
  grmb: { rag: ["Green", "Green", "Green"], updateState: "Submitted", ask: false },
  "o24-app": { rag: ["Green", "Amber", "Amber"], updateState: "Submitted", ask: true },
  "o24-desktop": { rag: ["Amber", "Amber", "Amber"], updateState: "Submitted", ask: false },
  visa: { rag: ["Green", "Green", "Green"], updateState: "Submitted", ask: false },
};

const DEFAULT_EXCEPTIONS = [
  {
    type: "RISK",
    impact: "Test data refresh may delay Week 2 execution and UAT entry.",
    owner: "James T.",
    dueDate: "2026-08-29",
    decision: "Confirm refreshed data by Thursday.",
  },
  {
    type: "ISSUE",
    impact: "Data masking failures are reducing regression throughput.",
    owner: "Laura C.",
    dueDate: "2026-08-28",
    decision: "Prioritise defect PAYC-1842.",
  },
  {
    type: "BLOCKER",
    impact: "Automation runners cannot access the stage environment; pipeline stopped.",
    owner: "DevOps",
    dueDate: "2026-08-27",
    decision: "Approve firewall rule today.",
  },
];

const form = document.querySelector("#team-update-form");
const teamView = document.querySelector("#team-view");
const leadershipView = document.querySelector("#leadership-view");
const streamSelect = document.querySelector("#stream-select");
const teamSelect = document.querySelector("#team-select");
const sprintSelect = document.querySelector("#sprint-select");
const weekSelect = document.querySelector("#week-select");
const exceptionEditorBody = document.querySelector("#exception-editor-body");
const hierarchyTree = document.querySelector("#hierarchy-tree");
const leadershipDetail = document.querySelector("#leadership-detail");
const toastRegion = document.querySelector("#toast-region");

const appState = {
  activeView: "team",
  selectedStream: "MMM",
  selectedTeamId: "mmm-a",
  sprint: "14",
  week: "1",
  collapsedStreams: new Set(),
  records: loadRecords(),
  saveTimer: null,
};

function makeRecord(team, sprint = "14", week = "1") {
  const variant = TEAM_VARIANTS[team.id] ?? {
    rag: ["Amber", "Amber", "Amber"],
    updateState: "Draft",
    ask: false,
  };
  const streamLabel = team.stream === "Visa" ? "Visa payments" : team.stream;
  const isPrimaryExample = team.id === "mmm-a";
  const suffix = week === "1" ? "Week 1" : "Week 2";

  return {
    teamId: team.id,
    stream: team.stream,
    teamName: team.name,
    sprint,
    week,
    updateState: week === "1" ? variant.updateState : "Draft",
    updatedAt: new Date().toISOString(),
    rag: {
      business: variant.rag[0],
      delivery: variant.rag[1],
      release: variant.rag[2],
    },
    businessGoal: isPrimaryExample
      ? "Enable the updated MMM customer journey for the September release."
      : `Enable the planned ${streamLabel} business capability for the target release.`,
    technicalGoal: isPrimaryExample
      ? "Validate the end-to-end journey and close critical regression gaps."
      : `Validate end-to-end ${streamLabel} journeys and close priority coverage gaps.`,
    sprintCommitment: isPrimaryExample
      ? "Execute 120 tests, validate priority fixes and raise release evidence."
      : `Complete committed ${streamLabel} testing and produce auditable release evidence.`,
    nextWeekCommitment: isPrimaryExample
      ? "Complete blocked tests, retest PAYC-1842 and confirm release readiness."
      : `Close remaining ${suffix} gaps, retest fixes and confirm the next readiness decision.`,
    metrics: {
      planned: isPrimaryExample ? 120 : 80 + team.id.length * 4,
      executed: isPrimaryExample ? 84 : 52 + team.id.length * 3,
      passed: isPrimaryExample ? 79 : 48 + team.id.length * 3,
      critical: variant.rag.includes("Red") ? 2 : variant.rag.includes("Amber") ? 1 : 0,
      blocked: variant.rag.includes("Red") ? 9 : variant.rag.includes("Amber") ? 5 : 1,
      automation: isPrimaryExample ? 18 : Math.min(55, 12 + team.id.length * 3),
    },
    achievements: isPrimaryExample
      ? "Test execution reached 70% of plan (84 / 120).\nPass rate is 94%.\nCritical issue fix is in progress.\nRemaining priority tests are planned for Week 2."
      : `${streamLabel} priority scenarios executed.\nBusiness review completed with minor comments.\nRegression evidence refreshed for ${suffix}.`,
    ai: {
      useCase: "AI-assisted test case generation",
      benefit: isPrimaryExample ? "27% reduction in test case design effort" : "Faster structured test design",
      validation: "Test lead review against requirements and business rules",
      next: "Extend to priority regression with human approval retained",
    },
    exceptions: isPrimaryExample
      ? structuredClone(DEFAULT_EXCEPTIONS)
      : variant.rag.includes("Red")
        ? [
            {
              type: "ISSUE",
              impact: `${streamLabel} defect is affecting the committed execution path.`,
              owner: "Delivery team",
              dueDate: "2026-08-29",
              decision: "Confirm fix priority and retest window.",
            },
          ]
        : variant.rag.includes("Amber")
          ? [
              {
                type: "RISK",
                impact: `${streamLabel} environment availability may compress the test window.`,
                owner: "Environment lead",
                dueDate: "2026-08-30",
                decision: "Confirm environment slot and recovery plan.",
              },
            ]
          : [],
    leadershipAsk: variant.ask
      ? isPrimaryExample
        ? "Approve stage access today and confirm the test-data refresh owner."
        : `Confirm the decision owner for the open ${streamLabel} dependency.`
      : "None",
  };
}

function defaultRecords() {
  const records = {};
  ALL_TEAMS.forEach((team) => {
    const record = makeRecord(team);
    records[recordKey(team.id, "14", "1")] = record;
  });
  return records;
}

function loadRecords() {
  try {
    const saved = window.localStorage.getItem(STORAGE_KEY);
    if (!saved) return defaultRecords();
    const parsed = JSON.parse(saved);
    return { ...defaultRecords(), ...parsed };
  } catch {
    return defaultRecords();
  }
}

function persistRecords() {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(appState.records));
  } catch {
    showToast("This browser could not save the draft locally.", "error");
  }
}

function recordKey(teamId, sprint, week) {
  return `${teamId}|${sprint}|${week}`;
}

function getSelectedTeam() {
  return ALL_TEAMS.find((team) => team.id === appState.selectedTeamId) ?? ALL_TEAMS[0];
}

function getRecord(teamId = appState.selectedTeamId, sprint = appState.sprint, week = appState.week) {
  const key = recordKey(teamId, sprint, week);
  if (!appState.records[key]) {
    const team = ALL_TEAMS.find((item) => item.id === teamId) ?? ALL_TEAMS[0];
    appState.records[key] = makeRecord(team, sprint, week);
  }
  return appState.records[key];
}

function escapeHtml(value = "") {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function escapeAttribute(value = "") {
  return escapeHtml(value).replaceAll("`", "&#096;");
}

function statusClass(status) {
  return `is-${String(status).toLowerCase()}`;
}

function formatDate(dateString) {
  if (!dateString) return "No date";
  const date = new Date(`${dateString}T00:00:00`);
  if (Number.isNaN(date.getTime())) return dateString;
  return new Intl.DateTimeFormat("en-GB", { day: "2-digit", month: "short" }).format(date);
}

function showToast(message, tone = "default") {
  const toast = document.createElement("div");
  toast.className = `toast ${tone === "default" ? "" : `is-${tone}`}`.trim();
  toast.textContent = message;
  toastRegion.append(toast);
  window.setTimeout(() => toast.remove(), 3600);
}

function populateContextSelectors() {
  streamSelect.innerHTML = STREAMS.map(
    (stream) => `<option value="${escapeAttribute(stream.id)}">${escapeHtml(stream.id)}</option>`,
  ).join("");
  streamSelect.value = appState.selectedStream;
  populateTeamSelect();

  const leadershipStreamFilter = document.querySelector("#leadership-stream-filter");
  leadershipStreamFilter.innerHTML = [
    '<option value="all">All streams</option>',
    ...STREAMS.map((stream) => `<option value="${escapeAttribute(stream.id)}">${escapeHtml(stream.id)}</option>`),
  ].join("");
}

function populateTeamSelect() {
  const stream = STREAMS.find((item) => item.id === appState.selectedStream) ?? STREAMS[0];
  teamSelect.innerHTML = stream.teams
    .map((team) => `<option value="${escapeAttribute(team.id)}">${escapeHtml(team.name)}</option>`)
    .join("");
  if (!stream.teams.some((team) => team.id === appState.selectedTeamId)) {
    appState.selectedTeamId = stream.teams[0].id;
  }
  teamSelect.value = appState.selectedTeamId;
}

function renderRagControls(record) {
  document.querySelectorAll("[data-rag-field]").forEach((field) => {
    const ragKey = field.dataset.ragField;
    const control = field.querySelector(".rag-control");
    control.innerHTML = ["Green", "Amber", "Red"]
      .map((status) => {
        const id = `rag-${ragKey}-${status.toLowerCase()}`;
        return `
          <span class="rag-option" data-status="${status}">
            <input id="${id}" type="radio" name="rag-${ragKey}" value="${status}" ${record.rag[ragKey] === status ? "checked" : ""} />
            <label for="${id}"><span class="rag-dot" aria-hidden="true"></span>${status}</label>
          </span>`;
      })
      .join("");
  });
}

function setFormValue(name, value) {
  const field = form.elements.namedItem(name);
  if (field) field.value = value ?? "";
}

function loadRecordIntoForm() {
  const record = getRecord();
  const team = getSelectedTeam();

  sprintSelect.value = appState.sprint;
  weekSelect.value = appState.week;
  document.querySelector("#team-breadcrumb").textContent = `${team.stream} / ${team.name} / Sprint ${appState.sprint}`;
  document.querySelector("#team-view h1").textContent = `Sprint ${appState.sprint} · Week ${appState.week} update`;

  renderRagControls(record);
  setFormValue("businessGoal", record.businessGoal);
  setFormValue("technicalGoal", record.technicalGoal);
  setFormValue("sprintCommitment", record.sprintCommitment);
  setFormValue("nextWeekCommitment", record.nextWeekCommitment);
  setFormValue("planned", record.metrics.planned);
  setFormValue("executed", record.metrics.executed);
  setFormValue("passed", record.metrics.passed);
  setFormValue("critical", record.metrics.critical);
  setFormValue("blocked", record.metrics.blocked);
  setFormValue("automation", record.metrics.automation);
  setFormValue("achievements", record.achievements);
  setFormValue("aiUseCase", record.ai.useCase);
  setFormValue("aiBenefit", record.ai.benefit);
  setFormValue("aiValidation", record.ai.validation);
  setFormValue("aiNext", record.ai.next);
  setFormValue("leadershipAsk", record.leadershipAsk);

  renderExceptionEditor(record);
  updateSaveState(record.updateState === "Submitted" ? "Submitted update" : "Draft saved locally");
  updateCompleteness();
}

function renderExceptionEditor(record) {
  if (!record.exceptions.length) {
    exceptionEditorBody.innerHTML = `
      <tr class="empty-exception-row">
        <td colspan="6">No open risks, issues or blockers. Add an item if an exception needs action.</td>
      </tr>`;
    return;
  }

  exceptionEditorBody.innerHTML = record.exceptions
    .map(
      (item, index) => `
        <tr data-exception-index="${index}">
          <td data-label="Type">
            <select class="exception-select" data-ex-field="type" aria-label="Exception type">
              ${["RISK", "ISSUE", "BLOCKER"].map((type) => `<option value="${type}" ${item.type === type ? "selected" : ""}>${type}</option>`).join("")}
            </select>
          </td>
          <td data-label="Business / release impact">
            <textarea class="exception-input is-textarea" data-ex-field="impact" rows="2" aria-label="Business or release impact">${escapeHtml(item.impact)}</textarea>
          </td>
          <td data-label="Owner"><input class="exception-input" data-ex-field="owner" type="text" value="${escapeAttribute(item.owner)}" aria-label="Owner" /></td>
          <td data-label="Due date"><input class="exception-input" data-ex-field="dueDate" type="date" value="${escapeAttribute(item.dueDate)}" aria-label="Due date" /></td>
          <td data-label="Decision / support needed">
            <textarea class="exception-input is-textarea" data-ex-field="decision" rows="2" aria-label="Decision or support needed">${escapeHtml(item.decision)}</textarea>
          </td>
          <td data-label="Actions"><button class="delete-row" type="button" data-delete-exception="${index}" aria-label="Delete ${escapeAttribute(item.type.toLowerCase())}">×</button></td>
        </tr>`,
    )
    .join("");
}

function readFormIntoRecord({ markDraft = true } = {}) {
  const record = getRecord();
  const data = new FormData(form);

  record.rag.business = data.get("rag-business") || record.rag.business;
  record.rag.delivery = data.get("rag-delivery") || record.rag.delivery;
  record.rag.release = data.get("rag-release") || record.rag.release;
  record.businessGoal = String(data.get("businessGoal") || "").trim();
  record.technicalGoal = String(data.get("technicalGoal") || "").trim();
  record.sprintCommitment = String(data.get("sprintCommitment") || "").trim();
  record.nextWeekCommitment = String(data.get("nextWeekCommitment") || "").trim();
  record.metrics = {
    planned: numberValue(data.get("planned")),
    executed: numberValue(data.get("executed")),
    passed: numberValue(data.get("passed")),
    critical: numberValue(data.get("critical")),
    blocked: numberValue(data.get("blocked")),
    automation: numberValue(data.get("automation")),
  };
  record.achievements = String(data.get("achievements") || "").trim();
  record.ai = {
    useCase: String(data.get("aiUseCase") || "").trim(),
    benefit: String(data.get("aiBenefit") || "").trim(),
    validation: String(data.get("aiValidation") || "").trim(),
    next: String(data.get("aiNext") || "").trim(),
  };
  record.leadershipAsk = String(data.get("leadershipAsk") || "").trim() || "None";
  if (markDraft && record.updateState === "Submitted") record.updateState = "Draft";
  record.updatedAt = new Date().toISOString();
  return record;
}

function numberValue(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
}

function updateSaveState(message) {
  document.querySelectorAll("#top-save-state, #bottom-save-state").forEach((element) => {
    element.lastChild.textContent = message;
  });
}

function scheduleAutoSave() {
  window.clearTimeout(appState.saveTimer);
  updateSaveState("Saving draft…");
  appState.saveTimer = window.setTimeout(() => {
    readFormIntoRecord();
    persistRecords();
    updateSaveState("Draft saved just now");
    updateCompleteness();
  }, 700);
}

function updateCompleteness() {
  const record = readFormIntoRecord({ markDraft: false });
  const complete = {
    goals: [record.businessGoal, record.technicalGoal, record.sprintCommitment, record.nextWeekCommitment].every(Boolean),
    evidence: Object.values(record.metrics).every((value) => Number.isFinite(value)),
    ai: Object.values(record.ai).every(Boolean),
    exceptions:
      record.exceptions.length === 0 ||
      record.exceptions.every((item) => item.type && item.impact && item.owner && item.dueDate && item.decision),
  };

  let count = 0;
  document.querySelectorAll("[data-complete-key]").forEach((item) => {
    const isComplete = complete[item.dataset.completeKey];
    item.classList.toggle("is-complete", isComplete);
    if (isComplete) count += 1;
  });
  document.querySelector("#completion-count").textContent = `${count}/4`;
  return complete;
}

function validateForSubmission() {
  let valid = true;
  ["businessGoal", "technicalGoal", "sprintCommitment", "nextWeekCommitment"].forEach((name) => {
    const field = form.elements.namedItem(name);
    const empty = !String(field.value).trim();
    field.classList.toggle("is-invalid", empty);
    field.setAttribute("aria-invalid", String(empty));
    if (empty) valid = false;
  });

  const record = readFormIntoRecord({ markDraft: false });
  const invalidException = record.exceptions.find(
    (item) => !item.type || !item.impact || !item.owner || !item.dueDate || !item.decision,
  );
  if (invalidException) valid = false;

  if (!valid) {
    const firstInvalid = form.querySelector(".is-invalid");
    firstInvalid?.focus();
    showToast("Complete the required goals and every exception field before submitting.", "error");
  }
  return valid;
}

function renderLeadership() {
  const streamFilter = document.querySelector("#leadership-stream-filter").value || "all";
  const statusFilter = document.querySelector("#leadership-status-filter").value;
  const stateFilter = document.querySelector("#leadership-state-filter").value;

  const visibleTeams = ALL_TEAMS.filter((team) => {
    const record = getRecord(team.id, appState.sprint, appState.week);
    const matchesStream = streamFilter === "all" || team.stream === streamFilter;
    const matchesStatus = statusFilter === "all" || Object.values(record.rag).includes(statusFilter);
    const matchesState = stateFilter === "all" || record.updateState === stateFilter;
    return matchesStream && matchesStatus && matchesState;
  });

  if (!visibleTeams.some((team) => team.id === appState.selectedTeamId) && visibleTeams.length) {
    appState.selectedTeamId = visibleTeams[0].id;
    appState.selectedStream = visibleTeams[0].stream;
  }

  renderProgrammeSummary(visibleTeams);
  renderHierarchy(visibleTeams);
  renderLeadershipDetail(visibleTeams);
  document.querySelector("#leadership-page-title").textContent = `Sprint ${appState.sprint} · Week ${appState.week}`;
}

function renderProgrammeSummary(teams) {
  const records = teams.map((team) => getRecord(team.id, appState.sprint, appState.week));
  const submitted = records.filter((record) => record.updateState === "Submitted").length;
  const drafts = records.filter((record) => record.updateState === "Draft").length;
  const asks = records.filter((record) => record.leadershipAsk && record.leadershipAsk.toLowerCase() !== "none").length;
  document.querySelector("#summary-teams").textContent = String(teams.length);
  document.querySelector("#summary-submitted").textContent = String(submitted);
  document.querySelector("#summary-drafts").textContent = String(drafts);
  document.querySelector("#summary-asks").textContent = String(asks);
}

function renderHierarchy(visibleTeams) {
  const visibleIds = new Set(visibleTeams.map((team) => team.id));
  const streams = STREAMS.map((stream) => ({
    ...stream,
    teams: stream.teams.filter((team) => visibleIds.has(team.id)),
  })).filter((stream) => stream.teams.length);

  if (!streams.length) {
    hierarchyTree.innerHTML = '<div class="empty-detail"><div><h2>No matching teams</h2><p>Change the filters to restore the programme hierarchy.</p></div></div>';
    return;
  }

  hierarchyTree.innerHTML = streams
    .map((stream) => {
      const collapsed = appState.collapsedStreams.has(stream.id);
      const teamsMarkup = stream.teams
        .map((team) => {
          const record = getRecord(team.id, appState.sprint, appState.week);
          const selected = team.id === appState.selectedTeamId;
          return `
            <div class="team-node">
              <button type="button" class="team-row ${selected ? "is-selected" : ""}" data-team-id="${escapeAttribute(team.id)}" aria-pressed="${selected}" title="${escapeAttribute(team.name)}">
                <span class="team-name">${escapeHtml(team.name)}</span>
                <span class="status-dot ${statusClass(record.rag.business)}" title="Business: ${record.rag.business}" aria-label="Business ${record.rag.business}"></span>
                <span class="status-dot ${statusClass(record.rag.delivery)}" title="Test: ${record.rag.delivery}" aria-label="Test ${record.rag.delivery}"></span>
                <span class="status-dot ${statusClass(record.rag.release)}" title="Release: ${record.rag.release}" aria-label="Release ${record.rag.release}"></span>
                <span class="update-state ${record.updateState === "Missing" ? "is-missing" : ""}">${escapeHtml(record.updateState)}</span>
              </button>
              ${selected ? renderTimeline() : ""}
            </div>`;
        })
        .join("");

      return `
        <section class="stream-node ${collapsed ? "is-collapsed" : ""}" data-stream-node="${escapeAttribute(stream.id)}">
          <button type="button" class="stream-row" data-stream-toggle="${escapeAttribute(stream.id)}" aria-expanded="${!collapsed}">
            <span class="chevron" aria-hidden="true">⌄</span>
            <span>${escapeHtml(stream.id)}</span>
            <span class="update-state">${stream.teams.length} ${stream.teams.length === 1 ? "team" : "teams"}</span>
          </button>
          <div class="team-list">${teamsMarkup}</div>
        </section>`;
    })
    .join("");
}

function renderTimeline() {
  return `
    <div class="team-timeline" aria-label="Sprint and week hierarchy">
      <div class="timeline-row sprint-row"><span class="timeline-marker" aria-hidden="true"></span><span>Sprint ${appState.sprint}</span><span></span></div>
      <button type="button" class="timeline-row ${appState.week === "1" ? "is-current" : ""}" data-week="1">
        <span class="timeline-marker" aria-hidden="true"></span><span>Week 1</span><span class="timeline-state">${appState.week === "1" ? "Current" : "View"}</span>
      </button>
      <button type="button" class="timeline-row ${appState.week === "2" ? "is-current" : ""}" data-week="2">
        <span class="timeline-marker" aria-hidden="true"></span><span>Week 2</span><span class="timeline-state">${appState.week === "2" ? "Current" : "Upcoming"}</span>
      </button>
    </div>`;
}

function renderLeadershipDetail(visibleTeams) {
  if (!visibleTeams.length) {
    leadershipDetail.innerHTML = '<div class="empty-detail"><div><h2>No team update selected</h2><p>No records match the current filters. Clear a filter to view the latest submitted evidence.</p></div></div>';
    return;
  }

  const team = getSelectedTeam();
  const record = getRecord();
  const achievementItems = lines(record.achievements);
  const aiItems = [
    `Use case — ${record.ai.useCase || "Not reported"}`,
    `Measurable benefit — ${record.ai.benefit || "Not reported"}`,
    `Human validation — ${record.ai.validation || "Not reported"}`,
    `Next / constraint — ${record.ai.next || "Not reported"}`,
  ];

  leadershipDetail.innerHTML = `
    <p class="detail-breadcrumb">${escapeHtml(team.stream)} / ${escapeHtml(team.name)} / Sprint ${escapeHtml(appState.sprint)} / Week ${escapeHtml(appState.week)}</p>
    <div class="detail-title-row">
      <h2>${escapeHtml(team.name)}</h2>
      <span class="submission-chip">${escapeHtml(record.updateState)} · ${escapeHtml(relativeUpdate(record.updatedAt))}</span>
    </div>
    <div class="detail-rag-grid" aria-label="Current team status">
      ${renderDetailRag("Business outcome", record.rag.business)}
      ${renderDetailRag("Test delivery", record.rag.delivery)}
      ${renderDetailRag("Release confidence", record.rag.release)}
    </div>

    <section class="detail-section" aria-labelledby="detail-goals-title">
      <h3 id="detail-goals-title">Goals &amp; commitments</h3>
      <div class="detail-goals">
        ${renderGoal("Business goal", record.businessGoal)}
        ${renderGoal("Technical / testing goal", record.technicalGoal)}
        ${renderGoal("Sprint commitment", record.sprintCommitment)}
        ${renderGoal("Next week commitment", record.nextWeekCommitment)}
      </div>
    </section>

    <section class="detail-section" aria-labelledby="quality-read-title">
      <h3 id="quality-read-title">Quality evidence</h3>
      <div class="quality-read">
        ${renderMetric("Planned", record.metrics.planned)}
        ${renderMetric("Executed", record.metrics.executed)}
        ${renderMetric("Passed", record.metrics.passed, "is-positive")}
        ${renderMetric("Open critical", record.metrics.critical, record.metrics.critical ? "is-alert" : "")}
        ${renderMetric("Blocked", record.metrics.blocked, record.metrics.blocked ? "is-alert" : "")}
        ${renderMetric("Automation", `${record.metrics.automation}%`, "is-info")}
      </div>
    </section>

    <div class="detail-split">
      <section class="split-detail" aria-labelledby="week-trajectory-title">
        <h3 id="week-trajectory-title">Week trajectory</h3>
        ${renderList(achievementItems.length ? achievementItems : ["No weekly achievements reported."])}
      </section>
      <section class="split-detail" aria-labelledby="ai-value-title">
        <h3 id="ai-value-title">AI value</h3>
        ${renderList(aiItems)}
      </section>
    </div>

    <section class="detail-section" aria-labelledby="detail-exceptions-title">
      <h3 id="detail-exceptions-title">Risks · Issues · Blockers</h3>
      ${renderExceptionReadTable(record.exceptions)}
    </section>

    <section class="leadership-ask-read" aria-labelledby="leadership-ask-read-title">
      <h3 id="leadership-ask-read-title">Leadership ask</h3>
      <p>${escapeHtml(record.leadershipAsk || "None")}</p>
    </section>`;
}

function renderDetailRag(label, status) {
  return `
    <div class="detail-rag-item">
      <span class="detail-rag-label">${escapeHtml(label)}</span>
      <span class="detail-rag-value ${statusClass(status)}"><span class="status-dot ${statusClass(status)}" aria-hidden="true"></span>${escapeHtml(status)}</span>
    </div>`;
}

function renderGoal(label, value) {
  return `<div class="goal-read"><span class="goal-label">${escapeHtml(label)}</span><p>${escapeHtml(value || "Not reported")}</p></div>`;
}

function renderMetric(label, value, tone = "") {
  return `<div><span>${escapeHtml(label)}</span><strong class="${tone}">${escapeHtml(value)}</strong></div>`;
}

function renderList(items) {
  return `<ul>${items.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>`;
}

function lines(value) {
  return String(value || "")
    .split("\n")
    .map((item) => item.trim())
    .filter(Boolean);
}

function renderExceptionReadTable(exceptions) {
  if (!exceptions.length) {
    return '<div class="inline-empty-state"><strong>No open exceptions</strong><p>The team reported no current risks, issues or blockers for this update.</p></div>';
  }

  return `
    <div class="table-wrap">
      <table class="exception-table" aria-label="Reported risks, issues and blockers">
        <thead><tr><th>Type</th><th>Business / release impact</th><th>Owner</th><th>Due date</th><th>Decision / support needed</th></tr></thead>
        <tbody>
          ${exceptions
            .map(
              (item) => `<tr>
                <td data-label="Type"><span class="exception-type ${item.type.toLowerCase()}">${escapeHtml(item.type)}</span></td>
                <td data-label="Business / release impact">${escapeHtml(item.impact)}</td>
                <td data-label="Owner">${escapeHtml(item.owner)}</td>
                <td data-label="Due date">${escapeHtml(formatDate(item.dueDate))}</td>
                <td data-label="Decision / support needed">${escapeHtml(item.decision)}</td>
              </tr>`,
            )
            .join("")}
        </tbody>
      </table>
    </div>`;
}

function relativeUpdate(iso) {
  if (!iso) return "No timestamp";
  const difference = Math.max(0, Date.now() - new Date(iso).getTime());
  const minutes = Math.floor(difference / 60000);
  if (minutes < 1) return "updated just now";
  if (minutes < 60) return `updated ${minutes} min ago`;
  return `updated ${Math.floor(minutes / 60)} h ago`;
}

function switchView(view) {
  appState.activeView = view;
  document.querySelectorAll(".view-tab").forEach((tab) => {
    const active = tab.dataset.view === view;
    tab.classList.toggle("is-active", active);
    tab.setAttribute("aria-selected", String(active));
    tab.tabIndex = active ? 0 : -1;
  });
  teamView.hidden = view !== "team";
  leadershipView.hidden = view !== "leadership";
  if (view === "leadership") renderLeadership();
  if (view === "team") {
    const team = getSelectedTeam();
    appState.selectedStream = team.stream;
    streamSelect.value = appState.selectedStream;
    populateTeamSelect();
    loadRecordIntoForm();
  }
  document.querySelector(`#${view}-view h1`)?.focus?.({ preventScroll: true });
}

function syncSelectedContext({ stream, teamId, sprint, week }) {
  if (stream) appState.selectedStream = stream;
  if (teamId) appState.selectedTeamId = teamId;
  if (sprint) appState.sprint = sprint;
  if (week) appState.week = week;
  populateTeamSelect();
  streamSelect.value = appState.selectedStream;
  teamSelect.value = appState.selectedTeamId;
  sprintSelect.value = appState.sprint;
  weekSelect.value = appState.week;
}

document.querySelectorAll(".view-tab").forEach((tab) => {
  tab.addEventListener("click", () => switchView(tab.dataset.view));
  tab.addEventListener("keydown", (event) => {
    if (!["ArrowLeft", "ArrowRight"].includes(event.key)) return;
    event.preventDefault();
    const nextView = tab.dataset.view === "team" ? "leadership" : "team";
    const nextTab = document.querySelector(`[data-view="${nextView}"]`);
    nextTab.focus();
    switchView(nextView);
  });
});

streamSelect.addEventListener("change", () => {
  appState.selectedStream = streamSelect.value;
  const stream = STREAMS.find((item) => item.id === appState.selectedStream);
  appState.selectedTeamId = stream.teams[0].id;
  populateTeamSelect();
  loadRecordIntoForm();
});

teamSelect.addEventListener("change", () => {
  appState.selectedTeamId = teamSelect.value;
  loadRecordIntoForm();
});

sprintSelect.addEventListener("change", () => {
  appState.sprint = sprintSelect.value;
  loadRecordIntoForm();
});

weekSelect.addEventListener("change", () => {
  appState.week = weekSelect.value;
  loadRecordIntoForm();
});

form.addEventListener("input", (event) => {
  if (event.target.matches("[required]")) {
    event.target.classList.remove("is-invalid");
    event.target.removeAttribute("aria-invalid");
  }
  scheduleAutoSave();
});

form.addEventListener("change", scheduleAutoSave);

document.querySelector("#add-exception").addEventListener("click", () => {
  const record = readFormIntoRecord();
  record.exceptions.push({ type: "RISK", impact: "", owner: "", dueDate: "", decision: "" });
  renderExceptionEditor(record);
  updateCompleteness();
  const lastRow = exceptionEditorBody.querySelector("tr:last-child select");
  lastRow?.focus();
});

exceptionEditorBody.addEventListener("input", (event) => {
  const row = event.target.closest("[data-exception-index]");
  if (!row || !event.target.dataset.exField) return;
  const index = Number(row.dataset.exceptionIndex);
  const record = getRecord();
  record.exceptions[index][event.target.dataset.exField] = event.target.value;
  scheduleAutoSave();
});

exceptionEditorBody.addEventListener("change", (event) => {
  const row = event.target.closest("[data-exception-index]");
  if (!row || !event.target.dataset.exField) return;
  const index = Number(row.dataset.exceptionIndex);
  const record = getRecord();
  record.exceptions[index][event.target.dataset.exField] = event.target.value;
  scheduleAutoSave();
});

exceptionEditorBody.addEventListener("click", (event) => {
  const button = event.target.closest("[data-delete-exception]");
  if (!button) return;
  const record = readFormIntoRecord();
  const index = Number(button.dataset.deleteException);
  const [removed] = record.exceptions.splice(index, 1);
  renderExceptionEditor(record);
  persistRecords();
  updateCompleteness();
  showToast(`${removed?.type || "Item"} removed from this draft.`);
});

document.querySelector("#save-draft").addEventListener("click", () => {
  const record = readFormIntoRecord();
  record.updateState = "Draft";
  persistRecords();
  updateSaveState("Draft saved just now");
  showToast("Draft saved for this team and week.", "success");
});

form.addEventListener("submit", (event) => {
  event.preventDefault();
  if (!validateForSubmission()) return;
  const record = readFormIntoRecord({ markDraft: false });
  record.updateState = "Submitted";
  record.updatedAt = new Date().toISOString();
  persistRecords();
  updateSaveState("Submitted just now");
  showToast("Update submitted. Leadership View now uses this version.", "success");
});

hierarchyTree.addEventListener("click", (event) => {
  const streamButton = event.target.closest("[data-stream-toggle]");
  if (streamButton) {
    const streamId = streamButton.dataset.streamToggle;
    if (appState.collapsedStreams.has(streamId)) appState.collapsedStreams.delete(streamId);
    else appState.collapsedStreams.add(streamId);
    renderLeadership();
    return;
  }

  const teamButton = event.target.closest("[data-team-id]");
  if (teamButton) {
    const team = ALL_TEAMS.find((item) => item.id === teamButton.dataset.teamId);
    syncSelectedContext({ stream: team.stream, teamId: team.id });
    renderLeadership();
    return;
  }

  const weekButton = event.target.closest("[data-week]");
  if (weekButton) {
    appState.week = weekButton.dataset.week;
    weekSelect.value = appState.week;
    renderLeadership();
  }
});

["#leadership-stream-filter", "#leadership-status-filter", "#leadership-state-filter"].forEach((selector) => {
  document.querySelector(selector).addEventListener("change", renderLeadership);
});

document.querySelector("#export-snapshot").addEventListener("click", () => {
  const snapshot = {
    programme: "VSDD",
    sprint: appState.sprint,
    week: appState.week,
    exportedAt: new Date().toISOString(),
    records: ALL_TEAMS.map((team) => getRecord(team.id, appState.sprint, appState.week)),
  };
  const blob = new Blob([JSON.stringify(snapshot, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `VSDD-Sprint-${appState.sprint}-Week-${appState.week}.json`;
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
  showToast("Leadership snapshot exported as JSON.", "success");
});

populateContextSelectors();
syncSelectedContext({
  stream: appState.selectedStream,
  teamId: appState.selectedTeamId,
  sprint: appState.sprint,
  week: appState.week,
});
loadRecordIntoForm();
