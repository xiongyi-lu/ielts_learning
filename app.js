;(function (root) {
  function normalizeAnswer(value) {
    return String(value ?? "").trim().toLowerCase().replace(/\s+/g, " ")
  }

  function splitNormalizedAnswer(value) {
    return normalizeAnswer(value).split(" ").filter(Boolean)
  }

  function findFirstMismatchTokenIndex(expectedTokens, inputTokens) {
    const maxLength = Math.max(expectedTokens.length, inputTokens.length)
    for (let index = 0; index < maxLength; index += 1) {
      if ((expectedTokens[index] ?? "") !== (inputTokens[index] ?? "")) return index
    }
    return -1
  }

  function judgeAnswer(expected, input) {
    const normalizedExpected = normalizeAnswer(expected)
    const normalizedInput = normalizeAnswer(input)
    const expectedTokens = splitNormalizedAnswer(expected)
    const inputTokens = splitNormalizedAnswer(input)
    const isCorrect = normalizedExpected === normalizedInput
    return {
      expected,
      input,
      normalizedExpected,
      normalizedInput,
      isCorrect,
      firstMismatchTokenIndex: isCorrect ? -1 : findFirstMismatchTokenIndex(expectedTokens, inputTokens),
    }
  }

  function addMistake(mistakes, itemId) {
    const existing = Array.isArray(mistakes) ? mistakes : []
    if (!itemId || existing.includes(itemId)) return existing.slice()
    return [...existing, itemId]
  }

  function filterVocabulary(vocabulary, options = {}) {
    const scene = options.scene ?? "all"
    const reviewMode = options.reviewMode ?? "all"
    const mistakes = Array.isArray(options.mistakes) ? options.mistakes : []
    const mistakeSet = new Set(mistakes)
    return (Array.isArray(vocabulary) ? vocabulary : []).filter((item) => {
      const sceneMatches = scene === "all" || item.scene === scene
      const reviewMatches = reviewMode !== "mistakes" || mistakeSet.has(item.id)
      return sceneMatches && reviewMatches
    })
  }

  function filterByMistakes(items, reviewMode, mistakes) {
    const mistakeSet = new Set(Array.isArray(mistakes) ? mistakes : [])
    return (Array.isArray(items) ? items : []).filter((item) => {
      return reviewMode !== "mistakes" || mistakeSet.has(item.id)
    })
  }

  function summarizeQuizRound(results) {
    const safeResults = Array.isArray(results) ? results : []
    const wrongIds = []
    const seen = new Set()
    let correct = 0
    for (const result of safeResults) {
      if (result?.isCorrect) {
        correct += 1
        continue
      }
      const wrongId = result?.itemId ?? result?.id
      if (wrongId != null && !seen.has(wrongId)) {
        seen.add(wrongId)
        wrongIds.push(wrongId)
      }
    }
    return { total: safeResults.length, correct, incorrect: safeResults.length - correct, wrongIds }
  }

  function createRevealState(item) {
    return {
      itemId: item?.id ?? null,
      answer: item?.answer ?? item?.english ?? "",
      needsRetype: true,
    }
  }

  function canAdvanceFromSubmission({ revealState, isCorrect } = {}) {
    return !revealState?.needsRetype || Boolean(isCorrect)
  }

  function buildChoiceOptions(items, currentItem) {
    const options = []
    const seen = new Set()
    const currentAnswer = String(currentItem?.answer ?? "")
    if (currentAnswer) {
      options.push(currentAnswer)
      seen.add(normalizeAnswer(currentAnswer))
    }
    for (const item of Array.isArray(items) ? items : []) {
      const answer = String(item?.answer ?? "")
      const key = normalizeAnswer(answer)
      if (!answer || seen.has(key)) continue
      seen.add(key)
      options.push(answer)
      if (options.length >= 4) break
    }
    return options
  }

  function resolveSynonymQuestionType(mode, answered) {
    if (mode === "choice" || mode === "input") return mode
    return answered % 2 === 0 ? "choice" : "input"
  }

  const coreApi = {
    normalizeAnswer,
    judgeAnswer,
    filterVocabulary,
    addMistake,
    summarizeQuizRound,
    createRevealState,
    canAdvanceFromSubmission,
    buildChoiceOptions,
    resolveSynonymQuestionType,
  }
  root.IELTSVocabPracticeCore = coreApi
  if (typeof module !== "undefined" && module.exports) module.exports = coreApi

  const STORAGE_KEY = "ielts-vocab-typing-site"
  const QUIZ_SIZE = 5
  const AUTO_ADVANCE_MS = 850

  const CATEGORY_LABELS = {
    people: "人物",
    property: "房屋",
    cost: "费用",
    paperwork: "手续",
    rooms: "房间",
    appliance: "设备",
    food: "食物",
    diet: "饮食",
    venue: "地点",
    service: "服务",
    attraction: "景点",
    nature: "自然",
    transport: "交通",
    activity: "活动",
    event: "活动",
    landmark: "地标",
    music: "音乐",
    instrument: "乐器",
    fitness: "健身",
    sports: "运动",
    banking: "银行",
    currency: "货币",
    car: "汽车",
    education: "教育",
    class: "课程",
    course: "课程",
    campus: "校园",
    assignment: "作业",
    research: "研究",
    deadline: "截止",
    format: "格式",
    assessment: "考核",
    library: "图书馆",
  }

  function defaultState() {
    return {
      practiceModule: "word",
      scene: "all",
      mode: "drill",
      reviewMode: "all",
      deckCursor: 0,
      answered: 0,
      correct: 0,
      streak: 0,
      totalResponseMs: 0,
      timedAnswers: 0,
      mistakes: [],
      revealState: null,
      lastQuizSummary: null,
      roundQuestions: [],
      roundIndex: 0,
      quizRound: [],
      roundComplete: false,
      synonymMode: "mixed",
      synonymReviewMode: "all",
      synonymDeckCursor: 0,
      synonymAnswered: 0,
      synonymCorrect: 0,
      synonymTotalResponseMs: 0,
      synonymTimedAnswers: 0,
      synonymMistakes: [],
      feedback: null,
      answerValue: "",
      transitioning: false,
      questionStartedAt: 0,
    }
  }

  const app = { ready: false, timer: null, state: defaultState(), el: null }

  function vocab() {
    return Array.isArray(root.VOCAB_DATA) ? root.VOCAB_DATA : []
  }

  function synonyms() {
    return Array.isArray(root.SYNONYM_DATA) ? root.SYNONYM_DATA : []
  }

  function esc(value) {
    return String(value ?? "").replace(/[&<>"']/g, (ch) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]),
    )
  }

  function toInt(value, fallback) {
    const n = Number(value)
    return Number.isFinite(n) && n >= 0 ? Math.floor(n) : fallback
  }

  function cleanSummary(summary) {
    if (!summary || typeof summary !== "object") return null
    return {
      total: toInt(summary.total, 0),
      correct: toInt(summary.correct, 0),
      incorrect: toInt(summary.incorrect, 0),
      wrongIds: Array.isArray(summary.wrongIds) ? summary.wrongIds.filter(Boolean) : [],
    }
  }

  function loadState() {
    try {
      if (typeof localStorage === "undefined") return defaultState()
      const raw = localStorage.getItem(STORAGE_KEY)
      if (!raw) return defaultState()
      const state = { ...defaultState(), ...JSON.parse(raw) }
      state.practiceModule = state.practiceModule === "synonym" ? "synonym" : "word"
      state.mode = state.mode === "quiz" ? "quiz" : "drill"
      state.reviewMode = state.reviewMode === "mistakes" ? "mistakes" : "all"
      state.synonymMode =
        state.synonymMode === "choice" || state.synonymMode === "input" ? state.synonymMode : "mixed"
      state.synonymReviewMode = state.synonymReviewMode === "mistakes" ? "mistakes" : "all"
      state.deckCursor = toInt(state.deckCursor, 0)
      state.synonymDeckCursor = toInt(state.synonymDeckCursor, 0)
      state.answered = toInt(state.answered, 0)
      state.correct = toInt(state.correct, 0)
      state.streak = toInt(state.streak, 0)
      state.totalResponseMs = toInt(state.totalResponseMs, 0)
      state.timedAnswers = toInt(state.timedAnswers, 0)
      state.synonymAnswered = toInt(state.synonymAnswered, 0)
      state.synonymCorrect = toInt(state.synonymCorrect, 0)
      state.synonymTotalResponseMs = toInt(state.synonymTotalResponseMs, 0)
      state.synonymTimedAnswers = toInt(state.synonymTimedAnswers, 0)
      state.mistakes = Array.isArray(state.mistakes) ? state.mistakes.filter(Boolean) : []
      state.synonymMistakes = Array.isArray(state.synonymMistakes) ? state.synonymMistakes.filter(Boolean) : []
      state.revealState =
        state.revealState && typeof state.revealState === "object"
          ? {
              itemId: state.revealState.itemId ?? null,
              answer: String(state.revealState.answer ?? ""),
              needsRetype: state.revealState.needsRetype !== false,
            }
          : null
      state.lastQuizSummary = cleanSummary(state.lastQuizSummary)
      return state
    } catch (error) {
      return defaultState()
    }
  }

  function hasStoredState() {
    try {
      if (typeof localStorage === "undefined") return false
      return localStorage.getItem(STORAGE_KEY) != null
    } catch (error) {
      return false
    }
  }

  function saveState() {
    try {
      if (typeof localStorage === "undefined") return
      localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({
          practiceModule: app.state.practiceModule,
          scene: app.state.scene,
          mode: app.state.mode,
          reviewMode: app.state.reviewMode,
          deckCursor: app.state.deckCursor,
          answered: app.state.answered,
          correct: app.state.correct,
          streak: app.state.streak,
          totalResponseMs: app.state.totalResponseMs,
          timedAnswers: app.state.timedAnswers,
          mistakes: app.state.mistakes,
          revealState: app.state.revealState,
          lastQuizSummary: app.state.lastQuizSummary,
          synonymMode: app.state.synonymMode,
          synonymReviewMode: app.state.synonymReviewMode,
          synonymDeckCursor: app.state.synonymDeckCursor,
          synonymAnswered: app.state.synonymAnswered,
          synonymCorrect: app.state.synonymCorrect,
          synonymTotalResponseMs: app.state.synonymTotalResponseMs,
          synonymTimedAnswers: app.state.synonymTimedAnswers,
          synonymMistakes: app.state.synonymMistakes,
        }),
      )
    } catch (error) {}
  }

  function sceneOptions() {
    const seen = new Set(["all"])
    const out = [{ value: "all", label: "全部场景" }]
    for (const item of vocab()) {
      if (!item?.scene || seen.has(item.scene)) continue
      seen.add(item.scene)
      out.push({ value: item.scene, label: item.scene })
    }
    return out
  }

  function sceneDisplayLabel(value) {
    return sceneOptions().find((item) => item.value === value)?.label ?? value
  }

  function categoryDisplayLabel(category) {
    return CATEGORY_LABELS[category] ?? category
  }

  function reviewModeDisplayLabel(mode) {
    return mode === "mistakes" ? "错题" : "全部"
  }

  function formatMs(ms) {
    return ms <= 0 ? "0.0s" : `${(ms / 1000).toFixed(ms >= 10000 ? 0 : 1)}s`
  }

  function clampCursor(cursor, total) {
    return total ? cursor % total : 0
  }

  function clearTimer() {
    if (app.timer != null) {
      clearTimeout(app.timer)
      app.timer = null
    }
  }

  function currentWordList() {
    return filterVocabulary(vocab(), {
      scene: app.state.scene,
      reviewMode: app.state.reviewMode,
      mistakes: app.state.mistakes,
    })
  }

  function currentSynonymList() {
    return filterByMistakes(synonyms(), app.state.synonymReviewMode, app.state.synonymMistakes)
  }

  function currentWordQuestion() {
    const list = currentWordList()
    if (!list.length) return null
    if (app.state.mode === "quiz") {
      if (app.state.roundComplete) return null
      return app.state.roundQuestions[app.state.roundIndex] ?? null
    }
    return list[clampCursor(app.state.deckCursor, list.length)] ?? null
  }

  function currentSynonymQuestion() {
    const list = currentSynonymList()
    if (!list.length) return null
    return list[clampCursor(app.state.synonymDeckCursor, list.length)] ?? null
  }

  function currentQuestion() {
    return app.state.practiceModule === "synonym" ? currentSynonymQuestion() : currentWordQuestion()
  }

  function currentSynonymQuestionType() {
    return resolveSynonymQuestionType(app.state.synonymMode, app.state.synonymAnswered)
  }

  function getActiveRevealState(question = currentQuestion(), revealState = app.state.revealState) {
    if (!revealState?.needsRetype) return null
    if (!question || question.id !== revealState.itemId) return null
    return revealState
  }

  function makeWordRoundQuestions(startCursor) {
    const list = currentWordList()
    if (!list.length) return []
    const out = []
    for (let index = 0; index < QUIZ_SIZE; index += 1) {
      out.push(list[(startCursor + index) % list.length])
    }
    return out
  }

  function resetTransientState() {
    clearTimer()
    app.state.feedback = null
    app.state.transitioning = false
    app.state.answerValue = ""
    app.state.revealState = null
    app.state.questionStartedAt = Date.now()
  }

  function startWordDrill(resetCursor, preserveRevealState = false) {
    const savedRevealState = preserveRevealState ? app.state.revealState : null
    resetTransientState()
    app.state.roundComplete = false
    app.state.roundQuestions = []
    app.state.roundIndex = 0
    app.state.quizRound = []
    const list = currentWordList()
    app.state.deckCursor = !list.length || resetCursor ? 0 : clampCursor(app.state.deckCursor, list.length)
    app.state.revealState = getActiveRevealState(currentWordQuestion(), savedRevealState)
    if (app.state.revealState) {
      app.state.feedback = { type: "reveal", expected: app.state.revealState.answer }
    }
    saveState()
    render()
  }

  function startWordQuiz(resetCursor, preserveRevealState = false) {
    const savedRevealState = preserveRevealState ? app.state.revealState : null
    resetTransientState()
    app.state.roundComplete = false
    app.state.roundIndex = 0
    app.state.quizRound = []
    app.state.lastQuizSummary = null
    const list = currentWordList()
    if (!list.length) {
      app.state.roundQuestions = []
      app.state.deckCursor = 0
    } else {
      app.state.deckCursor = resetCursor ? 0 : clampCursor(app.state.deckCursor, list.length)
      app.state.roundQuestions = makeWordRoundQuestions(app.state.deckCursor)
    }
    app.state.revealState = getActiveRevealState(currentWordQuestion(), savedRevealState)
    if (app.state.revealState) {
      app.state.feedback = { type: "reveal", expected: app.state.revealState.answer }
    }
    saveState()
    render()
  }

  function startSynonym(resetCursor, preserveRevealState = false) {
    const savedRevealState = preserveRevealState ? app.state.revealState : null
    resetTransientState()
    const list = currentSynonymList()
    app.state.synonymDeckCursor = !list.length || resetCursor ? 0 : clampCursor(app.state.synonymDeckCursor, list.length)
    if (currentSynonymQuestionType() === "input") {
      app.state.revealState = getActiveRevealState(currentSynonymQuestion(), savedRevealState)
      if (app.state.revealState) {
        app.state.feedback = { type: "reveal", expected: app.state.revealState.answer, chinese: currentSynonymQuestion()?.chinese }
      }
    }
    saveState()
    render()
  }

  function restartFromControls(preserveRevealState = false) {
    const validScenes = new Set(sceneOptions().map((item) => item.value))
    if (!validScenes.has(app.state.scene)) app.state.scene = "all"
    if (app.state.practiceModule === "synonym") {
      startSynonym(true, preserveRevealState)
      return
    }
    if (app.state.mode === "quiz") {
      startWordQuiz(true, preserveRevealState)
      return
    }
    startWordDrill(true, preserveRevealState)
  }

  function renderFeedback(feedback) {
    if (!feedback) {
      return `<div class="feedback neutral"><p class="feedback-title">准备开始</p><p class="feedback-body">输入答案后按 Enter，或点击“提交”。跳过会把这题加入错题本。</p></div>`
    }
    if (feedback.type === "summary") {
      return `<div class="feedback neutral"><p class="feedback-title">本轮完成</p><p class="feedback-body">${esc(feedback.message)}</p></div>`
    }
    if (feedback.type === "reveal") {
      return `<div class="feedback warning"><p class="feedback-title">已显示答案</p><p class="feedback-body">标准答案：${esc(feedback.expected)}${feedback.chinese ? `；中文解释：${esc(feedback.chinese)}` : ""}。请你再自己输入一遍，答对后才能进入下一题。</p></div>`
    }
    if (feedback.type === "retype") {
      return `<div class="feedback warning"><p class="feedback-title">需要重输</p><p class="feedback-body">${esc(feedback.message)}</p></div>`
    }
    const className = feedback.isCorrect ? "success" : "danger"
    const title = feedback.isCorrect ? "回答正确" : feedback.skipped ? "已跳过" : "回答错误"
    const body = feedback.isCorrect
      ? `标准答案：${feedback.expected}${feedback.chinese ? `；中文解释：${feedback.chinese}` : ""}`
      : feedback.skipped
      ? `标准答案：${feedback.expected}${feedback.chinese ? `；中文解释：${feedback.chinese}` : ""}`
      : `你的答案：${feedback.input || " "}；标准答案：${feedback.expected}${feedback.chinese ? `；中文解释：${feedback.chinese}` : ""}`
    return `<div class="feedback ${className}"><p class="feedback-title">${esc(title)}</p><p class="feedback-body">${esc(body)}</p></div>`
  }

  function renderControls() {
    const moduleControl = `
      <label class="control-group">
        <span class="control-label">模块</span>
        <select class="control-select" data-control="practiceModule">
          <option value="word"${app.state.practiceModule === "word" ? " selected" : ""}>单词练习</option>
          <option value="synonym"${app.state.practiceModule === "synonym" ? " selected" : ""}>同义替换</option>
        </select>
      </label>
    `

    if (app.state.practiceModule === "synonym") {
      return `
        <div class="control-grid control-grid-wide">
          ${moduleControl}
          <label class="control-group">
            <span class="control-label">题型</span>
            <select class="control-select" data-control="synonymMode">
              <option value="choice"${app.state.synonymMode === "choice" ? " selected" : ""}>选择题</option>
              <option value="input"${app.state.synonymMode === "input" ? " selected" : ""}>输入题</option>
              <option value="mixed"${app.state.synonymMode === "mixed" ? " selected" : ""}>混合模式</option>
            </select>
          </label>
          <label class="control-group">
            <span class="control-label">范围</span>
            <select class="control-select" data-control="synonymReviewMode">
              <option value="all"${app.state.synonymReviewMode === "all" ? " selected" : ""}>全部题目</option>
              <option value="mistakes"${app.state.synonymReviewMode === "mistakes" ? " selected" : ""}>错题复习</option>
            </select>
          </label>
          <p class="control-note">同义替换模块已经带中文解释，做题时、看反馈时和复习错题时都能看到。</p>
        </div>
      `
    }

    return `
      <div class="control-grid control-grid-wide">
        ${moduleControl}
        <label class="control-group">
          <span class="control-label">场景</span>
          <select class="control-select" data-control="scene">
            ${sceneOptions()
              .map((scene) => `<option value="${esc(scene.value)}"${scene.value === app.state.scene ? " selected" : ""}>${esc(scene.label)}</option>`)
              .join("")}
          </select>
        </label>
        <label class="control-group">
          <span class="control-label">模式</span>
          <select class="control-select" data-control="mode">
            <option value="drill"${app.state.mode === "drill" ? " selected" : ""}>逐词练习</option>
            <option value="quiz"${app.state.mode === "quiz" ? " selected" : ""}>小测模式</option>
          </select>
        </label>
        <label class="control-group">
          <span class="control-label">范围</span>
          <select class="control-select" data-control="reviewMode">
            <option value="all"${app.state.reviewMode === "all" ? " selected" : ""}>全部题目</option>
            <option value="mistakes"${app.state.reviewMode === "mistakes" ? " selected" : ""}>错题复习</option>
          </select>
        </label>
        <p class="control-note">单词练习支持逐词闯关、小测模式、错题复习，以及“看答案后重新输入”。</p>
      </div>
    `
  }

  function renderWordPractice(list, current) {
    if (!list.length) return `<div class="empty-state"><h3>当前没有可练习的单词</h3><p>请切换场景或范围。</p></div>`
    if (app.state.mode === "quiz" && app.state.roundComplete) {
      return `<div class="practice-card"><div class="card-topline"><span class="chip">小测已完成</span><span class="chip">${esc(sceneDisplayLabel(app.state.scene))}</span></div><div><p class="practice-label">本轮结果</p><p class="practice-prompt">可以查看右侧总结，或开始下一轮。</p></div>${renderFeedback(app.state.feedback)}</div>`
    }
    if (!current) return `<div class="empty-state"><h3>当前没有题目</h3><p>请调整筛选条件。</p></div>`
    const locked = Boolean(getActiveRevealState(current))
    const disabled = app.state.transitioning ? " disabled" : ""
    const revealDisabled = disabled || locked ? " disabled" : ""
    const counter =
      app.state.mode === "quiz"
        ? `第 ${app.state.roundIndex + 1} 题 / 共 ${app.state.roundQuestions.length || QUIZ_SIZE} 题`
        : `第 ${clampCursor(app.state.deckCursor, list.length) + 1} 题 / 共 ${list.length} 项`
    return `
      <form class="practice-card" data-practice-form>
        <div class="card-topline">
          <span class="chip">${app.state.mode === "quiz" ? "小测模式" : "逐词练习"}</span>
          <span class="chip">${esc(sceneDisplayLabel(app.state.scene))}</span>
          <span class="chip">${esc(categoryDisplayLabel(current.category))}</span>
          <span class="chip">${esc(counter)}</span>
        </div>
        <div>
          <p class="practice-label">中文提示</p>
          <p class="practice-prompt">${esc(current.chinese)}</p>
        </div>
        <div class="question-meta">
          <span>场景：${esc(current.scene)}</span>
          <span>类别：${esc(categoryDisplayLabel(current.category))}</span>
        </div>
        <label class="control-group">
          <span class="control-label">英文答案</span>
          <input class="answer-input" type="text" data-answer-input value="${esc(app.state.answerValue)}" autocomplete="off" autocapitalize="none" spellcheck="false" placeholder="请输入英文答案"${disabled} />
        </label>
        <div class="action-row">
          <button class="button button-primary" type="submit"${disabled}>提交</button>
          <button class="button button-secondary" type="button" data-action="reveal-answer"${revealDisabled}>看答案</button>
          <button class="button button-secondary" type="button" data-action="skip"${disabled}>跳过</button>
        </div>
        ${renderFeedback(app.state.feedback)}
      </form>
    `
  }

  function renderSynonymPractice(list, current) {
    if (!list.length) return `<div class="empty-state"><h3>当前没有可练习的同义替换</h3><p>请切换回全部题目，或先积累一些错题。</p></div>`
    const questionType = currentSynonymQuestionType()
    const disabled = app.state.transitioning ? " disabled" : ""
    const counter = `第 ${clampCursor(app.state.synonymDeckCursor, list.length) + 1} 题 / 共 ${list.length} 项`
    const choiceOptions = questionType === "choice" ? buildChoiceOptions(list, current) : []
    return `
      <form class="practice-card" data-practice-form>
        <div class="card-topline">
          <span class="chip">同义替换</span>
          <span class="chip">${questionType === "choice" ? "选择题" : "输入题"}</span>
          <span class="chip">${esc(current.source)}</span>
          <span class="chip">${esc(counter)}</span>
        </div>
        <div>
          <p class="practice-label">原词 / 表达</p>
          <p class="practice-prompt">${esc(current.prompt)}</p>
          ${current.chinese ? `<p class="practice-note">${esc(current.chinese)}</p>` : ""}
        </div>
        <div class="question-meta">
          <span>来源：${esc(current.source)}</span>
          <span>范围：${esc(reviewModeDisplayLabel(app.state.synonymReviewMode))}</span>
        </div>
        ${
          questionType === "choice"
            ? `<div class="choice-grid">${choiceOptions
                .map(
                  (option) =>
                    `<button class="button button-secondary choice-button" type="button" data-action="choose-option" data-value="${esc(option)}"${disabled}>${esc(option)}</button>`,
                )
                .join("")}</div>`
            : `<label class="control-group">
                <span class="control-label">替换表达</span>
                <input class="answer-input" type="text" data-answer-input value="${esc(app.state.answerValue)}" autocomplete="off" autocapitalize="none" spellcheck="false" placeholder="请输入同义替换表达"${disabled} />
              </label>`
        }
        <div class="action-row">
          ${questionType === "choice" ? "" : `<button class="button button-primary" type="submit"${disabled}>提交</button>`}
          ${
            questionType === "input"
              ? `<button class="button button-secondary" type="button" data-action="reveal-answer"${disabled || getActiveRevealState(current) ? " disabled" : ""}>看答案</button>`
              : ""
          }
          <button class="button button-secondary" type="button" data-action="skip"${disabled}>跳过</button>
        </div>
        ${renderFeedback(app.state.feedback)}
      </form>
    `
  }

  function renderPractice() {
    const current = currentQuestion()
    return app.state.practiceModule === "synonym"
      ? renderSynonymPractice(currentSynonymList(), current)
      : renderWordPractice(currentWordList(), current)
  }

  function renderStats() {
    if (app.state.practiceModule === "synonym") {
      const avg = app.state.synonymTimedAnswers
        ? Math.round(app.state.synonymTotalResponseMs / app.state.synonymTimedAnswers)
        : 0
      const accuracy = app.state.synonymAnswered
        ? `${Math.round((app.state.synonymCorrect / app.state.synonymAnswered) * 100)}%`
        : "0%"
      return `
        <div class="stat-grid">
          <article class="stat-card"><p class="stat-label">已答题</p><p class="stat-value">${app.state.synonymAnswered}</p></article>
          <article class="stat-card"><p class="stat-label">答对</p><p class="stat-value">${app.state.synonymCorrect}</p></article>
          <article class="stat-card"><p class="stat-label">错题</p><p class="stat-value">${app.state.synonymMistakes.length}</p></article>
          <article class="stat-card"><p class="stat-label">平均用时</p><p class="stat-value">${esc(formatMs(avg))}</p></article>
          <article class="stat-card"><p class="stat-label">正确率</p><p class="stat-value">${accuracy}</p></article>
          <article class="stat-card"><p class="stat-label">题库量</p><p class="stat-value">${currentSynonymList().length}</p></article>
        </div>
      `
    }

    const avg = app.state.timedAnswers ? Math.round(app.state.totalResponseMs / app.state.timedAnswers) : 0
    const accuracy = app.state.answered ? `${Math.round((app.state.correct / app.state.answered) * 100)}%` : "0%"
    return `
      <div class="stat-grid">
        <article class="stat-card"><p class="stat-label">已答题</p><p class="stat-value">${app.state.answered}</p></article>
        <article class="stat-card"><p class="stat-label">答对</p><p class="stat-value">${app.state.correct}</p></article>
        <article class="stat-card"><p class="stat-label">连对</p><p class="stat-value">${app.state.streak}</p></article>
        <article class="stat-card"><p class="stat-label">错题</p><p class="stat-value">${app.state.mistakes.length}</p></article>
        <article class="stat-card"><p class="stat-label">平均用时</p><p class="stat-value">${esc(formatMs(avg))}</p></article>
        <article class="stat-card"><p class="stat-label">正确率</p><p class="stat-value">${accuracy}</p></article>
      </div>
    `
  }

  function renderResults() {
    if (app.state.practiceModule === "synonym") {
      const items = app.state.synonymMistakes
        .map((id) => synonyms().find((item) => item.id === id))
        .filter(Boolean)
        .slice(0, 8)
      return `
        <div class="result-card">
          <div class="result-meta">
            <span class="chip">同义替换</span>
            <span class="chip">${esc(reviewModeDisplayLabel(app.state.synonymReviewMode))}</span>
            <span class="chip">${currentSynonymList().length} 项</span>
          </div>
          ${
            items.length
              ? `<div><p class="result-label">最近错题</p><ul class="list">${items
                  .map((item) => `<li>${esc(item.prompt)} → ${esc(item.answer)}${item.chinese ? `｜${esc(item.chinese)}` : ""}</li>`)
                  .join("")}</ul></div>`
              : `<div class="empty-state"><h3>还没有同义替换错题</h3><p>先做几题，系统会自动记录你还不熟的替换表达。</p></div>`
          }
        </div>
      `
    }

    const summary = app.state.lastQuizSummary
    if (app.state.mode === "quiz" && summary) {
      const wrongItems = summary.wrongIds.map((id) => vocab().find((item) => item.id === id)).filter(Boolean)
      return `
        <div class="result-card">
          <div class="result-meta">
            <span class="chip">小测结果</span>
            <span class="chip">${esc(sceneDisplayLabel(app.state.scene))}</span>
          </div>
          <div class="summary-card">
            <div class="summary-stats">
              <div class="summary-stat"><p class="result-label">总题数</p><p class="summary-value">${summary.total}</p></div>
              <div class="summary-stat"><p class="result-label">答对</p><p class="summary-value">${summary.correct}</p></div>
              <div class="summary-stat"><p class="result-label">正确率</p><p class="summary-value">${summary.total ? Math.round((summary.correct / summary.total) * 100) : 0}%</p></div>
            </div>
            <p class="muted-copy">错题数：${summary.incorrect}</p>
            ${
              wrongItems.length
                ? `<div><p class="result-label">错题列表</p><ul class="list">${wrongItems
                    .map((item) => `<li>${esc(item.english)} - ${esc(item.chinese)}</li>`)
                    .join("")}</ul></div>`
                : ""
            }
            <button class="button button-primary" type="button" data-action="start-next-round">开始下一轮</button>
          </div>
        </div>
      `
    }

    const items = app.state.mistakes
      .map((id) => vocab().find((item) => item.id === id))
      .filter(Boolean)
      .slice(0, 8)
    return `
      <div class="result-card">
        <div class="result-meta">
          <span class="chip">${app.state.mode === "quiz" ? "小测模式" : "逐词练习"}</span>
          <span class="chip">${esc(reviewModeDisplayLabel(app.state.reviewMode))}</span>
          <span class="chip">${currentWordList().length} 项</span>
        </div>
        ${
          items.length
            ? `<div><p class="result-label">最近错题</p><ul class="list">${items
                .map((item) => `<li>${esc(item.english)} - ${esc(item.chinese)}</li>`)
                .join("")}</ul></div>`
            : `<div class="empty-state"><h3>还没有错题</h3><p>继续练习，系统会把不熟的单词收进错题本。</p></div>`
        }
      </div>
    `
  }

  function render() {
    if (!app.el) return
    app.el.controls.innerHTML = renderControls()
    app.el.practice.innerHTML = renderPractice()
    app.el.stats.innerHTML = renderStats()
    app.el.results.innerHTML = renderResults()
  }

  function advanceAfterFeedback(callback) {
    saveState()
    render()
    clearTimer()
    app.timer = setTimeout(() => {
      app.timer = null
      app.state.transitioning = false
      app.state.feedback = null
      app.state.questionStartedAt = Date.now()
      if (typeof callback === "function") callback()
      saveState()
      render()
    }, AUTO_ADVANCE_MS)
  }

  function commitWordAttempt(current, input, skipped) {
    const list = currentWordList()
    if (!current || !list.length) return
    const now = Date.now()
    const elapsedMs = skipped ? null : Math.max(0, now - (app.state.questionStartedAt || now))
    const judged = judgeAnswer(current.english, input)
    const isCorrect = !skipped && judged.isCorrect
    const revealLocked = getActiveRevealState(current)

    if (revealLocked && !canAdvanceFromSubmission({ revealState: revealLocked, isCorrect })) {
      app.state.feedback = {
        type: "retype",
        message: input ? `你刚刚看过答案了，当前输入“${input}”还不对，请继续重输正确答案。` : "请把标准答案重新输入一遍。",
      }
      saveState()
      render()
      return
    }

    if (revealLocked && isCorrect) app.state.revealState = null

    app.state.answered += 1
    if (isCorrect) {
      app.state.correct += 1
      app.state.streak += 1
    } else {
      app.state.streak = 0
      app.state.mistakes = addMistake(app.state.mistakes, current.id)
    }
    if (!skipped) {
      app.state.totalResponseMs += elapsedMs ?? 0
      app.state.timedAnswers += 1
    }

    app.state.answerValue = ""
    app.state.feedback = {
      type: "attempt",
      isCorrect,
      skipped,
      expected: current.english,
      input,
      firstMismatchTokenIndex: judged.firstMismatchTokenIndex,
      elapsedMs,
    }

    if (app.state.mode === "quiz") {
      app.state.quizRound.push({ itemId: current.id, isCorrect })
      app.state.deckCursor = clampCursor(app.state.deckCursor + 1, list.length)
      const isLast = app.state.roundIndex + 1 >= app.state.roundQuestions.length
      if (isLast) {
        const summary = summarizeQuizRound(app.state.quizRound)
        app.state.lastQuizSummary = summary
        app.state.roundComplete = true
        app.state.roundIndex = 0
        app.state.quizRound = []
        app.state.feedback = { type: "summary", message: `本轮答对 ${summary.correct} / ${summary.total} 题。` }
        saveState()
        render()
        return
      }
      app.state.transitioning = true
      app.state.roundIndex += 1
      advanceAfterFeedback()
      return
    }

    app.state.deckCursor = clampCursor(app.state.deckCursor + 1, list.length)
    app.state.transitioning = true
    advanceAfterFeedback()
  }

  function commitSynonymAttempt(current, input, skipped) {
    const list = currentSynonymList()
    if (!current || !list.length) return
    const questionType = currentSynonymQuestionType()
    const now = Date.now()
    const elapsedMs = skipped ? null : Math.max(0, now - (app.state.questionStartedAt || now))
    const judged = judgeAnswer(current.answer, input)
    const isCorrect = !skipped && judged.isCorrect
    const revealLocked = questionType === "input" ? getActiveRevealState(current) : null

    if (revealLocked && !canAdvanceFromSubmission({ revealState: revealLocked, isCorrect })) {
      app.state.feedback = {
        type: "retype",
        message: input ? `当前输入“${input}”还不对，请继续重输正确答案。` : "请把标准答案重新输入一遍。",
      }
      saveState()
      render()
      return
    }

    if (revealLocked && isCorrect) app.state.revealState = null

    app.state.synonymAnswered += 1
    if (isCorrect) app.state.synonymCorrect += 1
    else app.state.synonymMistakes = addMistake(app.state.synonymMistakes, current.id)
    if (!skipped) {
      app.state.synonymTotalResponseMs += elapsedMs ?? 0
      app.state.synonymTimedAnswers += 1
    }

    app.state.answerValue = ""
    app.state.feedback = {
      type: "attempt",
      isCorrect,
      skipped,
      expected: current.answer,
      chinese: current.chinese,
      input,
      firstMismatchTokenIndex: judged.firstMismatchTokenIndex,
      elapsedMs,
    }
    app.state.synonymDeckCursor = clampCursor(app.state.synonymDeckCursor + 1, list.length)
    app.state.transitioning = true
    advanceAfterFeedback()
  }

  function commitAttempt(current, input, skipped) {
    if (app.state.practiceModule === "synonym") commitSynonymAttempt(current, input, skipped)
    else commitWordAttempt(current, input, skipped)
  }

  function revealCurrentAnswer() {
    const current = currentQuestion()
    if (!current || app.state.transitioning || app.state.roundComplete) return
    if (app.state.practiceModule === "synonym" && currentSynonymQuestionType() !== "input") return

    if (app.state.practiceModule === "synonym") {
      app.state.synonymMistakes = addMistake(app.state.synonymMistakes, current.id)
    } else {
      app.state.mistakes = addMistake(app.state.mistakes, current.id)
    }
    app.state.revealState = createRevealState(current)
    app.state.feedback = {
      type: "reveal",
      expected: app.state.revealState.answer,
      chinese: current.chinese,
    }
    app.state.answerValue = ""
    app.state.questionStartedAt = Date.now()
    saveState()
    render()
    const answerInput = app.el.practice.querySelector?.("[data-answer-input]")
    if (answerInput?.focus) answerInput.focus()
  }

  function onControlChange(event) {
    const target = event.target
    if (!target || target.tagName !== "SELECT") return
    const field = target.getAttribute("data-control")
    if (!field) return

    if (field === "practiceModule") app.state.practiceModule = target.value === "synonym" ? "synonym" : "word"
    if (field === "scene") app.state.scene = target.value || "all"
    if (field === "mode") app.state.mode = target.value === "quiz" ? "quiz" : "drill"
    if (field === "reviewMode") app.state.reviewMode = target.value === "mistakes" ? "mistakes" : "all"
    if (field === "synonymMode")
      app.state.synonymMode = target.value === "choice" || target.value === "input" ? target.value : "mixed"
    if (field === "synonymReviewMode")
      app.state.synonymReviewMode = target.value === "mistakes" ? "mistakes" : "all"
    restartFromControls()
  }

  function onPracticeInput(event) {
    const target = event.target
    if (target?.hasAttribute?.("data-answer-input")) app.state.answerValue = target.value
  }

  function onPracticeSubmit(event) {
    const form = event.target.closest?.("[data-practice-form]")
    if (!form) return
    event.preventDefault()
    if (app.state.transitioning || app.state.roundComplete) return
    if (app.state.practiceModule === "synonym" && currentSynonymQuestionType() === "choice") return
    commitAttempt(currentQuestion(), app.state.answerValue, false)
  }

  function onPracticeClick(event) {
    const button = event.target.closest?.("[data-action]")
    if (!button) return
    const action = button.getAttribute("data-action")
    if (action === "reveal-answer") {
      event.preventDefault()
      revealCurrentAnswer()
    }
    if (action === "skip") {
      event.preventDefault()
      if (app.state.transitioning || app.state.roundComplete) return
      commitAttempt(currentQuestion(), "", true)
    }
    if (action === "start-next-round") {
      event.preventDefault()
      startWordQuiz(false)
    }
    if (action === "choose-option") {
      event.preventDefault()
      if (app.state.transitioning || app.state.roundComplete) return
      commitAttempt(currentQuestion(), button.getAttribute("data-value") || "", false)
    }
  }

  function bindEvents() {
    app.el.controls.addEventListener("change", onControlChange)
    app.el.practice.addEventListener("input", onPracticeInput)
    app.el.practice.addEventListener("submit", onPracticeSubmit)
    app.el.practice.addEventListener("click", onPracticeClick)
  }

  function initialize() {
    if (app.ready || typeof document === "undefined") return
    const controls = document.querySelector('[data-mount="controls"]')
    const practice = document.querySelector('[data-mount="practice"]')
    const stats = document.querySelector('[data-mount="stats"]')
    const results = document.querySelector('[data-mount="results"]')
    if (!controls || !practice || !stats || !results) return
    app.el = { controls, practice, stats, results }
    const hasSavedState = hasStoredState()
    app.state = loadState()
    app.state.scene = sceneOptions().some((item) => item.value === app.state.scene) ? app.state.scene : "all"
    bindEvents()
    app.ready = true
    if (app.state.practiceModule === "synonym") startSynonym(false, hasSavedState)
    else if (app.state.mode === "quiz") startWordQuiz(false, hasSavedState)
    else startWordDrill(false, hasSavedState)
  }

  if (typeof document !== "undefined") {
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", initialize, { once: true })
    else initialize()
  }

  root.IELTSVocabPracticeApp = { initialize, getState: () => app.state, render }
})(typeof window !== "undefined" ? window : globalThis)
