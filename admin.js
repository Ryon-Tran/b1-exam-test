const state = {
  rows: [],
  filteredRows: [],
  filters: { exams: [], skills: [], parts: [] },
  editableHeaders: [],
  selectedRowId: "",
};

const els = {
  examFilter: document.querySelector("#examFilter"),
  skillFilter: document.querySelector("#skillFilter"),
  partFilter: document.querySelector("#partFilter"),
  searchInput: document.querySelector("#searchInput"),
  rowTable: document.querySelector("#rowTable"),
  editorPanel: document.querySelector("#editorPanel"),
  statusBox: document.querySelector("#statusBox"),
  reloadButton: document.querySelector("#reloadButton"),
  openExcelButton: document.querySelector("#openExcelButton"),
};

const fieldGroups = [
  ["cau_hoi", "tieu_de", "noi_dung_bai_doc"],
  ["lua_chon_A", "lua_chon_B", "lua_chon_C", "lua_chon_D"],
  ["lua_chon_E", "lua_chon_F", "lua_chon_G", "lua_chon_H"],
  ["dap_an_dung", "dap_an_chap_nhan", "giai_thich", "ghi_chu"],
  ["anh_neu_co", "audio", "dong_goc"],
  ["ten_part", "dang_cau_hoi", "loai_dap_an"],
];

const fieldLabels = {
  giai_thich: "giai_thich (ngắn, trọng tâm)",
  ghi_chu: "ghi_chu (phân tích thêm cho review)",
};

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function setStatus(message, type = "") {
  els.statusBox.textContent = message;
  els.statusBox.className = `admin-status ${type}`.trim();
}

async function readApiJson(response) {
  const text = await response.text();
  try {
    return JSON.parse(text);
  } catch {
    const looksLikeHtml = text.trim().startsWith("<");
    if (looksLikeHtml) {
      throw new Error(
        "API đang trả về HTML thay vì JSON. Hãy đóng cửa sổ data-manager cũ, chạy lại "
        + "D:\\ENGLISH\\exam-app-excel-live\\data-manager.bat rồi mở "
        + "http://127.0.0.1:8788/admin.html"
      );
    }
    throw new Error(`API trả dữ liệu không hợp lệ: ${text.slice(0, 180)}`);
  }
}

async function loadRows() {
  setStatus("Đang tải dữ liệu từ Excel...");
  const response = await fetch(`/api/admin/excel-rows?ts=${Date.now()}`, {
    cache: "no-store",
    headers: { "Accept": "application/json" },
  });
  const payload = await readApiJson(response);
  if (!response.ok || !payload.ok) {
    throw new Error(payload.error || "Không đọc được Excel.");
  }

  state.rows = payload.rows || [];
  state.filters = payload.filters || { exams: [], skills: [], parts: [] };
  state.editableHeaders = payload.editableHeaders || [];
  populateFilters();
  applyFilters();
  setStatus(`Đã tải ${state.rows.length} dòng từ Excel.`, "good");
}

function populateFilters() {
  fillSelect(els.examFilter, state.filters.exams, "Tất cả đề");
  fillSelect(els.skillFilter, state.filters.skills, "Tất cả kỹ năng");
  fillSelect(els.partFilter, state.filters.parts, "Tất cả part");
}

function fillSelect(select, values, firstLabel) {
  const current = select.value;
  select.innerHTML = `<option value="">${escapeHtml(firstLabel)}</option>`;
  values.forEach((value) => {
    const option = document.createElement("option");
    option.value = value;
    option.textContent = value;
    select.append(option);
  });
  if ([...select.options].some((option) => option.value === current)) {
    select.value = current;
  }
}

function applyFilters() {
  const exam = els.examFilter.value;
  const skill = els.skillFilter.value;
  const part = els.partFilter.value;
  const search = els.searchInput.value.trim().toLowerCase();

  state.filteredRows = state.rows.filter((row) => {
    if (exam && row.ma_de !== exam) return false;
    if (skill && row.ky_nang !== skill) return false;
    if (part && row.part !== part) return false;
    if (!search) return true;
    return [
      row.cau_hoi,
      row.tieu_de,
      row.noi_dung_bai_doc,
      row.dap_an_dung,
      row.giai_thich,
      row.dong_goc,
    ].some((value) => String(value || "").toLowerCase().includes(search));
  });

  renderTable();
}

function renderTable() {
  els.rowTable.innerHTML = "";
  const fragment = document.createDocumentFragment();

  state.filteredRows.forEach((row) => {
    const tr = document.createElement("tr");
    tr.classList.toggle("selected", row.rowId === state.selectedRowId);
    tr.innerHTML = `
      <td>${escapeHtml(row.ma_de)}</td>
      <td>${escapeHtml(row.ky_nang)}</td>
      <td>${escapeHtml(row.part)}</td>
      <td>${escapeHtml(row.so_cau)}</td>
      <td><div class="row-question">${escapeHtml(row.cau_hoi || row.tieu_de || row.dong_goc || "(trống)")}</div></td>
      <td><span class="row-answer">${escapeHtml(row.dap_an_dung || "-")}</span></td>
      <td><button class="secondary edit-mini-button" type="button">Sửa</button></td>
    `;
    tr.addEventListener("click", () => selectRow(row.rowId));
    fragment.append(tr);
  });

  els.rowTable.append(fragment);
  setStatus(`Đang hiển thị ${state.filteredRows.length}/${state.rows.length} dòng.`, "good");
}

function selectRow(rowId) {
  state.selectedRowId = rowId;
  const row = state.rows.find((item) => item.rowId === rowId);
  if (!row) return;
  renderEditor(row);
  renderTable();
}

function renderEditor(row) {
  const editable = new Set(state.editableHeaders);
  const fields = fieldGroups.flat().filter((field) => editable.has(field));
  const meta = `${row.ma_de} | ${row.ky_nang} | Part ${row.part} | Câu ${row.so_cau}`;

  els.editorPanel.innerHTML = `
    <form class="editor-form" id="editorForm">
      <h2>Sửa dòng ${escapeHtml(row.rowId)}</h2>
      <p class="editor-meta">${escapeHtml(meta)}</p>
      <div class="editor-grid">
        ${fields.map((field) => renderField(field, row[field] || "")).join("")}
      </div>
      <div class="editor-actions">
        <button type="submit">Lưu vào Excel</button>
        <button type="button" class="secondary" id="cancelEditButton">Bỏ chọn</button>
      </div>
    </form>
  `;

  document.querySelector("#editorForm").addEventListener("submit", (event) => {
    saveCurrentRow(event, row).catch((error) => setStatus(error.message, "bad"));
  });
  document.querySelector("#cancelEditButton").addEventListener("click", () => {
    state.selectedRowId = "";
    els.editorPanel.innerHTML = `
      <div class="editor-empty">
        <h2>Chọn một dòng để sửa</h2>
        <p>Bạn có thể sửa câu hỏi, lựa chọn, đáp án và giải thích trực tiếp trên Excel.</p>
      </div>
    `;
    renderTable();
  });
}

function renderField(field, value) {
  const isLarge = ["noi_dung_bai_doc", "giai_thich", "ghi_chu", "dong_goc"].includes(field);
  const isTextArea = isLarge || String(value).length > 90 || String(value).includes("\n");
  const control = isTextArea
    ? `<textarea name="${escapeHtml(field)}">${escapeHtml(value)}</textarea>`
    : `<input name="${escapeHtml(field)}" value="${escapeHtml(value)}">`;
  return `
    <div class="editor-field ${isLarge ? "large" : ""}">
      <label>${escapeHtml(fieldLabels[field] || field)}</label>
      ${control}
    </div>
  `;
}

async function saveCurrentRow(event, row) {
  event.preventDefault();
  const formData = new FormData(event.currentTarget);
  const values = {};
  for (const [key, value] of formData.entries()) {
    if ((row[key] || "") !== value) {
      values[key] = value;
    }
  }

  if (!Object.keys(values).length) {
    setStatus("Không có thay đổi để lưu.");
    return;
  }

  setStatus("Đang lưu vào Excel...");
  const response = await fetch("/api/admin/excel-row", {
    method: "POST",
    headers: {
      "Accept": "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ rowId: row.rowId, values }),
  });
  const payload = await readApiJson(response);
  if (!response.ok || !payload.ok) {
    throw new Error(payload.error || "Không lưu được Excel.");
  }

  const index = state.rows.findIndex((item) => item.rowId === row.rowId);
  if (index >= 0 && payload.row) {
    state.rows[index] = payload.row;
  }
  applyFilters();
  if (index >= 0) {
    renderEditor(state.rows[index]);
  }
  setStatus("Đã lưu vào Excel. Quay lại trang luyện thi và bấm Đọc lại Excel để xem thay đổi.", "good");
}

async function openExcel() {
  const response = await fetch("/api/admin/open-excel");
  const payload = await readApiJson(response);
  if (!response.ok || !payload.ok) {
    throw new Error(payload.error || "Không mở được Excel.");
  }
  setStatus("Đã gửi lệnh mở Excel.", "good");
}

function bindEvents() {
  [els.examFilter, els.skillFilter, els.partFilter].forEach((select) => {
    select.addEventListener("change", applyFilters);
  });
  els.searchInput.addEventListener("input", applyFilters);
  els.reloadButton.addEventListener("click", () => loadRows().catch((error) => setStatus(error.message, "bad")));
  els.openExcelButton.addEventListener("click", () => openExcel().catch((error) => setStatus(error.message, "bad")));
}

bindEvents();
loadRows().catch((error) => setStatus(error.message, "bad"));
