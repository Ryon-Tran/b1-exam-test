let data = window.EXAM_DATA || { tests: [] };
let dataSource = "data.js fallback";

const partRanges = {
  1: [1, 5],
  2: [6, 10],
  3: [11, 15],
  4: [16, 20],
  5: [21, 26],
  6: [27, 32],
};

const listeningPartRanges = {
  1: [1, 7],
  2: [8, 13],
  3: [14, 19],
  4: [20, 25],
};

const listeningBlueprint = [
  {
    number: 1,
    title: "Part 1",
    label: "Short conversations",
    instruction: "Nghe 7 đoạn hội thoại ngắn. Với mỗi câu, chọn đáp án đúng A, B hoặc C.",
    type: "choice",
    options: ["A", "B", "C"],
  },
  {
    number: 2,
    title: "Part 2",
    label: "Matching or multiple choice",
    instruction: "Nghe một đoạn hội thoại dài hơn và chọn đáp án đúng cho từng câu.",
    type: "choice",
    options: ["A", "B", "C"],
  },
  {
    number: 3,
    title: "Part 3",
    label: "Notes completion",
    instruction: "Nghe thông tin và điền một từ hoặc số vào mỗi chỗ trống.",
    type: "text",
    options: [],
  },
  {
    number: 4,
    title: "Part 4",
    label: "Long conversation",
    instruction: "Nghe một cuộc trò chuyện dài và chọn đáp án đúng A, B hoặc C.",
    type: "choice",
    options: ["A", "B", "C"],
  },
];

const elements = {
  testSelect: document.querySelector("#testSelect"),
  syncExcelButton: document.querySelector("#syncExcelButton"),
  mixButton: document.querySelector("#mixButton"),
  mockButton: document.querySelector("#mockButton"),
  resetButton: document.querySelector("#resetButton"),
  submitButton: document.querySelector("#submitButton"),
  paperTitle: document.querySelector("#paperTitle"),
  paperMeta: document.querySelector("#paperMeta"),
  paperContent: document.querySelector("#paperContent"),
  partNav: document.querySelector("#partNav"),
  answerHeadTitle: document.querySelector(".answer-head h2"),
  answerSheet: document.querySelector("#answerSheet"),
  progressText: document.querySelector("#progressText"),
  scoreBox: document.querySelector("#scoreBox"),
  timer: document.querySelector("#timer"),
  tabs: document.querySelectorAll(".tab"),
};

let activeExam = null;
let activeTab = "reading";
let activePart = 1;
let answers = {};
let examResult = null;
let startedAt = Date.now();
let timerId = null;
let isSubmittingMock = false;

function normalise(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[.,;:!?]+$/g, "");
}

function imageByNumber(test, number) {
  const padded = String(number).padStart(3, "0");
  const question = String(number).padStart(2, "0");
  const legacyPattern = new RegExp(`/image${number}\\.(png|jpg|jpeg|gif)$`, "i");
  const assetPattern = new RegExp(`/exam-asset-${padded}\\.(png|jpg|jpeg|gif)$`, "i");
  const readingPattern = new RegExp(`/reading-part-1-question-${question}\\.(png|jpg|jpeg|gif)$`, "i");
  return (test.images || []).find((path) => readingPattern.test(path) || legacyPattern.test(path) || assetPattern.test(path));
}

function assetFolderFromTest(test) {
  const firstAsset = test?.images?.[0] || "";
  return firstAsset.includes("/") ? firstAsset.split("/").slice(0, -1).join("/") : "";
}

function listeningAudioFileName(partNumber, extension = "mp3") {
  return `listening-part-${String(partNumber).padStart(2, "0")}.${extension}`;
}

function listeningAudioCandidates(part) {
  const configured = part.audio || activeExam.listening?.audio;
  if (Array.isArray(configured)) return configured;
  if (configured && typeof configured === "object") {
    return [
      configured[String(part.number)],
      configured[`part${part.number}`],
      configured[`part-${part.number}`],
    ].filter(Boolean);
  }
  if (configured && typeof configured === "string") return [configured];

  const folder = activeExam.assetFolder || "";
  if (!folder) return [];
  return [
    `${folder}/listening.mp3`,
    `${folder}/listening.m4a`,
    `${folder}/listening.wav`,
    `${folder}/listening.ogg`,
    `${folder}/listening.mp3.m4a`,
    `${folder}/${listeningAudioFileName(part.number, "mp3")}`,
    `${folder}/${listeningAudioFileName(part.number, "m4a")}`,
    `${folder}/${listeningAudioFileName(part.number, "wav")}`,
    `${folder}/${listeningAudioFileName(part.number, "ogg")}`,
  ];
}

function choicesForQuestion(questionNumber) {
  if (questionNumber <= 5) return ["A", "B", "C"];
  if (questionNumber <= 10) return ["A", "B", "C", "D", "E", "F", "G", "H"];
  if (questionNumber <= 15) return ["A", "B", "C", "D"];
  if (questionNumber <= 20) return ["A", "B", "C", "D", "E", "F", "G", "H"];
  if (questionNumber <= 26) return ["A", "B", "C", "D"];
  return [];
}

function listeningChoicesForQuestion(questionNumber) {
  const part = listeningPartForQuestion(questionNumber);
  return part === 3 ? [] : ["A", "B", "C"];
}

function partForQuestion(questionNumber) {
  return Object.entries(partRanges).find(([, range]) => questionNumber >= range[0] && questionNumber <= range[1])?.[0];
}

function listeningPartForQuestion(questionNumber) {
  return Number(Object.entries(listeningPartRanges)
    .find(([, range]) => questionNumber >= range[0] && questionNumber <= range[1])?.[0] || 1);
}

function currentRanges() {
  return activeTab === "listening" ? listeningPartRanges : partRanges;
}

function currentQuestionTotal() {
  return activeTab === "listening" ? 25 : 32;
}

function answerKey(question, tab = activeTab) {
  return tab === "listening" ? `listening:${question}` : String(question);
}

function answerValue(question, tab = activeTab) {
  return answers[answerKey(question, tab)] || "";
}

function setAnswer(question, value, tab = activeTab) {
  answers[answerKey(question, tab)] = value;
  saveAnswers();
  clearExamResult();
  updateProgress();
}

function storageKey() {
  return activeExam ? `exam-practice:${activeExam.id}` : "exam-practice";
}

function saveAnswers() {
  if (!activeExam) return;
  localStorage.setItem(storageKey(), JSON.stringify(answers));
}

function loadAnswers() {
  if (!activeExam) return {};
  try {
    return JSON.parse(localStorage.getItem(storageKey()) || "{}");
  } catch {
    return {};
  }
}

function isMockExam(exam = activeExam) {
  return exam?.type === "mock";
}

function pickRandom(list) {
  return list[Math.floor(Math.random() * list.length)];
}

function eligibleTests() {
  return data.tests.filter((test) => (
    test.reading?.parts?.length === 6
    && test.listening?.parts?.length === 4
    && Object.keys(test.listening?.answers || {}).length
    && test.writing?.lines?.length
  ));
}

function resolveListeningAudio(source, partNumber, fallbackAudio = "") {
  const configured = fallbackAudio || source.listening?.audio || "";
  if (Array.isArray(configured)) return configured;
  if (configured && typeof configured === "object") return configured[String(partNumber)] || "";
  return configured;
}

function originalExam(test) {
  return {
    id: test.id,
    title: test.title,
    type: "original",
    writing: test.writing,
    listening: test.listening,
    assetFolder: assetFolderFromTest(test),
    parts: test.reading.parts.map((part) => ({
      ...part,
      sourceId: test.id,
      sourceTitle: test.title,
    })),
    answers: test.reading.answers || {},
  };
}

function mixedExam() {
  const tests = data.tests.filter((test) => test.reading?.parts?.length === 6);
  const parts = [];
  const answerMap = {};
  const sources = [];

  for (let partNumber = 1; partNumber <= 6; partNumber += 1) {
    const source = tests[Math.floor(Math.random() * tests.length)];
    const part = source.reading.parts.find((item) => item.number === partNumber);
    const [start, end] = partRanges[partNumber];
    sources.push(`Part ${partNumber}: ${source.title}`);
    parts.push({
      ...part,
      sourceId: source.id,
      sourceTitle: source.title,
    });

    for (let question = start; question <= end; question += 1) {
      answerMap[String(question)] = source.reading.answers?.[String(question)];
    }
  }

  const writingSource = tests[Math.floor(Math.random() * tests.length)];

  return {
    id: `mixed:${Date.now()}`,
    title: "Đề tổng hợp",
    type: "mixed",
    writing: writingSource.writing,
    listening: writingSource.listening,
    assetFolder: assetFolderFromTest(writingSource),
    parts,
    answers: answerMap,
    sources,
  };
}

function mockExam() {
  const tests = eligibleTests();
  const parts = [];
  const answerMap = {};
  const readingSources = [];
  const listeningSources = [];
  const listeningParts = [];
  const listeningAnswers = {};

  for (let partNumber = 1; partNumber <= 6; partNumber += 1) {
    const source = pickRandom(tests);
    const part = source.reading.parts.find((item) => item.number === partNumber);
    const [start, end] = partRanges[partNumber];
    readingSources.push(`Reading Part ${partNumber}: ${source.title}`);
    parts.push({
      ...part,
      sourceId: source.id,
      sourceTitle: source.title,
    });

    for (let question = start; question <= end; question += 1) {
      answerMap[String(question)] = source.reading.answers?.[String(question)];
    }
  }

  for (let partNumber = 1; partNumber <= 4; partNumber += 1) {
    const source = pickRandom(tests);
    const part = source.listening.parts.find((item) => item.number === partNumber);
    const [start, end] = listeningPartRanges[partNumber];
    listeningSources.push(`Listening Part ${partNumber}: ${source.title}`);
    listeningParts.push({
      ...part,
      sourceId: source.id,
      sourceTitle: source.title,
      audio: resolveListeningAudio(source, partNumber, part?.audio),
    });

    for (let question = start; question <= end; question += 1) {
      listeningAnswers[String(question)] = source.listening.answers?.[String(question)];
    }
  }

  const writingSource = pickRandom(tests);

  return {
    id: `mock:${Date.now()}`,
    title: "Thi thử tổng hợp",
    type: "mock",
    writing: writingSource.writing,
    listening: {
      ...writingSource.listening,
      parts: listeningParts,
      answers: listeningAnswers,
    },
    assetFolder: assetFolderFromTest(writingSource),
    parts,
    answers: answerMap,
    sources: {
      reading: readingSources,
      listening: listeningSources,
      writing: [`Writing: ${writingSource.title}`],
    },
  };
}

function setActiveExam(exam) {
  activeExam = exam;
  activePart = 1;
  answers = loadAnswers();
  examResult = null;
  startedAt = Date.now();
  elements.scoreBox.hidden = true;
  elements.scoreBox.innerHTML = "";
  render();
}

function resultForTab(tab = activeTab) {
  if (!examResult) return null;
  if (examResult.mode === tab) return examResult;
  if (examResult.mode === "mock") {
    if (tab === "reading") return examResult.reading || null;
    if (tab === "listening") return examResult.listening || null;
    if (tab === "writing") return examResult.writing || null;
  }
  return null;
}

function shouldShowScoreBox(tab = activeTab) {
  if (!examResult) return false;
  return examResult.mode === "mock" ? tab !== "writing" : examResult.mode === tab;
}

function setActiveTabView(nextTab) {
  if (activeTab !== nextTab) {
    activeTab = nextTab;
    activePart = 1;
    elements.scoreBox.hidden = !shouldShowScoreBox(nextTab);
  }
  elements.tabs.forEach((item) => item.classList.toggle("active", item.dataset.tab === nextTab));
  render();
}

function render() {
  if (!activeExam) return;
  document.body.classList.toggle("writing-mode", activeTab === "writing");

  if (activeTab === "listening") {
    elements.paperTitle.textContent = isMockExam()
      ? "Listening - Thi thử tổng hợp"
      : activeExam.type === "mixed" ? "Listening - Đề tổng hợp" : `Listening - ${activeExam.title}`;
    elements.paperMeta.textContent = isMockExam()
      ? "Thi thử tổng hợp | Hoàn thành đủ Listening trước khi nộp bài toàn đề."
      : "Khoảng 30 phút | 4 phần | 25 câu | Nghe audio và chọn/điền đáp án.";
  } else if (activeTab === "writing") {
    elements.paperTitle.textContent = isMockExam()
      ? "Writing - Thi thử tổng hợp"
      : activeExam.type === "mixed" ? "Writing - Đề tổng hợp" : `Writing - ${activeExam.title}`;
    elements.paperMeta.textContent = isMockExam()
      ? "2 bài viết | Khi đủ cả Reading, Listening và Writing, bấm Nộp thi thử để chấm tổng điểm."
      : "2 bài viết | Có thể bấm Chấm AI để xem điểm, nhận xét và gợi ý chỉnh sửa.";
  } else {
    elements.paperTitle.textContent = isMockExam()
      ? "Reading - Thi thử tổng hợp"
      : activeExam.type === "mixed" ? "Reading - Đề tổng hợp" : `Reading - ${activeExam.title}`;
    elements.paperMeta.textContent = isMockExam()
      ? "Thi thử tổng hợp | 32 câu Reading + 25 câu Listening + 2 bài Writing."
      : activeExam.type === "mixed"
      ? `45 phút | 32 câu | ${activeExam.sources.join(" | ")}`
      : "45 phút | 6 phần | 32 câu | Mỗi câu 1 điểm.";
  }

  renderAnswerSheet();
  renderPartNavigation();
  renderPaper();
  updateProgress();
}

function renderPaper() {
  elements.paperContent.innerHTML = "";
  elements.partNav.hidden = activeTab === "writing";
  if (activeTab === "writing") {
    renderWriting();
    return;
  }
  if (activeTab === "listening") {
    renderListening();
    return;
  }

  const part = activeExam.parts.find((item) => item.number === activePart) || activeExam.parts[0];
  if (!part) return;
  elements.paperContent.append(renderReadingPart(part));
  const reviewResult = resultForTab("reading");
  if (reviewResult) elements.paperContent.append(renderPartReview(activePart, reviewResult));
  elements.paperContent.append(renderPartControls());
}

function renderPartNavigation() {
  elements.partNav.innerHTML = "";
  if (!activeExam) return;

  const parts = activeTab === "listening" ? listeningParts() : activeExam.parts;
  const ranges = activeTab === "listening" ? listeningPartRanges : partRanges;

  parts.forEach((part) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `part-tab${part.number === activePart ? " active" : ""}`;
    const [start, end] = ranges[part.number];
    button.textContent = `Part ${part.number} (${start}-${end})`;
    button.addEventListener("click", () => {
      activePart = part.number;
      elements.scoreBox.hidden = !shouldShowScoreBox();
      render();
      window.scrollTo({ top: 0, behavior: "smooth" });
    });
    elements.partNav.append(button);
  });
}

function listeningParts() {
  const realParts = activeExam.listening?.parts;
  if (realParts?.length) {
    return realParts.map((part) => ({
      ...listeningPartMeta(part.number),
      ...part,
    }));
  }
  return listeningBlueprint;
}

function listeningPartMeta(partNumber) {
  return listeningBlueprint.find((part) => part.number === partNumber) || listeningBlueprint[0];
}

function renderListening() {
  const parts = listeningParts();
  const part = parts.find((item) => item.number === activePart) || parts[0];
  if (!part) return;

  const wrap = document.createElement("article");
  wrap.className = "listening-box";
  wrap.append(renderListeningHero(part));
  wrap.append(renderListeningQuestions(part));

  const reviewResult = resultForTab("listening");
  if (reviewResult) {
    wrap.append(renderListeningPartReview(activePart, reviewResult));
  }

  elements.paperContent.append(wrap);
}

function renderListeningHero(part) {
  const source = document.createElement("section");
  source.className = "listening-hero";

  const copy = document.createElement("div");
  copy.className = "listening-hero-copy";
  copy.innerHTML = `
    <span class="part-source">Listening ${escapeHtml(part.title || `Part ${part.number}`)}</span>
    <h3>${escapeHtml(part.label || "Listening practice")}</h3>
    <p>${escapeHtml(part.instruction || "Nghe audio và trả lời các câu hỏi bên dưới.")}</p>
    <div class="listening-rule-row">
      <span>Chuẩn bài thi</span>
      <span>Nghe 2 lần</span>
      <span>Không mở transcript khi làm</span>
    </div>
  `;

  const player = document.createElement("div");
  player.className = "listening-player-card";
  const audioSources = listeningAudioCandidates(part);
  if (audioSources.length) {
    const audio = document.createElement("audio");
    audio.controls = true;
    audio.preload = "metadata";
    audioSources.forEach((sourcePath) => {
      const source = document.createElement("source");
      source.src = sourcePath;
      source.type = audioMimeType(sourcePath);
      audio.append(source);
    });
    const pathHint = document.createElement("p");
    pathHint.className = "audio-path-hint";
    pathHint.textContent = `File nghe: ${audioSources[0]}`;
    player.append(audio, pathHint);
  } else {
    player.innerHTML = `
      <div class="audio-placeholder-icon">Audio</div>
      <strong>Chưa gắn file nghe</strong>
      <p>Giao diện đã sẵn sàng. Hãy đặt một file MP3 vào thư mục assets của đề theo tên listening.mp3.</p>
    `;
  }

  source.append(copy, player);
  return source;
}

function audioMimeType(sourcePath) {
  const extension = sourcePath.split(".").pop()?.toLowerCase();
  if (extension === "wav") return "audio/wav";
  if (extension === "m4a") return "audio/mp4";
  if (extension === "ogg") return "audio/ogg";
  return "audio/mpeg";
}

function renderListeningQuestions(part) {
  const questions = listeningQuestions(part);
  const grid = document.createElement("div");
  grid.className = `listening-question-grid part-${part.number}`;

  questions.forEach((question) => {
    const card = document.createElement("article");
    card.className = "listening-question-card";
    const hasImageOptions = question.options?.some((option) => option.image);
    if (hasImageOptions) card.classList.add("image-choice-card");

    const top = document.createElement("div");
    top.className = "reading-question-top";
    top.innerHTML = `
      <span class="question-badge">${escapeHtml(question.number)}</span>
      <p class="reading-question-text">${escapeHtml(question.stem)}</p>
    `;
    card.append(top);

    if (question.image) {
      const figure = document.createElement("figure");
      figure.className = "listening-question-image";
      const image = document.createElement("img");
      image.src = question.image;
      image.alt = `Ảnh minh họa câu ${question.number}`;
      figure.append(image);
      card.append(figure);
    }

    if (question.type === "text") {
      const input = document.createElement("input");
      input.type = "text";
      input.className = "listening-text-answer";
      input.value = answerValue(question.number, "listening");
      input.placeholder = "Nhập từ hoặc số";
      input.addEventListener("input", () => {
        setAnswer(question.number, input.value, "listening");
      });
      card.append(input);
    } else {
      const options = document.createElement("div");
      options.className = "listening-option-grid";
      if (hasImageOptions) options.classList.add("image-options");
      question.options.forEach((option) => {
        const button = document.createElement("button");
        button.type = "button";
        button.className = "listening-option";
        if (option.image) button.classList.add("with-image");
        button.classList.toggle("selected", answerValue(question.number, "listening") === option.letter);

        const letter = document.createElement("strong");
        letter.textContent = option.letter;
        const detail = document.createElement("span");
        if (option.image) {
          detail.append(renderListeningOptionImage(question.number, option));
        } else {
          detail.textContent = option.text;
        }
        button.append(letter, detail);
        button.addEventListener("click", () => {
          setAnswer(question.number, option.letter, "listening");
          renderAnswerSheet();
          renderPaper();
        });
        options.append(button);
      });
      card.append(options);
    }

    grid.append(card);
  });

  return grid;
}

function renderListeningOptionImage(questionNumber, option) {
  if (option.crop) {
    const image = document.createElement("span");
    image.className = `option-image-crop crop-${option.crop}`;
    image.style.backgroundImage = `url("${String(option.image).replace(/"/g, "%22")}")`;
    image.setAttribute("role", "img");
    image.setAttribute("aria-label", `Câu ${questionNumber} đáp án ${option.letter}`);
    return image;
  }

  const image = document.createElement("img");
  image.src = option.image;
  image.alt = `Câu ${questionNumber} đáp án ${option.letter}`;
  return image;
}

function listeningQuestions(part) {
  if (part.questions?.length) {
    return part.questions.map((question) => normaliseListeningQuestion(question, part));
  }

  const [start, end] = listeningPartRanges[part.number];
  return Array.from({ length: end - start + 1 }, (_, index) => {
    const number = start + index;
    const isText = part.type === "text";
    return {
      number,
      type: isText ? "text" : "choice",
      stem: isText
        ? `Câu ${number}: Điền thông tin còn thiếu sau khi nghe.`
        : `Câu ${number}: Chọn đáp án đúng sau khi nghe.`,
      options: isText ? [] : ["A", "B", "C"].map((letter) => ({
        letter,
        text: `Đáp án ${letter}`,
      })),
    };
  });
}

function normaliseListeningQuestion(question, part) {
  const options = (question.options || part.options || ["A", "B", "C"]).map((option) => {
    if (typeof option === "string") {
      return { letter: option, text: question.optionTexts?.[option] || `Đáp án ${option}` };
    }
    return {
      letter: option.letter || option.value || "",
      text: option.text || option.label || `Đáp án ${option.letter || option.value || ""}`,
      image: option.image || "",
      crop: option.crop || "",
    };
  }).filter((option) => option.letter);

  return {
    number: Number(question.number),
    type: question.type || part.type || (options.length ? "choice" : "text"),
    stem: question.stem || question.question || `Câu ${question.number}`,
    image: question.image || "",
    options,
  };
}

function renderReadingPart(part) {
  const sourceTest = data.tests.find((test) => test.id === part.sourceId);
  const article = document.createElement("article");
  article.className = "exam-part single-part";

  article.append(renderPartHeader(part));

  if (part.number === 1) {
    article.append(renderPartOne(part, sourceTest));
    return article;
  }

  if (part.number === 2) {
    article.append(renderPartTwo(part));
    return article;
  }

  if (part.number === 3) {
    const content = renderPartThree(part);
    if (content) {
      article.append(content);
      return article;
    }
  }

  if (part.number === 4) {
    const content = renderPartFour(part);
    if (content) {
      article.append(content);
      return article;
    }
  }

  if (part.number === 5) {
    const content = renderPartFive(part);
    if (content) {
      article.append(content);
      return article;
    }
  }

  const lines = document.createElement("div");
  lines.className = "part-lines readable-lines";
  part.lines.forEach((line) => {
    const p = document.createElement("p");
    p.className = lineClass(line);
    p.textContent = line;
    lines.append(p);
  });
  article.append(lines);
  return article;
}

function renderPartHeader(part) {
  const [start, end] = partRanges[part.number] || ["", ""];
  const header = document.createElement("header");
  header.className = "exam-part-header";

  const top = document.createElement("div");
  top.className = "exam-part-title-row";

  const title = document.createElement("h3");
  title.textContent = `Part ${part.number}`;
  top.append(title);

  const range = document.createElement("span");
  range.className = "exam-question-range";
  range.textContent = `Questions ${start}-${end}`;
  top.append(range);
  header.append(top);

  const instructions = partInstructionLines(part);
  if (instructions.length) {
    const instructionBox = document.createElement("div");
    instructionBox.className = "exam-instructions";
    instructions.forEach((line) => {
      const p = document.createElement("p");
      p.textContent = line;
      instructionBox.append(p);
    });
    header.append(instructionBox);
  }

  if (activeExam.type === "mixed") {
    const source = document.createElement("p");
    source.className = "exam-source-note";
    source.textContent = `Lấy từ ${part.sourceTitle}`;
    header.append(source);
  }

  return header;
}

function partInstructionLines(part) {
  return cleanedPartLines(part.lines)
    .filter((line) => isInstructionLine(line))
    .filter((line) => !/^part\s+\d+/i.test(line))
    .slice(0, 4);
}

function renderPartTwo(part) {
  const parsed = parsePartTwo(part.lines);
  const wrap = document.createElement("div");
  wrap.className = "part-two-layout";

  const intro = document.createElement("div");
  intro.className = "part-two-intro";
  parsed.intro.forEach((line) => {
    const p = document.createElement("p");
    p.textContent = line;
    intro.append(p);
  });
  wrap.append(intro);

  const matcher = document.createElement("div");
  matcher.className = "matcher-grid";

  const people = document.createElement("section");
  people.className = "matcher-column";
  const peopleTitle = document.createElement("h3");
  peopleTitle.textContent = "Câu 6-10";
  people.append(peopleTitle);

  parsed.questions.forEach((question) => {
    const card = document.createElement("article");
    card.className = "matcher-card";
    const top = document.createElement("div");
    top.className = "matcher-card-top";
    const badge = document.createElement("span");
    badge.className = "question-badge small";
    badge.textContent = question.number;
    top.append(badge);

    const text = document.createElement("p");
    text.textContent = question.text;
    card.append(top, text);
    people.append(card);
  });

  const options = document.createElement("section");
  options.className = "matcher-column option-library";
  const optionsTitle = document.createElement("h3");
  optionsTitle.textContent = parsed.optionTitle || "A-H";
  options.append(optionsTitle);

  parsed.options.forEach((option) => {
    const card = document.createElement("article");
    card.className = "option-card";
    const title = document.createElement("h4");
    const letter = document.createElement("span");
    letter.className = "option-letter";
    letter.textContent = `${option.letter}.`;
    const name = document.createElement("span");
    name.className = "option-title-text";
    name.textContent = option.title;
    title.append(letter, name);
    const detail = document.createElement("p");
    detail.textContent = option.detail;
    card.append(title, detail);
    options.append(card);
  });

  matcher.append(people, options);
  wrap.append(matcher);
  return wrap;
}

function renderPartThree(part) {
  const parsed = parseReadingMcqPart(part.lines, 11, 15);
  if (!parsed) return null;

  const wrap = document.createElement("div");
  wrap.className = "structured-reading";
  wrap.append(renderReadingPassage(parsed.title, parsed.passage));
  wrap.append(renderQuestionGrid(parsed.questions, "part-three-list"));
  return wrap;
}

function renderPartFour(part) {
  const parsed = parsePartFour(part.lines);
  if (!parsed) return null;

  const wrap = document.createElement("div");
  wrap.className = "structured-reading part-four-layout";
  wrap.append(renderReadingPassage(parsed.title, parsed.passage, "gap-reading"));

  const optionBank = document.createElement("section");
  optionBank.className = "option-bank";

  const heading = document.createElement("h3");
  heading.textContent = "Câu 16-20";
  optionBank.append(heading);

  const hint = document.createElement("p");
  hint.className = "option-bank-hint";
  hint.textContent = "Chọn câu A-H phù hợp cho từng chỗ trống trong bài.";
  optionBank.append(hint);

  const list = document.createElement("div");
  list.className = "option-bank-grid";
  parsed.options.forEach((option) => {
    const card = document.createElement("article");
    card.className = "reading-choice-card";
    card.innerHTML = `<strong>${escapeHtml(option.letter)}</strong><span>${escapeHtml(option.text)}</span>`;
    list.append(card);
  });
  optionBank.append(list);
  wrap.append(optionBank);
  return wrap;
}

function renderPartFive(part) {
  const parsed = parseReadingMcqPart(part.lines, 21, 26);
  if (!parsed) return null;

  const wrap = document.createElement("div");
  wrap.className = "structured-reading part-five-layout";
  wrap.append(renderReadingPassage(parsed.title, parsed.passage));
  wrap.append(renderQuestionGrid(parsed.questions, "part-five-list"));
  return wrap;
}

function parsePartTwo(lines) {
  const cleaned = lines
    .map((line) => line.replace(/^-?\d+(\s+-?\d+){1,}\s+/, "").trim())
    .filter(Boolean);
  const questionStartIndexes = [];
  cleaned.forEach((line, index) => {
    const match = line.match(/^([6-9]|10)\s*\.?$/);
    if (match) questionStartIndexes.push(index);
  });

  const firstQuestionIndex = questionStartIndexes[0] ?? cleaned.length;
  const intro = cleaned.slice(0, firstQuestionIndex)
    .filter((line) => !/^Part\s+2/i.test(line) && !/^Questions\s+6/i.test(line));
  const questions = [];

  questionStartIndexes.forEach((startIndex, index) => {
    const nextIndex = questionStartIndexes[index + 1];
    const number = Number(cleaned[startIndex].match(/\d+/)[0]);
    let endIndex = nextIndex ?? findPartTwoOptionStart(cleaned, startIndex + 1);
    if (!endIndex || endIndex <= startIndex) endIndex = cleaned.length;
    questions.push({
      number,
      text: cleaned.slice(startIndex + 1, endIndex).join(" "),
    });
  });

  const optionStart = findPartTwoOptionStart(cleaned, questionStartIndexes.at(-1) + 1);
  const optionTitle = cleaned[optionStart] || "Options";
  const optionLines = cleaned.slice(optionStart + 1);
  const options = parsePartTwoOptions(optionLines);

  return { intro, questions, optionTitle, options };
}

function parseReadingMcqPart(lines, start, end) {
  const cleaned = cleanedPartLines(lines);
  const firstQuestionIndex = findFirstQuestionIndex(cleaned, start, end);
  if (firstQuestionIndex < 0) return null;

  const prelude = cleaned.slice(0, firstQuestionIndex).filter((line) => !isInstructionLine(line));
  const title = prelude[0] || `Questions ${start}-${end}`;
  const passage = prelude.slice(1);
  const questions = parseMcqQuestions(cleaned.slice(firstQuestionIndex).join(" "), start, end, ["A", "B", "C", "D"]);

  if (questions.length !== end - start + 1 || questions.some((question) => question.options.length < 3)) return null;
  return { title, passage, questions };
}

function parsePartFour(lines) {
  const cleaned = cleanedPartLines(lines).filter((line) => !isInstructionLine(line));
  if (!cleaned.length) return null;

  const optionStart = findPartFourOptionStart(cleaned);
  if (optionStart <= 0) return null;

  const title = cleaned[0];
  const passage = cleaned.slice(1, optionStart);
  const options = parsePartFourOptions(cleaned.slice(optionStart));

  if (passage.length === 0 || options.length < 5) return null;
  return { title, passage, options };
}

function renderReadingPassage(title, paragraphs, extraClass = "") {
  const section = document.createElement("section");
  section.className = `reading-passage${extraClass ? ` ${extraClass}` : ""}`;

  const heading = document.createElement("h3");
  heading.textContent = title;
  section.append(heading);

  paragraphs.forEach((paragraph) => {
    const p = document.createElement("p");
    p.textContent = paragraph;
    section.append(p);
  });

  return section;
}

function renderQuestionGrid(questions, variant = "") {
  const grid = document.createElement("div");
  grid.className = `reading-question-grid${variant ? ` ${variant}` : ""}`;

  questions.forEach((question) => {
    const card = document.createElement("article");
    card.className = "reading-question-card";

    const top = document.createElement("div");
    top.className = "reading-question-top";

    const badge = document.createElement("span");
    badge.className = "question-badge";
    badge.textContent = question.number;
    top.append(badge);

    if (question.stem) {
      const stem = document.createElement("p");
      stem.className = "reading-question-text";
      stem.textContent = question.stem;
      top.append(stem);
    }

    const options = createReadingInlineOptionList(question.number, question.options);

    card.append(top, options);
    grid.append(card);
  });

  return grid;
}

function parseMcqQuestions(text, start, end, letters) {
  const questionNumbers = Array.from({ length: end - start + 1 }, (_, index) => start + index);
  const pattern = new RegExp(`(?:^|\\s)(${questionNumbers.join("|")})\\s*\\.?\\s*`, "g");
  const source = compactText(text);
  const starts = [];
  let match = pattern.exec(source);

  while (match) {
    starts.push({
      number: Number(match[1]),
      bodyStart: pattern.lastIndex,
      matchStart: match.index,
    });
    match = pattern.exec(source);
  }

  return starts.map((item, index) => {
    const next = starts[index + 1]?.matchStart ?? source.length;
    return parseMcqQuestionBody(source.slice(item.bodyStart, next), item.number, letters);
  });
}

function parseMcqQuestionBody(body, number, letters) {
  const cleanedBody = compactText(body).replace(/^\.\s*/, "");
  const options = parseLetteredChoices(cleanedBody, letters);
  const firstOption = cleanedBody.search(new RegExp(`(?:^|\\s)${letters[0]}\\s*\\.?\\s+`));
  const stem = firstOption >= 0 ? cleanedBody.slice(0, firstOption).trim() : cleanedBody;
  return { number, stem, options };
}

function parseMcqQuestion(lines, number, letters) {
  const joined = compactText(lines.join(" "));
  const body = joined.replace(new RegExp(`^${number}\\s*\\.?\\s*`), "").trim();
  const options = parseLetteredChoices(body, letters);
  const firstOption = body.search(new RegExp(`\\b${letters[0]}\\s*\\.?\\s+`));
  const stem = firstOption >= 0 ? body.slice(0, firstOption).trim() : body;
  return { number, stem, options };
}

function parseLetteredChoices(text, letters) {
  const lettersPattern = letters.join("");
  const pattern = new RegExp(`(?:^|\\s)([${lettersPattern}])\\s*\\.?\\s+([\\s\\S]*?)(?=(?:\\s+[${lettersPattern}]\\s*\\.?\\s+)|$)`, "g");
  const result = [];
  let match = pattern.exec(compactText(text));

  while (match) {
    result.push({
      letter: match[1],
      text: compactText(match[2]),
    });
    match = pattern.exec(compactText(text));
  }

  return result;
}

function findQuestionIndexes(lines, start, end) {
  const found = [];
  lines.forEach((line, index) => {
    for (let number = start; number <= end; number += 1) {
      if (startsQuestionLine(line, number)) {
        found.push({ number, index });
        break;
      }
    }
  });
  return found;
}

function findFirstQuestionIndex(lines, start, end) {
  return lines.findIndex((line) => {
    for (let number = start; number <= end; number += 1) {
      if (startsQuestionLine(line, number)) return true;
    }
    return false;
  });
}

function startsQuestionLine(line, number) {
  return new RegExp(`^${number}\\s*\\.?\\s*`).test(line);
}

function looksLikeOptionLine(line) {
  if (/^[A-H]\s*\.?\s+/.test(line)) return true;
  return (line.match(/\b[A-H]\s*\.?\s+/g) || []).length >= 3;
}

function findPartFourOptionStart(lines) {
  const separateLetterIndex = lines.findIndex((line) => /^[A-H]\.?$/.test(line));
  if (separateLetterIndex > 0) return separateLetterIndex;

  const labelledLineIndex = lines.findIndex((line) => looksLikeOptionLine(line));
  if (labelledLineIndex > 0) return labelledLineIndex;

  return lines.length > 9 ? lines.length - 8 : -1;
}

function parsePartFourOptions(lines) {
  const letters = ["A", "B", "C", "D", "E", "F", "G", "H"];
  const labelled = parseLetteredChoices(lines.join(" "), letters);
  if (labelled.length >= 5) return labelled;

  return lines.slice(0, 8).map((line, index) => ({
    letter: letters[index],
    text: line,
  }));
}

function cleanedPartLines(lines) {
  return lines
    .map((line) => String(line || "").replace(/^-?\d+(\s+-?\d+){1,}\s+/, ""))
    .map((line) => compactText(line))
    .filter(Boolean);
}

function compactText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function isInstructionLine(line) {
  return /^part\s+\d+/i.test(line)
    || /^questions\s+/i.test(line)
    || /^look at/i.test(line)
    || /^the people below/i.test(line)
    || /^on the opposite page/i.test(line)
    || /^decide which/i.test(line)
    || /^read the text/i.test(line)
    || /^for each question/i.test(line)
    || /^for questions/i.test(line)
    || /^for\s+\d+[-–]\d+/i.test(line)
    || /^five sentences have been removed/i.test(line)
    || /^there are three extra sentences/i.test(line)
    || /^write one word/i.test(line);
}

function findPartTwoOptionStart(lines, fromIndex) {
  for (let index = Math.max(0, fromIndex); index < lines.length; index += 1) {
    const line = lines[index];
    const previous = lines[index - 1] || "";
    const looksLikeTitle = line.length < 80 && !/[.!?]$/.test(line);
    const previousWasQuestionText = previous.length > 20 && /[.!?]$/.test(previous);
    const nextLooksLikeOption = /^([A-H])\s*\.?\s+/.test(lines[index + 1] || "");
    if (nextLooksLikeOption) return index;
    if (previousWasQuestionText && looksLikeTitle) return index;
  }
  return fromIndex + 1;
}

function parsePartTwoOptions(lines) {
  const options = [];
  let current = null;
  const usedLetters = new Set();

  lines.forEach((line) => {
    const match = line.match(/^([A-H])\s*\.?\s+(.+)$/);
    if (match) {
      current = {
        letter: match[1],
        title: match[2].trim(),
        detailLines: [],
      };
      usedLetters.add(current.letter);
      options.push(current);
      return;
    }

    if (!current) {
      current = {
        letter: nextMissingLetter(usedLetters),
        title: line,
        detailLines: [],
      };
      usedLetters.add(current.letter);
      options.push(current);
      return;
    }

    current.detailLines.push(line);
  });

  return options.map((option) => ({
    letter: option.letter,
    title: option.title,
    detail: option.detailLines.join(" "),
  }));
}

function nextMissingLetter(usedLetters) {
  return ["A", "B", "C", "D", "E", "F", "G", "H"].find((letter) => !usedLetters.has(letter)) || "A";
}

function createAnswerSelect(questionNumber, choices) {
  const select = document.createElement("select");
  select.className = "answer-select";
  select.dataset.answerFor = String(questionNumber);

  const empty = document.createElement("option");
  empty.value = "";
  empty.textContent = "Chọn";
  select.append(empty);

  choices.forEach((choice) => {
    const option = document.createElement("option");
    option.value = choice;
    option.textContent = choice;
    select.append(option);
  });

  select.value = answerValue(questionNumber);
  select.addEventListener("change", () => {
    setAnswer(questionNumber, select.value);
    syncAnswerInputs(questionNumber, select.value);
  });

  return select;
}

function syncAnswerInputs(questionNumber, value) {
  document.querySelectorAll(`[data-answer-for="${questionNumber}"]`).forEach((input) => {
    if (input instanceof HTMLSelectElement || (input instanceof HTMLInputElement && input.type === "text")) {
      if (input.value !== value) input.value = value;
      return;
    }

    if (input instanceof HTMLInputElement && input.type === "radio") {
      input.checked = input.value === value;
      return;
    }

    const choice = input.dataset.answerChoice || "";
    if (choice) {
      input.classList.toggle("selected", choice === value);
    }
  });
}

function createReadingInlineChoice(questionNumber, option) {
  const label = document.createElement("label");
  label.className = "reading-choice selectable-choice";
  label.dataset.answerFor = String(questionNumber);
  label.dataset.answerChoice = option.letter;

  const input = document.createElement("input");
  input.type = "radio";
  input.name = `reading-inline-q${questionNumber}`;
  input.value = option.letter;
  input.dataset.answerFor = String(questionNumber);
  input.checked = answerValue(questionNumber, "reading") === option.letter;

  const letter = document.createElement("strong");
  letter.textContent = option.letter;

  const text = document.createElement("span");
  text.textContent = option.text;

  label.classList.toggle("selected", input.checked);
  input.addEventListener("change", () => {
    setAnswer(questionNumber, option.letter, "reading");
    syncAnswerInputs(questionNumber, option.letter);
  });

  label.append(input, letter, text);
  return label;
}

function createReadingInlineOptionList(questionNumber, options, extraClass = "") {
  const wrap = document.createElement("div");
  wrap.className = `reading-choice-list${extraClass ? ` ${extraClass}` : ""}`;
  options.forEach((option) => {
    wrap.append(createReadingInlineChoice(questionNumber, option));
  });
  return wrap;
}

function renderPartOne(part, sourceTest) {
  const wrap = document.createElement("div");
  wrap.className = "structured-reading part-one-layout";
  const questions = parsePartOneQuestions(part.lines);

  questions.forEach((question) => {
    const card = document.createElement("section");
    card.className = "reading-question-card part-one-card";

    const prompt = document.createElement("div");
    prompt.className = "question-prompt";

    const top = document.createElement("div");
    top.className = "reading-question-top part-one-top";

    const number = document.createElement("span");
    number.className = "question-badge";
    number.textContent = question.number;
    top.append(number);

    const promptText = document.createElement("div");
    promptText.className = "part-one-prompt-text";
    question.promptLines.forEach((line) => {
      const p = document.createElement("p");
      p.textContent = line;
      promptText.append(p);
    });
    top.append(promptText);
    prompt.append(top);

    const image = sourceTest ? imageByNumber(sourceTest, question.number) : null;
    if (image) {
      const frame = document.createElement("div");
      frame.className = "part-one-image-frame";
      const img = document.createElement("img");
      img.src = image;
      img.alt = `Question ${question.number}`;
      frame.append(img);
      prompt.append(frame);
    }

    const options = createReadingInlineOptionList(question.number, question.options, "part-one-choices");

    card.append(prompt, options);
    wrap.append(card);
  });

  return wrap;
}

function parsePartOneQuestions(lines) {
  const questions = [];
  let current = null;
  let currentOption = null;

  lines.forEach((line, index) => {
    const questionMatch = line.match(/^(\d+)\s*\.?$/);
    if (questionMatch) {
      current = {
        number: Number(questionMatch[1]),
        promptLines: [],
        options: [],
      };
      currentOption = null;
      questions.push(current);
      return;
    }

    if (!current) return;

    const optionMatch = line.match(/^([A-C])(?:$|\s*\.?\s+)(.*)$/);
    if (optionMatch && isPartOneOptionLine(line, lines[index + 1] || "", currentOption)) {
      currentOption = {
        letter: optionMatch[1],
        text: optionMatch[2].trim(),
      };
      current.options.push(currentOption);
      return;
    }

    if (currentOption) {
      currentOption.text = `${currentOption.text} ${line}`.trim();
    } else if (!/^Part\s+1$/i.test(line) && !/^Questions\s+/i.test(line) && !/^Look at/i.test(line) && !/^For each/i.test(line)) {
      current.promptLines.push(line);
    }
  });

  return questions;
}

function isPartOneOptionLine(line, nextLine, currentOption) {
  if (/^[A-C]\s*\.?$/.test(line)) return true;
  if (/^[A-C]\s*\.\s+/.test(line)) return true;
  if (currentOption) return true;
  return /^A\s+/.test(line) && /^B(?:$|\s*\.?\s+)/.test(nextLine);
}

function renderPartControls() {
  const controls = document.createElement("div");
  controls.className = "part-controls";
  const previous = document.createElement("button");
  previous.type = "button";
  previous.className = "secondary";
  previous.textContent = "Part trước";
  previous.disabled = activePart === 1;
  previous.addEventListener("click", () => changePart(-1));

  const next = document.createElement("button");
  next.type = "button";
  next.textContent = activePart === 6
    ? (isMockExam() ? "Sang Listening" : "Xem lại đáp án")
    : "Part tiếp";
  next.addEventListener("click", () => {
    if (activePart < 6) changePart(1);
    else if (isMockExam()) setActiveTabView("listening");
    else scoreExam();
  });

  controls.append(previous, next);
  return controls;
}

function changePart(offset) {
  activePart = Math.min(6, Math.max(1, activePart + offset));
  elements.scoreBox.hidden = !shouldShowScoreBox();
  render();
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function lineClass(line) {
  if (/^Part\s+\d+$/.test(line) || /^Questions\s+/.test(line)) return "part-line heading";
  if (/^\d+$/.test(line)) return "part-line question-number";
  if (/^[A-H]$/.test(line)) return "part-line heading";
  return "part-line";
}

function renderWriting() {
  const source = activeExam.type === "mixed"
    ? "Writing lấy ngẫu nhiên từ một đề gốc."
    : "Writing của đề đang chọn.";
  const sourceTest = data.tests.find((test) => test.writing === activeExam.writing) || data.tests[0];
  const box = document.createElement("div");
  box.className = "writing-box";
  const layout = document.createElement("div");
  layout.className = "writing-layout";
  const promptPanel = document.createElement("section");
  promptPanel.className = "writing-prompt-panel";
  const editorPanel = document.createElement("section");
  editorPanel.className = "writing-editor-panel";

  const intro = document.createElement("div");
  intro.className = "part-source";
  intro.textContent = source;
  promptPanel.append(intro);

  const imageWrap = document.createElement("div");
  imageWrap.className = "writing-prompt-images";
  const promptImages = activeExam.writing?.promptImages?.length
    ? activeExam.writing.promptImages
    : [11, 12].map((number) => imageByNumber(sourceTest, number)).filter(Boolean);

  promptImages.forEach((image) => {
    if (!image) return;
    const img = document.createElement("img");
    img.src = image;
    img.alt = "Writing prompt";
    imageWrap.append(img);
  });
  if (imageWrap.children.length > 0) promptPanel.append(imageWrap);

  const task = document.createElement("div");
  task.className = "writing-task";
  (activeExam.writing?.lines || []).forEach((line) => {
    const p = document.createElement("p");
    p.className = lineClass(line);
    p.textContent = line;
    task.append(p);
  });
  promptPanel.append(task);

  const note = document.createElement("div");
  note.className = "writing-editor-note";
  note.innerHTML = `
    <strong>Viết bài ngay bên phải</strong>
    <p class="question-hint">${isMockExam()
      ? "Hoàn thành đủ 2 bài viết rồi nộp thi thử để chấm cả 3 phần cùng lúc."
      : "Đề được giữ cố định để bạn vừa xem vừa viết mà không phải cuộn lên xuống liên tục."}</p>
  `;
  editorPanel.append(note);

  const q1 = writingArea("writing1", "Question 1 - Email");
  const q2 = writingArea("writing2", "Question 2 hoặc Question 3");
  editorPanel.append(q1, q2);
  if (isMockExam()) editorPanel.append(renderMockSubmitPanel());
  layout.append(promptPanel, editorPanel);
  box.append(layout);
  elements.paperContent.append(box);
}

function writingArea(name, label) {
  const wrap = document.createElement("section");
  wrap.className = "writing-area";

  const head = document.createElement("div");
  head.className = "writing-area-head";

  const title = document.createElement("p");
  title.className = "question-hint";
  title.textContent = label;

  const gradeButton = document.createElement("button");
  gradeButton.type = "button";
  gradeButton.className = "secondary writing-grade-button";
  gradeButton.textContent = "Chấm AI";

  head.append(title, gradeButton);

  const textarea = document.createElement("textarea");
  textarea.className = "writing-textarea";
  textarea.id = name;
  textarea.value = answers[name] || "";
  textarea.placeholder = "Viết bài của bạn ở đây...";
  textarea.addEventListener("input", () => {
    answers[name] = textarea.value;
    delete answers[writingScoreKey(name)];
    saveAnswers();
    if (examResult) clearExamResult();
    else updateProgress();
  });

  const result = document.createElement("div");
  result.className = "writing-ai-result";
  const savedScore = answers[writingScoreKey(name)];
  if (savedScore) renderWritingScore(result, savedScore);

  gradeButton.addEventListener("click", () => gradeWritingAnswer(name, label, gradeButton, result));

  wrap.append(head, textarea, result);
  return wrap;
}

function writingScoreKey(name) {
  return `${name}:aiScore`;
}

function writingTaskText(name) {
  const lines = activeExam.writing?.lines || [];
  const startPattern = name === "writing1" ? /^question\s+1\b/i : /^question\s+2\b/i;
  const stopPattern = name === "writing1" ? /^question\s+2\b/i : null;
  const start = lines.findIndex((line) => startPattern.test(line));
  const end = stopPattern ? lines.findIndex((line, index) => index > start && stopPattern.test(line)) : -1;
  const slice = start >= 0
    ? lines.slice(start, end > start ? end : lines.length)
    : lines;
  return slice.join("\n");
}

async function gradeWritingAnswer(name, label, button, result) {
  const answer = compactText(answers[name] || "");
  if (answer.split(/\s+/).filter(Boolean).length < 20) {
    window.alert("Bài viết hơi ngắn, hãy viết ít nhất khoảng 20 từ rồi chấm nhé.");
    return;
  }

  const originalText = button.textContent;
  button.disabled = true;
  button.textContent = "Đang chấm...";
  result.className = "writing-ai-result loading";
  result.textContent = "AI đang chấm theo tiêu chí luyện thi B1...";

  try {
    const score = await ensureWritingScore(name, label);
    renderWritingScore(result, score);
  } catch (error) {
    result.className = "writing-ai-result error";
    result.innerHTML = `
      <strong>Chưa chấm được.</strong>
      <p>${escapeHtml(error.message)}</p>
      <p>Mở app bằng <code>data-manager.bat</code> và kiểm tra file <code>.env</code> có <code>GEMINI_API_KEY</code>.</p>
    `;
  } finally {
    button.disabled = false;
    button.textContent = originalText;
  }
}

function renderWritingScore(container, score) {
  const flags = score.flags?.length ? score.flags.join(", ") : "không có";
  const suggestion = score.suggestion || "Hãy kiểm tra lại yêu cầu đề bài, thêm chi tiết cụ thể và sửa các lỗi ngữ pháp dễ thấy.";
  container.className = "writing-ai-result ready";
  container.innerHTML = `
    <div class="writing-score-top">
      <strong>${escapeHtml(score.total)}/20</strong>
      <span>Level: ${escapeHtml(score.level)}</span>
    </div>
    <div class="writing-score-grid">
      <span>TA <strong>${escapeHtml(score.ta)}/5</strong></span>
      <span>ORG <strong>${escapeHtml(score.org)}/5</strong></span>
      <span>VOC <strong>${escapeHtml(score.voc)}/5</strong></span>
      <span>GRA <strong>${escapeHtml(score.gra)}/5</strong></span>
    </div>
    <p>${escapeHtml(score.note || "Đã chấm theo tiêu chí luyện thi B1.")}</p>
    <div class="writing-suggestion">
      <strong>Gợi ý chỉnh sửa</strong>
      <p>${escapeHtml(suggestion)}</p>
    </div>
    <p class="question-hint">Lưu ý: ${escapeHtml(flags)}</p>
  `;
}

function wordCount(value) {
  return compactText(value).split(/\s+/).filter(Boolean).length;
}

function mockCompletionStatus() {
  const readingDone = Array.from({ length: 32 }, (_, index) => index + 1)
    .filter((question) => normalise(answerValue(question, "reading"))).length;
  const listeningDone = Array.from({ length: 25 }, (_, index) => index + 1)
    .filter((question) => normalise(answerValue(question, "listening"))).length;
  const writing1Words = wordCount(answers.writing1 || "");
  const writing2Words = wordCount(answers.writing2 || "");

  return {
    readingDone,
    readingTotal: 32,
    listeningDone,
    listeningTotal: 25,
    writing1Words,
    writing2Words,
    writingReady: writing1Words >= 20 && writing2Words >= 20,
    complete: readingDone === 32 && listeningDone === 25 && writing1Words >= 20 && writing2Words >= 20,
  };
}

function renderMockSubmitPanel() {
  const status = mockCompletionStatus();
  const panel = document.createElement("section");
  panel.className = "writing-side-panel";
  panel.dataset.mockSubmitPanel = "true";
  panel.innerHTML = `
    <strong>Thi thử tổng hợp</strong>
    <p>Reading: <b data-mock-reading>${status.readingDone}/${status.readingTotal}</b> câu.</p>
    <p>Listening: <b data-mock-listening>${status.listeningDone}/${status.listeningTotal}</b> câu.</p>
    <p>Writing 1: <b data-mock-writing1>${status.writing1Words}</b> từ.</p>
    <p>Writing 2: <b data-mock-writing2>${status.writing2Words}</b> từ.</p>
    <p class="question-hint" data-mock-hint>${status.complete
      ? "Đã đủ điều kiện nộp thi thử."
      : "Cần hoàn thành đủ 57 câu trắc nghiệm và mỗi bài viết tối thiểu khoảng 20 từ."}</p>
  `;

  const submit = document.createElement("button");
  submit.type = "button";
  submit.className = "submit";
  submit.dataset.mockSubmitButton = "true";
  submit.disabled = !status.complete || isSubmittingMock;
  submit.textContent = isSubmittingMock ? "Đang chấm thi thử..." : "Nộp thi thử";
  submit.addEventListener("click", () => {
    scoreExam();
  });

  panel.append(submit);
  return panel;
}

function syncMockSubmitPanel() {
  const panel = document.querySelector("[data-mock-submit-panel]");
  if (!panel) return;

  const status = mockCompletionStatus();
  const reading = panel.querySelector("[data-mock-reading]");
  const listening = panel.querySelector("[data-mock-listening]");
  const writing1 = panel.querySelector("[data-mock-writing1]");
  const writing2 = panel.querySelector("[data-mock-writing2]");
  const hint = panel.querySelector("[data-mock-hint]");
  const submit = panel.querySelector("[data-mock-submit-button]");

  if (reading) reading.textContent = `${status.readingDone}/${status.readingTotal}`;
  if (listening) listening.textContent = `${status.listeningDone}/${status.listeningTotal}`;
  if (writing1) writing1.textContent = String(status.writing1Words);
  if (writing2) writing2.textContent = String(status.writing2Words);
  if (hint) {
    hint.textContent = status.complete
      ? "Đã đủ điều kiện nộp thi thử."
      : "Cần hoàn thành đủ 57 câu trắc nghiệm và mỗi bài viết tối thiểu khoảng 20 từ.";
  }
  if (submit) {
    submit.disabled = !status.complete || isSubmittingMock;
    submit.textContent = isSubmittingMock ? "Đang chấm thi thử..." : "Nộp thi thử";
  }
}

function renderAnswerSheet() {
  elements.answerSheet.innerHTML = "";
  elements.submitButton.textContent = isMockExam() ? "Nộp thi thử" : "Nộp bài";
  const mockStatus = isMockExam() ? mockCompletionStatus() : null;
  elements.submitButton.disabled = activeTab === "writing"
    || Boolean(isSubmittingMock)
    || Boolean(isMockExam() && !mockStatus?.complete);

  if (activeTab === "writing") {
    elements.answerHeadTitle.textContent = "Writing";
    elements.progressText.textContent = isMockExam()
      ? `${mockStatus.readingDone}/32 R | ${mockStatus.listeningDone}/25 L | ${mockStatus.writingReady ? "W ok" : "W chưa đủ"}`
      : "2 bài";
    elements.answerSheet.append(renderWritingSidePanel());
    return;
  }

  elements.answerHeadTitle.textContent = activeTab === "listening" ? "Listening Sheet" : "Answer Sheet";
  elements.answerSheet.append(renderQuestionNavigator());

  const ranges = currentRanges();
  const tabResult = resultForTab(activeTab);
  const [start, end] = ranges[activePart];
  const section = document.createElement("div");
  section.className = "answer-section-title";
  section.textContent = `Part ${activePart}: Câu ${start}-${end}`;
  elements.answerSheet.append(section);

  for (let question = start; question <= end; question += 1) {
    const row = document.createElement("div");
    row.className = "answer-row";
    row.dataset.question = String(question);
    const result = tabResult?.byQuestion?.[String(question)] || null;
    if (result) row.classList.add(result.correct ? "correct" : "wrong");

    const number = document.createElement("div");
    number.className = "q-number";
    number.textContent = question;
    row.append(number);

    const choices = activeTab === "listening" ? listeningChoicesForQuestion(question) : choicesForQuestion(question);
    if (choices.length > 4) {
      row.classList.add("compact-answer");
      row.append(createAnswerSelect(question, choices));
    } else if (choices.length > 0) {
      const group = document.createElement("div");
      group.className = "choice-group";
      choices.forEach((choice) => {
        const label = document.createElement("label");
        label.className = "choice";
        const input = document.createElement("input");
        input.type = "radio";
        input.name = `${activeTab}-q${question}`;
        input.value = choice;
        input.dataset.answerFor = String(question);
        input.checked = answerValue(question) === choice;
        input.addEventListener("change", () => {
          setAnswer(question, choice);
          syncAnswerInputs(question, choice);
          if (activeTab === "listening") renderPaper();
        });
        const visible = document.createElement("span");
        visible.textContent = choice;
        label.append(input, visible);
        group.append(label);
      });
      row.append(group);
    } else {
      const input = document.createElement("input");
      input.type = "text";
      input.dataset.answerFor = String(question);
      input.value = answerValue(question);
      input.placeholder = activeTab === "listening" ? "word / number" : "word";
      input.addEventListener("input", () => {
        setAnswer(question, input.value);
        syncAnswerInputs(question, input.value);
      });
      row.append(input);
    }

    elements.answerSheet.append(row);
  }
}

function renderWritingSidePanel() {
  const panel = document.createElement("section");
  panel.className = "writing-side-panel";
  panel.innerHTML = `
    <strong>Writing mode</strong>
    <p>Viết bài ở khung bên trái, sau đó bấm <b>Chấm AI</b> dưới từng bài để xem điểm và gợi ý chỉnh sửa.</p>
    <p class="question-hint">Nút Nộp bài chỉ dùng cho Reading/Listening.</p>
  `;
  return panel;
}

function clearExamResult() {
  if (!examResult) return;
  examResult = null;
  elements.scoreBox.hidden = true;
  elements.scoreBox.innerHTML = "";
  renderAnswerSheet();
  renderPaper();
}

function renderQuestionNavigator() {
  const wrap = document.createElement("section");
  wrap.className = "question-map";

  const title = document.createElement("div");
  title.className = "question-map-title";
  title.textContent = activeTab === "listening" ? "Listening Navigator" : "Question Navigator";
  wrap.append(title);

  const grid = document.createElement("div");
  grid.className = "question-map-grid";
  const tabResult = resultForTab(activeTab);

  for (let question = 1; question <= currentQuestionTotal(); question += 1) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "question-map-button";
    button.dataset.questionMap = String(question);
    button.textContent = String(question);
    button.classList.toggle("answered", Boolean(normalise(answerValue(question))));
    const result = tabResult?.byQuestion?.[String(question)] || null;
    if (result) button.classList.add(result.correct ? "correct" : "wrong");
    const partNumber = activeTab === "listening" ? listeningPartForQuestion(question) : Number(partForQuestion(question));
    button.classList.toggle("current", partNumber === activePart);
    button.addEventListener("click", () => {
      activePart = partNumber;
      elements.scoreBox.hidden = !shouldShowScoreBox();
      render();
      window.scrollTo({ top: 0, behavior: "smooth" });
    });
    grid.append(button);
  }

  wrap.append(grid);
  return wrap;
}

function updateQuestionNavigator() {
  const tabResult = resultForTab(activeTab);
  document.querySelectorAll("[data-question-map]").forEach((button) => {
    const question = button.dataset.questionMap;
    const result = tabResult?.byQuestion?.[question] || null;
    button.classList.toggle("answered", Boolean(normalise(answerValue(question))));
    button.classList.toggle("correct", Boolean(result?.correct));
    button.classList.toggle("wrong", Boolean(result && !result.correct));
    const partNumber = activeTab === "listening"
      ? listeningPartForQuestion(Number(question))
      : Number(partForQuestion(Number(question)));
    button.classList.toggle("current", partNumber === activePart);
  });
}

function updateProgress() {
  if (isMockExam()) {
    const status = mockCompletionStatus();
    syncMockSubmitPanel();
    if (activeTab === "writing") {
      elements.progressText.textContent = `${status.readingDone}/32 R | ${status.listeningDone}/25 L | ${status.writingReady ? "W ok" : "W chưa đủ"}`;
    } else if (activeTab === "listening") {
      elements.progressText.textContent = `${status.listeningDone}/25 câu | R ${status.readingDone}/32 | W ${status.writingReady ? "ok" : "chưa đủ"}`;
    } else {
      elements.progressText.textContent = `${status.readingDone}/32 câu | L ${status.listeningDone}/25 | W ${status.writingReady ? "ok" : "chưa đủ"}`;
    }
    updateQuestionNavigator();
    return;
  }

  if (activeTab === "writing") {
    elements.progressText.textContent = "2 bài";
    return;
  }

  const total = currentQuestionTotal();
  const done = Array.from({ length: total }, (_, index) => index + 1)
    .filter((question) => normalise(answerValue(question))).length;
  elements.progressText.textContent = `${done}/${total} câu`;
  updateQuestionNavigator();
}

function formatReviewOptionText(option) {
  if (!option) return "";
  if (typeof option === "string") return option;
  if (option.detail) return `${option.title}: ${option.detail}`;
  return option.text || option.title || "";
}

function optionMapFromList(options = []) {
  return Object.fromEntries(options.map((option) => [String(option.letter || "").trim(), formatReviewOptionText(option)]));
}

function readingQuestionMeta(questionNumber) {
  const partNumber = Number(partForQuestion(questionNumber));
  const part = activeExam.parts.find((item) => item.number === partNumber);
  if (!part) return null;

  if (partNumber === 1) {
    const question = parsePartOneQuestions(part.lines).find((item) => item.number === questionNumber);
    return question ? {
      prompt: question.promptLines.join(" "),
      options: Object.fromEntries(question.options.map((option) => [option.letter, option.text])),
    } : null;
  }

  if (partNumber === 2) {
    const parsed = parsePartTwo(part.lines);
    const question = parsed.questions.find((item) => item.number === questionNumber);
    return question ? {
      prompt: question.text,
      options: optionMapFromList(parsed.options),
    } : null;
  }

  if (partNumber === 3 || partNumber === 5) {
    const range = partNumber === 3 ? [11, 15] : [21, 26];
    const parsed = parseReadingMcqPart(part.lines, range[0], range[1]);
    const question = parsed?.questions.find((item) => item.number === questionNumber);
    return question ? {
      prompt: question.stem,
      options: Object.fromEntries(question.options.map((option) => [option.letter, option.text])),
    } : null;
  }

  if (partNumber === 4) {
    const parsed = parsePartFour(part.lines);
    return {
      prompt: parsed?.title ? `${parsed.title} - chỗ trống câu ${questionNumber}` : `Chọn câu phù hợp cho chỗ trống ${questionNumber}.`,
      options: optionMapFromList(parsed?.options || []),
    };
  }

  return null;
}

function listeningQuestionMeta(questionNumber) {
  const partNumber = listeningPartForQuestion(questionNumber);
  const part = listeningParts().find((item) => item.number === partNumber);
  const question = part ? listeningQuestions(part).find((item) => item.number === questionNumber) : null;
  return question ? {
    prompt: question.stem,
    options: Object.fromEntries((question.options || []).map((option) => [option.letter, option.text || option.image || ""])),
  } : null;
}

function answerChoiceLabel(answer, options = {}) {
  const raw = String(answer || "").trim();
  if (!raw || raw === "(chưa làm)") return "(chưa làm)";
  const detail = options[raw];
  return detail ? `${raw}. ${detail}` : raw;
}

function enrichReviewResult(result, meta) {
  const options = meta?.options || {};
  return {
    ...result,
    prompt: meta?.prompt || "",
    userChoiceText: answerChoiceLabel(result.userAnswer, options),
    correctChoiceText: answerChoiceLabel(result.correctAnswer, options),
    reviewDetail: result.reviewDetail || "",
  };
}

function renderReviewItem(result) {
  const item = document.createElement("article");
  item.className = `answer-review-item ${result.correct ? "correct" : "wrong"}`;

  const status = result.correct ? "Đúng" : "Sai";
  item.innerHTML = `
    <div class="review-status-row">
      <strong>Câu ${result.question}</strong>
      <span class="review-status">${status}</span>
    </div>
    ${result.prompt ? `<div class="review-question-copy"><strong>Nội dung câu:</strong><p>${escapeHtml(result.prompt)}</p></div>` : ""}
    <div class="review-answer-line">
      <span>Bạn chọn: <strong>${escapeHtml(result.userChoiceText || result.userAnswer)}</strong></span>
      <span>Đáp án đúng: <strong>${escapeHtml(result.correctChoiceText || result.correctAnswer)}</strong></span>
    </div>
    <div class="review-detail-block">
      <strong>Vì sao đáp án này đúng</strong>
      <p>${escapeHtml(result.explanation)}</p>
      ${result.reviewDetail ? `<p class="review-extra-detail">${escapeHtml(result.reviewDetail)}</p>` : ""}
    </div>
  `;

  return item;
}

function renderPartReview(partNumber, reviewResult = resultForTab("reading")) {
  const [start, end] = partRanges[partNumber];
  const section = document.createElement("section");
  section.className = "answer-review-panel";

  const heading = document.createElement("div");
  heading.className = "answer-review-heading";
  heading.innerHTML = `<h3>Review Part ${partNumber}</h3><span>Câu ${start}-${end}</span>`;
  section.append(heading);

  for (let question = start; question <= end; question += 1) {
    const result = reviewResult?.byQuestion?.[String(question)];
    if (!result) continue;
    section.append(renderReviewItem(enrichReviewResult(result, readingQuestionMeta(question))));
  }

  return section;
}

function renderListeningPartReview(partNumber, reviewResult = resultForTab("listening")) {
  const [start, end] = listeningPartRanges[partNumber];
  const section = document.createElement("section");
  section.className = "answer-review-panel listening-review";

  const heading = document.createElement("div");
  heading.className = "answer-review-heading";
  heading.innerHTML = `<h3>Review Listening Part ${partNumber}</h3><span>Câu ${start}-${end}</span>`;
  section.append(heading);

  for (let question = start; question <= end; question += 1) {
    const result = reviewResult?.byQuestion?.[String(question)];
    if (!result) continue;
    section.append(renderReviewItem(enrichReviewResult(result, listeningQuestionMeta(question))));
  }

  return section;
}

async function scoreExam() {
  if (isMockExam()) {
    await scoreMockExam();
    return;
  }

  if (activeTab === "listening") {
    scoreListeningExam();
    return;
  }

  const readingResult = buildReadingResult();
  examResult = readingResult;
  renderAnswerSheet();
  renderPaper();
  renderScore(examResult);
  updateProgress();
}

function buildReadingResult() {
  const partScores = {};
  const mistakes = [];
  const byQuestion = {};
  let total = 0;

  for (let question = 1; question <= 32; question += 1) {
    const result = resultForQuestion(question);
    byQuestion[String(question)] = result;
    const correct = result.correct;
    const part = partForQuestion(question);
    partScores[part] ||= { correct: 0, total: 0 };
    partScores[part].total += 1;

    if (correct) {
      total += 1;
      partScores[part].correct += 1;
    } else {
      mistakes.push(result);
    }
  }

  return { mode: "reading", total, totalQuestions: 32, partScores, mistakes, byQuestion };
}

function scoreListeningExam() {
  const listeningResult = buildListeningResult();
  if (!listeningResult) {
    renderListeningMissingScore();
    return;
  }

  examResult = listeningResult;
  renderAnswerSheet();
  renderPaper();
  renderScore(examResult);
  updateProgress();
}

function buildListeningResult() {
  const answerMap = activeExam.listening?.answers || {};
  if (!Object.keys(answerMap).length) {
    return null;
  }

  const partScores = {};
  const mistakes = [];
  const byQuestion = {};
  let total = 0;

  for (let question = 1; question <= 25; question += 1) {
    const result = resultForListeningQuestion(question);
    byQuestion[String(question)] = result;
    const part = listeningPartForQuestion(question);
    partScores[part] ||= { correct: 0, total: 0 };
    partScores[part].total += 1;

    if (result.correct) {
      total += 1;
      partScores[part].correct += 1;
    } else {
      mistakes.push(result);
    }
  }

  return { mode: "listening", total, totalQuestions: 25, partScores, mistakes, byQuestion };
}

function mockIncompleteMessage(status) {
  const messages = [];
  if (status.readingDone < status.readingTotal) {
    messages.push(`Reading còn ${status.readingTotal - status.readingDone} câu chưa làm.`);
  }
  if (status.listeningDone < status.listeningTotal) {
    messages.push(`Listening còn ${status.listeningTotal - status.listeningDone} câu chưa làm.`);
  }
  if (status.writing1Words < 20) {
    messages.push(`Writing 1 mới có ${status.writing1Words} từ.`);
  }
  if (status.writing2Words < 20) {
    messages.push(`Writing 2 mới có ${status.writing2Words} từ.`);
  }
  return messages.join("\n");
}

async function ensureWritingScore(name, label) {
  const saved = answers[writingScoreKey(name)];
  if (saved?.ok) return saved;

  const answer = compactText(answers[name] || "");
  if (answer.split(/\s+/).filter(Boolean).length < 20) {
    throw new Error(`${label} chưa đủ độ dài để chấm.`);
  }

  const response = await fetch("/api/admin/grade-writing", {
    method: "POST",
    headers: {
      "Accept": "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      examTitle: activeExam.title,
      label,
      task: writingTaskText(name),
      answer,
    }),
  });

  const score = await response.json().catch(() => null);
  if (!response.ok || !score?.ok) {
    throw new Error(score?.error || `Không chấm được ${label}.`);
  }

  answers[writingScoreKey(name)] = score;
  saveAnswers();
  return score;
}

async function scoreMockExam() {
  const status = mockCompletionStatus();
  if (!status.complete) {
    window.alert(`Chưa thể nộp thi thử.\n\n${mockIncompleteMessage(status)}`);
    return;
  }

  const listeningResult = buildListeningResult();
  if (!listeningResult) {
    renderListeningMissingScore();
    return;
  }

  isSubmittingMock = true;
  render();

  try {
    const readingResult = buildReadingResult();
    const [writing1Score, writing2Score] = await Promise.all([
      ensureWritingScore("writing1", "Question 1 - Email"),
      ensureWritingScore("writing2", "Question 2 hoặc Question 3"),
    ]);

    const writingTotal = Number(writing1Score.total || 0) + Number(writing2Score.total || 0);
    examResult = {
      mode: "mock",
      total: readingResult.total + listeningResult.total + writingTotal,
      totalQuestions: readingResult.totalQuestions + listeningResult.totalQuestions + 40,
      reading: readingResult,
      listening: listeningResult,
      writing: {
        mode: "writing",
        total: writingTotal,
        totalQuestions: 40,
        tasks: [
          { label: "Question 1 - Email", score: writing1Score },
          { label: "Question 2 hoặc Question 3", score: writing2Score },
        ],
      },
    };
    if (activeTab === "writing") setActiveTabView("reading");
    else {
      renderAnswerSheet();
      renderPaper();
    }
    renderScore(examResult);
    updateProgress();
  } catch (error) {
    window.alert(`Nộp thi thử chưa thành công.\n\n${error.message}`);
  } finally {
    isSubmittingMock = false;
    render();
  }
}

function resultForQuestion(question) {
  const key = String(question);
  const item = activeExam.answers[key];
  const userAnswer = answerValue(question, "reading");
  const accepted = (item?.accepted || [item?.answer]).map(normalise).filter(Boolean);
  const correct = accepted.includes(normalise(userAnswer));

  return {
    question,
    part: Number(partForQuestion(question)),
    correct,
    userAnswer: userAnswer || "(chưa làm)",
    correctAnswer: item?.answer || "",
    explanation: item?.explanation || "Chưa có giải thích cho câu này.",
    reviewDetail: item?.reviewDetail || "",
  };
}

function resultForListeningQuestion(question) {
  const key = String(question);
  const item = activeExam.listening?.answers?.[key];
  const userAnswer = answerValue(question, "listening");
  const accepted = (item?.accepted || [item?.answer]).map(normalise).filter(Boolean);
  const correct = accepted.includes(normalise(userAnswer));

  return {
    question,
    part: listeningPartForQuestion(question),
    correct,
    userAnswer: userAnswer || "(chưa làm)",
    correctAnswer: item?.answer || "",
    explanation: item?.explanation || "Chưa có giải thích cho câu này.",
    reviewDetail: item?.reviewDetail || "",
  };
}

function renderListeningMissingScore() {
  elements.scoreBox.hidden = false;
  elements.scoreBox.innerHTML = `
    <div class="score-main">Listening</div>
    <p class="question-hint">Chưa có đáp án đúng cho phần nghe trong data nên chưa thể chấm điểm.</p>
    <p class="question-hint">Bạn vẫn có thể dùng giao diện để luyện/nhập đáp án; khi thêm audio và answer key, nút Nộp bài sẽ chấm như Reading.</p>
  `;
}

function renderScore(result) {
  if (result.mode === "mock") {
    renderMockScore(result);
    return;
  }

  elements.scoreBox.hidden = false;
  elements.scoreBox.innerHTML = "";

  const main = document.createElement("div");
  main.className = "score-main";
  main.textContent = `${result.total}/${result.totalQuestions || 32}`;
  elements.scoreBox.append(main);

  const ranges = result.mode === "listening" ? listeningPartRanges : partRanges;
  Object.keys(ranges).forEach((part) => {
    const line = document.createElement("div");
    line.className = "part-score";
    const score = result.partScores[part] || { correct: 0, total: 0 };
    line.innerHTML = `<span>Part ${part}</span><strong>${score.correct}/${score.total}</strong>`;
    elements.scoreBox.append(line);
  });

  const title = document.createElement("p");
  title.className = "question-hint";
  title.textContent = result.mistakes.length
    ? "Bấm từng part để xem đáp án đúng và giải thích."
    : `Bạn làm đúng toàn bộ phần ${result.mode === "listening" ? "Listening" : "Reading"}.`;
  elements.scoreBox.append(title);

  result.mistakes.slice(0, 12).forEach((mistake) => {
    const item = document.createElement("div");
    item.className = "mistake";
    item.innerHTML = `
      <strong>Câu ${mistake.question}</strong>
      <p>Bạn chọn: ${escapeHtml(mistake.userAnswer)} | Đáp án: ${escapeHtml(mistake.correctAnswer)}</p>
      <p>${escapeHtml(mistake.explanation)}</p>
    `;
    elements.scoreBox.append(item);
  });

  if (result.mistakes.length > 12) {
    const more = document.createElement("p");
    more.className = "question-hint";
    more.textContent = `Còn ${result.mistakes.length - 12} câu sai nữa.`;
    elements.scoreBox.append(more);
  }
}

function renderMockScore(result) {
  elements.scoreBox.hidden = false;
  elements.scoreBox.innerHTML = "";

  const main = document.createElement("div");
  main.className = "score-main";
  main.textContent = `${result.total}/${result.totalQuestions}`;
  elements.scoreBox.append(main);

  const sections = [
    ["Reading", result.reading.total, result.reading.totalQuestions],
    ["Listening", result.listening.total, result.listening.totalQuestions],
    ["Writing", result.writing.total, result.writing.totalQuestions],
  ];

  sections.forEach(([label, score, total]) => {
    const line = document.createElement("div");
    line.className = "part-score";
    line.innerHTML = `<span>${label}</span><strong>${score}/${total}</strong>`;
    elements.scoreBox.append(line);
  });

  result.writing.tasks.forEach((task) => {
    const item = document.createElement("div");
    item.className = "mistake";
    item.innerHTML = `
      <strong>${escapeHtml(task.label)}</strong>
      <p>${escapeHtml(task.score.total)}/20 | Level ${escapeHtml(task.score.level || "N/A")}</p>
      <p>${escapeHtml(task.score.note || task.score.suggestion || "Đã chấm Writing.")}</p>
    `;
    elements.scoreBox.append(item);
  });

  const hint = document.createElement("p");
  hint.className = "question-hint";
  hint.textContent = "Bạn có thể chuyển lại từng tab để xem Reading/Listening đã tô màu đúng sai và kết quả chấm Writing.";
  elements.scoreBox.append(hint);
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function resetExam() {
  answers = {};
  examResult = null;
  localStorage.removeItem(storageKey());
  elements.scoreBox.hidden = true;
  elements.scoreBox.innerHTML = "";
  render();
}

async function loadExamData() {
  const fallback = data?.tests?.length ? data : (window.EXAM_DATA || { tests: [] });

  try {
    const response = await fetch(`/api/exam-data?ts=${Date.now()}`, {
      cache: "no-store",
      headers: { "Accept": "application/json" },
    });

    if (!response.ok) {
      throw new Error("Không kết nối được Python backend.");
    }

    const result = await readApiJson(response);
    if (!result.ok || !result.data?.tests?.length) {
      throw new Error(result.error || result.warning || "Excel chưa trả về dữ liệu đề thi.");
    }

    data = result.data;
    dataSource = result.source || "Excel";
    return result;
  } catch (error) {
    if (fallback.tests?.length) {
      data = fallback;
      dataSource = "data.js fallback";
      return {
        ok: true,
        source: dataSource,
        warning: error.message,
        data,
      };
    }
    throw error;
  }
}

function populateTestSelect(preferredId = "") {
  elements.testSelect.innerHTML = "";
  data.tests.forEach((test, index) => {
    const option = document.createElement("option");
    option.value = test.id;
    option.textContent = test.title;
    elements.testSelect.append(option);
    if ((preferredId && preferredId === test.id) || (!preferredId && index === 0)) {
      option.selected = true;
    }
  });
}

function renderDataLoadError(error) {
  elements.paperTitle.textContent = "Chưa đọc được Excel";
  elements.paperMeta.textContent = "Hãy mở app bằng data-manager.bat trong folder exam-app-excel-live.";
  elements.paperContent.innerHTML = `
    <section class="data-load-card">
      <h3>Python backend chưa sẵn sàng</h3>
      <p>Giao diện mới đọc dữ liệu trực tiếp từ <strong>exports/exam-data-master.xlsx</strong> thông qua Python.</p>
      <p>Mở file <strong>data-manager.bat</strong>, sau đó tải lại trang này.</p>
      <p class="question-hint">Chi tiết: ${escapeHtml(error.message)}</p>
    </section>
  `;
  elements.answerSheet.innerHTML = "";
  elements.progressText.textContent = "0 câu";
  elements.submitButton.disabled = true;
}

async function readApiJson(response) {
  const text = await response.text();
  try {
    return JSON.parse(text);
  } catch {
    if (text.trim().startsWith("<")) {
      throw new Error(
        "API đang trả về HTML thay vì JSON. Hãy đóng cửa sổ data-manager cũ, chạy lại "
        + "D:\\ENGLISH\\exam-app-excel-live\\data-manager.bat rồi mở "
        + "http://127.0.0.1:8788/index.html"
      );
    }
    throw new Error(`API trả dữ liệu không hợp lệ: ${text.slice(0, 180)}`);
  }
}

async function syncDataFromExcel() {
  if (!elements.syncExcelButton) return;
  const originalText = elements.syncExcelButton.textContent;
  const selectedId = elements.testSelect.value;
  elements.syncExcelButton.disabled = true;
  elements.syncExcelButton.textContent = "Đang đọc Excel...";

  try {
    const result = await loadExamData();
    populateTestSelect(selectedId);
    const nextTest = data.tests.find((item) => item.id === elements.testSelect.value) || data.tests[0];
    if (nextTest) {
      setActiveExam(originalExam(nextTest));
    }

    const details = [
      `Nguồn: ${result.source || dataSource}`,
      Number.isFinite(result.rows) ? `Số dòng Excel: ${result.rows}` : "",
    ].filter(Boolean).join("\n");
    window.alert(`Đã đọc lại dữ liệu từ Excel.\n\n${details}`);
  } catch (error) {
    window.alert(
      "Chưa đọc được dữ liệu từ Excel.\n\n"
      + "Hãy mở app bằng file data-manager.bat trong folder exam-app-excel-live rồi bấm lại nút này.\n\n"
      + `Chi tiết: ${error.message}`
    );
  } finally {
    elements.syncExcelButton.disabled = false;
    elements.syncExcelButton.textContent = originalText;
  }
}

function startTimer() {
  clearInterval(timerId);
  timerId = setInterval(() => {
    const seconds = Math.floor((Date.now() - startedAt) / 1000);
    const minutes = String(Math.floor(seconds / 60)).padStart(2, "0");
    const rest = String(seconds % 60).padStart(2, "0");
    elements.timer.textContent = `${minutes}:${rest}`;
  }, 1000);
}

async function init() {
  try {
    await loadExamData();
  } catch (error) {
    renderDataLoadError(error);
    startTimer();
    return;
  }

  populateTestSelect();
  elements.testSelect.addEventListener("change", () => {
    const test = data.tests.find((item) => item.id === elements.testSelect.value);
    setActiveExam(originalExam(test));
  });

  elements.mixButton.addEventListener("click", () => {
    setActiveExam(mixedExam());
  });

  elements.mockButton?.addEventListener("click", () => {
    const tests = eligibleTests();
    if (!tests.length) {
      window.alert("Chưa đủ dữ liệu để tạo thi thử tổng hợp.");
      return;
    }
    setActiveExam(mockExam());
    setActiveTabView("reading");
  });

  elements.resetButton.addEventListener("click", resetExam);
  elements.syncExcelButton?.addEventListener("click", syncDataFromExcel);
  elements.submitButton.addEventListener("click", scoreExam);

  elements.tabs.forEach((tab) => {
    tab.addEventListener("click", () => {
      setActiveTabView(tab.dataset.tab);
    });
  });

  const first = data.tests[0];
  if (first) setActiveExam(originalExam(first));
  startTimer();
}

init();
